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

const YT_DLP = (() => {
  const venv = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { fs.accessSync(venv); return venv; } catch { return 'yt-dlp'; }
})();

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

const ACTIVE = new Map();

function _isYouTubeUrl(url) {
  return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//.test(url);
}

function _isGoogleVideoCdn(url) {
  try { return new URL(url).hostname.endsWith('.googlevideo.com'); }
  catch { return false; }
}

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
      if (record?.data) return record.data;
    } catch {}
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
        headers: { 'Host': p.hostname, 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/', 'Origin': 'https://www.youtube.com' },
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

function _h264Args() {
  return [
    '-re', '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '4.1',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=30:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'h264', 'pipe:1',
  ];
}

const TYPE_VIDEO = 0x01;

function _attachH264Output(ws, ff, label) {
  let buffer  = Buffer.alloc(0);
  let startMs = Date.now();

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { units, remaining } = _splitNalUnits(buffer);
    buffer = remaining;

    for (const unit of units) {
      if (unit.length < 5) continue;
      const scLen = (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1) ? 4 : 3;
      const nalType = unit[scLen] & 0x1F;
      if (nalType === 9 || nalType === 12) continue;
      if (ws.readyState !== 1) return;

      const pts = BigInt(Date.now() - startMs);
      const header = Buffer.allocUnsafe(9);
      header[0] = TYPE_VIDEO; 
      header.writeBigUInt64LE(pts, 1);

      try { ws.send(Buffer.concat([header, unit]), { binary: true }); } catch {}
    }
  });

  ff.on('close', () => { ACTIVE.delete(ws); if (ws.readyState <= 1) ws.close(1001); });
}

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

function handleStreamConnection(ws, req) {
  const search = new URL('http://x' + (req.url || '')).searchParams;
  const rawUrl = search.get('url');
  if (!rawUrl) { ws.close(1008); return; }
  let inputUrl;
  try { inputUrl = decodeURIComponent(rawUrl); } catch { ws.close(1008); return; }
  _startStream(ws, inputUrl);
}

function _startStream(ws, inputUrl) {
  _startStreamAsync(ws, inputUrl).catch(() => { if (ws.readyState <= 1) ws.close(1011); });
}

async function _startStreamAsync(ws, inputUrl) {
  if (_isYouTubeUrl(inputUrl)) {
    const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '--geo-bypass', '-f', '18/best', '-o', '-', inputUrl].flat().filter(Boolean);
    const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
    const ff = spawn(FFMPEG_PATH, _h264Args(), { stdio: ['pipe', 'pipe', 'ignore'] });
    yt.stdout.pipe(ff.stdin);
    ACTIVE.set(ws, { proc: ff, yt });
    _attachH264Output(ws, ff, 'H264-YT');
    ws.on('close', () => _killStream(ws));
    return;
  }

  if (_isGoogleVideoCdn(inputUrl)) {
    const ff = spawn(FFMPEG_PATH, _h264Args(), { stdio: ['pipe', 'pipe', 'ignore'] });
    const fetchHandle = await _fetchAndPipe(inputUrl, ff.stdin, () => ff.kill('SIGKILL'));
    ACTIVE.set(ws, { proc: ff, fetch: fetchHandle });
    _attachH264Output(ws, ff, 'H264-CDN');
    ws.on('close', () => _killStream(ws));
    return;
  }

  const directArgs = ['-headers', 'User-Agent: Mozilla/5.0\r\n', '-i', inputUrl, ..._h264Args()];
  const ff = spawn(FFMPEG_PATH, directArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  ACTIVE.set(ws, { proc: ff });
  _attachH264Output(ws, ff, 'H264-Direct');
  ws.on('close', () => _killStream(ws));
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

function handleAudioRequest(req, res) {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).end();
  let inputUrl;
  try { inputUrl = decodeURIComponent(rawUrl); } catch { return res.status(400).end(); }

  const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '--geo-bypass', '-f', '140/bestaudio/18', '-o', '-', inputUrl].flat().filter(Boolean);
  const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  const ff = spawn(FFMPEG_PATH, ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-q:a', '5', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
  
  yt.stdout.pipe(ff.stdin);
  res.setHeader('Content-Type', 'audio/mpeg');
  ff.stdout.pipe(res);
  req.on('close', () => { try { yt.kill('SIGKILL'); ff.kill('SIGKILL'); } catch {} });
}

module.exports = { handleStreamConnection, handleAudioRequest };
