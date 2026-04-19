'use strict';

const { spawn } = require('child_process');
const https     = require('https');
const http_mod  = require('http');
const path      = require('path');
const fs        = require('fs');
const dns       = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch {
  FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
}

// yt-dlp binary — proxy.js ile aynı mantık
const YT_DLP = (() => {
  const venv = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { fs.accessSync(venv); return venv; } catch { return 'yt-dlp'; }
})();

// Cookie argümanları
function _ytCookieArgs() {
  const candidates = [
    process.env.YOUTUBE_COOKIES_FILE,
    path.join(__dirname, '..', 'youtube-cookies.txt'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return ['--cookies', p];
    } catch {}
  }
  return [];
}

// Aktif stream'ler: ws → { proc, yt?, fetch? }
const ACTIVE = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// URL tipi tespiti
// ─────────────────────────────────────────────────────────────────────────────

function _isYouTubeUrl(url) {
  return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//.test(url);
}

function _isGoogleVideoCdn(url) {
  try { return new URL(url).hostname.endsWith('.googlevideo.com'); }
  catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS-over-HTTPS — Railway UDP/53 yetersiz olduğunda (googlevideo CDN için)
// ─────────────────────────────────────────────────────────────────────────────

async function _dohResolve(hostname) {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://8.8.8.8/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
  ];
  for (const url of endpoints) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res   = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json   = await res.json();
      const record = (json.Answer || []).find(r => r.type === 1);
      if (record?.data) { console.log(`[DoH] ${hostname} → ${record.data}`); return record.data; }
    } catch (e) { console.warn(`[DoH] ${url} başarısız:`, e.message); }
  }
  return null;
}

async function _fetchAndPipe(inputUrl, writable, onError) {
  let parsed;
  try { parsed = new URL(inputUrl); } catch(e) { onError(e); return { abort: () => {} }; }

  const ip = await _dohResolve(parsed.hostname);
  if (!ip) { onError(new Error(`DoH DNS çözümü başarısız: ${parsed.hostname}`)); return { abort: () => {} }; }

  return new Promise((resolve) => {
    async function doRequest(url, depth) {
      if (depth > 5) { onError(new Error('Çok fazla yönlendirme')); resolve({ abort: () => {} }); return; }
      let p; try { p = new URL(url); } catch(e) { onError(e); resolve({ abort: () => {} }); return; }

      let targetIp = depth === 0 ? ip : await _dohResolve(p.hostname);
      if (!targetIp) { onError(new Error(`Redirect DoH başarısız: ${p.hostname}`)); resolve({ abort: () => {} }); return; }

      const isHttps = p.protocol === 'https:';
      const mod = isHttps ? https : http_mod;
      const req = mod.request({
        hostname: targetIp, servername: p.hostname,
        port: Number(p.port) || (isHttps ? 443 : 80),
        path: p.pathname + p.search, method: 'GET',
        rejectUnauthorized: false,
        headers: { 'Host': p.hostname, 'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36', 'Referer': 'https://www.youtube.com/', 'Origin': 'https://www.youtube.com' },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); doRequest(res.headers.location, depth + 1); return;
        }
        if (res.statusCode !== 200) { res.resume(); onError(new Error(`CDN HTTP ${res.statusCode}`)); resolve({ abort: () => req.destroy() }); return; }
        res.pipe(writable);
        res.on('error', onError);
        resolve({ abort: () => req.destroy() });
      });
      req.on('error', (err) => { onError(err); resolve({ abort: () => {} }); });
      req.end();
    }
    doRequest(inputUrl, 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ortak ffmpeg H.264 argümanları (stdin'den okuma)
// ─────────────────────────────────────────────────────────────────────────────

function _h264Args() {
  return [
    '-re', '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=60:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'h264', 'pipe:1',
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// NAL unit parsing + WebSocket gönderim (ffmpeg stdout'u işle)
// ─────────────────────────────────────────────────────────────────────────────

function _attachH264Output(ws, ff, label) {
  let buffer  = Buffer.alloc(0);
  let startMs = Date.now();

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { units, remaining } = _splitNalUnits(buffer);
    buffer = remaining;

    for (const unit of units) {
      if (!unit.length) continue;
      const scLen   = (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1) ? 4 : 3;
      if (unit.length <= scLen) continue;
      const nalType = unit[scLen] & 0x1F;
      if (nalType === 9 || nalType === 12) continue;
      if (ws.readyState !== 1) return;

      if (nalType === 7) {
        const spsRaw = unit.slice(scLen);
        const msg = Buffer.allocUnsafe(1 + spsRaw.length);
        msg[0] = 0x07; spsRaw.copy(msg, 1);
        ws.send(msg, { binary: true }); continue;
      }
      if (nalType === 8) {
        const ppsRaw = unit.slice(scLen);
        const msg = Buffer.allocUnsafe(1 + ppsRaw.length);
        msg[0] = 0x08; ppsRaw.copy(msg, 1);
        ws.send(msg, { binary: true }); continue;
      }

      const rawNal = unit.slice(scLen);
      const avcc   = Buffer.allocUnsafe(4 + rawNal.length);
      avcc.writeUInt32BE(rawNal.length, 0);
      rawNal.copy(avcc, 4);
      _sendFrame(ws, nalType === 5, BigInt(Date.now() - startMs) * 1000n, avcc);
    }
  });

  let stderrBuf = '';
  ff.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n'); stderrBuf = lines.pop();
    lines.forEach(l => { if (l.trim()) console.error(`[ffmpeg/${label}]`, l); });
  });

  ff.on('close', () => {
    if (stderrBuf.trim()) console.error(`[ffmpeg/${label}]`, stderrBuf);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1001, 'stream sona erdi');
  });

  ff.on('error', (err) => {
    console.error(`[Stream/${label}] ffmpeg hata:`, err.message);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1011, 'ffmpeg hatası');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket bağlantı girişi
// ─────────────────────────────────────────────────────────────────────────────

function handleStreamConnection(ws, req) {
  const search = new URL('http://x' + (req.url || '')).searchParams;
  const rawUrl = search.get('url');
  if (!rawUrl) { ws.close(1008, 'url gerekli'); return; }

  let inputUrl;
  try { inputUrl = decodeURIComponent(rawUrl); }
  catch { ws.close(1008, 'geçersiz url'); return; }

  _startH264(ws, inputUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// H.264 stream — üç yol: YouTube→yt-dlp | CDN→DoH+pipe | Diğer→direkt
// ─────────────────────────────────────────────────────────────────────────────

function _startH264(ws, inputUrl) {
  _startH264Async(ws, inputUrl).catch(err => {
    console.error('[Stream/H264] Başlatma hatası:', err.message);
    if (ws.readyState <= 1) ws.close(1011, 'stream hatası');
  });
}

async function _startH264Async(ws, inputUrl) {
  // ── YOL 1: YouTube URL → yt-dlp pipe ─────────────────────────────────────
  if (_isYouTubeUrl(inputUrl)) {
    console.log('[Stream/H264] YouTube→yt-dlp modu');

    const cookieArgs = _ytCookieArgs();
    const ytArgs = [
      ...cookieArgs,
      '--no-playlist', '--no-warnings', '--geo-bypass',
      '--extractor-args', 'youtube:player_client=web,web_safari,android',
      // Sadece combined (tek dosya) format → doğrudan pipe edilebilir
      '-f', '18/best[ext=mp4][vcodec!=none][acodec!=none][height<=480]/best[vcodec!=none][acodec!=none][height<=480]',
      '-o', '-',
      inputUrl,
    ];

    const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const ff = spawn(FFMPEG_PATH, _h264Args(), { stdio: ['pipe', 'pipe', 'pipe'] });

    yt.stdout.pipe(ff.stdin);
    ff.stdin.on('error', () => {});

    let ytStderr = '';
    yt.stderr.on('data', chunk => {
      ytStderr += chunk.toString();
      const lines = ytStderr.split('\n'); ytStderr = lines.pop();
      lines.forEach(l => { if (l.trim()) console.log('[yt-dlp/stream]', l); });
    });
    yt.on('error', err => console.error('[yt-dlp] spawn hatası:', err.message));
    yt.on('close', code => { if (code !== 0) console.warn('[yt-dlp] çıkış kodu:', code); });

    ACTIVE.set(ws, { proc: ff, yt });
    _attachH264Output(ws, ff, 'H264-YT');
    ws.on('close', () => _killStream(ws));
    ws.on('error', () => _killStream(ws));
    return;
  }

  // ── YOL 2: googlevideo.com CDN → DoH + Node.js HTTP pipe ─────────────────
  if (_isGoogleVideoCdn(inputUrl)) {
    console.log('[Stream/H264] DoH+pipe modu');

    const ff = spawn(FFMPEG_PATH, _h264Args(), { stdio: ['pipe', 'pipe', 'pipe'] });
    ff.stdin.on('error', () => {});

    const fetchHandle = await _fetchAndPipe(inputUrl, ff.stdin, (err) => {
      console.error('[Stream/H264] CDN fetch hatası:', err.message);
      try { ff.kill('SIGKILL'); } catch {}
    });

    ACTIVE.set(ws, { proc: ff, fetch: fetchHandle });
    _attachH264Output(ws, ff, 'H264-CDN');
    ws.on('close', () => _killStream(ws));
    ws.on('error', () => _killStream(ws));
    return;
  }

  // ── YOL 3: Direkt URL (IPTV/RTSP/HLS) ───────────────────────────────────
  console.log('[Stream/H264] Direkt URL modu');
  const ytHeaders =
    'User-Agent: Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36\r\n' +
    'Referer: https://www.youtube.com/\r\n' +
    'Origin: https://www.youtube.com\r\n';

  const directArgs = [
    '-fflags', 'nobuffer+discardcorrupt', '-flags', 'low_delay',
    '-headers', ytHeaders, '-rtsp_transport', 'tcp', '-i', inputUrl,
    '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=60:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'h264', 'pipe:1',
  ];

  const ff = spawn(FFMPEG_PATH, directArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  ACTIVE.set(ws, { proc: ff });
  _attachH264Output(ws, ff, 'H264-Direct');
  ws.on('close', () => _killStream(ws));
  ws.on('error', () => _killStream(ws));
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı fonksiyonlar
// ─────────────────────────────────────────────────────────────────────────────

function _splitNalUnits(buf) {
  const units = [];
  let unitStart = -1, i = 0;
  while (i < buf.length - 2) {
    let found = false, scLen = 0;
    if (i + 3 < buf.length && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) { found = true; scLen = 4; }
    else if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) { found = true; scLen = 3; }
    if (found) { if (unitStart >= 0) units.push(buf.slice(unitStart, i)); unitStart = i; i += scLen; }
    else { i++; }
  }
  return { units, remaining: unitStart >= 0 ? buf.slice(unitStart) : buf };
}

function _sendFrame(ws, isKey, tsUs, data) {
  const header = Buffer.allocUnsafe(9);
  header[0] = isKey ? 0x01 : 0x00;
  new DataView(header.buffer, header.byteOffset, 8).setBigUint64(0, tsUs, true);
  try { ws.send(Buffer.concat([header, data]), { binary: true }); } catch {}
}

function _killStream(ws) {
  const entry = ACTIVE.get(ws);
  if (entry) {
    if (entry.fetch) entry.fetch.abort();
    if (entry.yt) try { entry.yt.kill('SIGKILL'); } catch {}
    try { entry.proc.kill('SIGKILL'); } catch {}
    ACTIVE.delete(ws);
  }
}

module.exports = { handleStreamConnection };
