'use strict';

const { spawn } = require('child_process');
const https     = require('https');
const http_mod  = require('http');

let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch {
  FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
}

// Aktif stream'ler: ws → { proc, abortFetch }
const ACTIVE = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// DNS-over-HTTPS (DoH) — Railway UDP/53 bloke etse bile çalışır (port 443)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hostname'i Cloudflare ve Google DoH üzerinden çözer.
 * UDP/53 yerine HTTPS kullandığı için Railway ağında kesinlikle çalışır.
 * @returns {Promise<string|null>} IPv4 adresi veya null
 */
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
      const res   = await fetch(url, {
        headers : { accept: 'application/dns-json' },
        signal  : ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json   = await res.json();
      const record = (json.Answer || []).find(r => r.type === 1); // A record
      if (record?.data) {
        console.log(`[DoH] ${hostname} → ${record.data}`);
        return record.data;
      }
    } catch (e) {
      console.warn(`[DoH] ${url} başarısız:`, e.message);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CDN URL tespiti
// ─────────────────────────────────────────────────────────────────────────────

function _isGoogleVideoCdn(url) {
  try { return new URL(url).hostname.endsWith('.googlevideo.com'); }
  catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// DoH ile çözülmüş IP üzerinden HTTP fetch + ffmpeg stdin pipe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YouTube CDN URL'sini Node.js HTTPS üzerinden çeker ve `writable`'a pipe eder.
 * 1. DoH ile hostname → IP çözümü (port 443, Railway'de çalışır)
 * 2. https.request ile doğrudan IP'ye bağlan (servername ile TLS SNI ayarlı)
 * 3. Response'u ffmpeg stdin'e pipe et
 *
 * @returns {Promise<{abort:Function}>}
 */
async function _fetchAndPipe(inputUrl, writable, onError) {
  let parsed;
  try { parsed = new URL(inputUrl); }
  catch (e) { onError(e); return { abort: () => {} }; }

  const ip = await _dohResolve(parsed.hostname);
  if (!ip) {
    onError(new Error(`DoH DNS çözümü başarısız: ${parsed.hostname}`));
    return { abort: () => {} };
  }

  return new Promise((resolve) => {
    async function doRequest(url, depth) {
      if (depth > 5) {
        onError(new Error('Çok fazla yönlendirme'));
        resolve({ abort: () => {} });
        return;
      }

      let p;
      try { p = new URL(url); } catch(e) { onError(e); resolve({ abort: () => {} }); return; }

      // Redirect olursa yeni hostname'i de DoH ile çöz
      let targetIp = ip;
      if (depth > 0) {
        targetIp = await _dohResolve(p.hostname);
        if (!targetIp) {
          onError(new Error(`Redirect DoH başarısız: ${p.hostname}`));
          resolve({ abort: () => {} });
          return;
        }
      }

      const isHttps = p.protocol === 'https:';
      const mod     = isHttps ? https : http_mod;

      const reqOpts = {
        hostname           : targetIp,         // IP → DNS bypass
        servername         : p.hostname,       // TLS SNI → doğru sertifika
        port               : Number(p.port) || (isHttps ? 443 : 80),
        path               : p.pathname + p.search,
        method             : 'GET',
        rejectUnauthorized : false,            // IP ile bağlandığımız için
        headers            : {
          'Host'       : p.hostname,
          'User-Agent' : 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36',
          'Referer'    : 'https://www.youtube.com/',
          'Origin'     : 'https://www.youtube.com',
        },
      };

      const req = mod.request(reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          onError(new Error(`CDN HTTP ${res.statusCode}`));
          resolve({ abort: () => req.destroy() });
          return;
        }
        res.pipe(writable);
        res.on('error', onError);
        resolve({ abort: () => req.destroy() });
      });

      req.on('error', (err) => {
        onError(err);
        resolve({ abort: () => {} });
      });
      req.end();
    }

    doRequest(inputUrl, 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket bağlantı girişi
// ─────────────────────────────────────────────────────────────────────────────

function handleStreamConnection(ws, req) {
  const search = new URL('http://x' + (req.url || '')).searchParams;
  const rawUrl = search.get('url');
  const mode   = search.get('mode') || 'h264';

  if (!rawUrl) { ws.close(1008, 'url gerekli'); return; }

  let inputUrl;
  try { inputUrl = decodeURIComponent(rawUrl); }
  catch { ws.close(1008, 'geçersiz url'); return; }

  if (mode === 'mjpeg') {
    _startMjpeg(ws, inputUrl);
  } else {
    _startH264(ws, inputUrl);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// H.264 Annex B stream
// ─────────────────────────────────────────────────────────────────────────────

function _startH264(ws, inputUrl) {
  _startH264Async(ws, inputUrl).catch(err => {
    console.error('[Stream/H264] Başlatma hatası:', err.message);
    if (ws.readyState <= 1) ws.close(1011, 'stream hatası');
  });
}

async function _startH264Async(ws, inputUrl) {
  const usePipe = _isGoogleVideoCdn(inputUrl);

  const ytHeaders =
    'User-Agent: Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36\r\n' +
    'Referer: https://www.youtube.com/\r\n' +
    'Origin: https://www.youtube.com\r\n';

  const inputArgs = usePipe
    ? ['-i', 'pipe:0']
    : ['-headers', ytHeaders, '-rtsp_transport', 'tcp', '-i', inputUrl];

  const args = [
    '-fflags', 'nobuffer+discardcorrupt',
    '-flags', 'low_delay',
    ...inputArgs,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=60:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
           'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,' +
           'fps=30',
    '-f', 'h264',
    'pipe:1',
  ];

  const ff = spawn(FFMPEG_PATH, args, {
    stdio: [usePipe ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  let fetchHandle = { abort: () => {} };

  if (usePipe) {
    console.log('[Stream/H264] DoH+pipe modu:', inputUrl.slice(0, 80));
    fetchHandle = await _fetchAndPipe(inputUrl, ff.stdin, (err) => {
      console.error('[Stream/H264] Fetch hatası:', err.message);
      try { ff.kill('SIGKILL'); } catch {}
    });
    ff.stdin.on('error', () => {});
  } else {
    console.log('[Stream/H264] Direkt URL modu');
  }

  ACTIVE.set(ws, { proc: ff, fetch: fetchHandle });

  let buffer  = Buffer.alloc(0);
  let spsRaw  = null;
  let startMs = Date.now();

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { units, remaining } = _splitNalUnits(buffer);
    buffer = remaining;

    for (const unit of units) {
      if (!unit.length) continue;
      const scLen = (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1) ? 4 : 3;
      if (unit.length <= scLen) continue;
      const nalType = unit[scLen] & 0x1F;

      if (nalType === 9 || nalType === 12) continue;
      if (ws.readyState !== 1) return;

      if (nalType === 7) {
        spsRaw = unit.slice(scLen);
        const msg = Buffer.allocUnsafe(1 + spsRaw.length);
        msg[0] = 0x07;
        spsRaw.copy(msg, 1);
        ws.send(msg, { binary: true });
        continue;
      }

      if (nalType === 8) {
        const ppsRaw = unit.slice(scLen);
        const msg = Buffer.allocUnsafe(1 + ppsRaw.length);
        msg[0] = 0x08;
        ppsRaw.copy(msg, 1);
        ws.send(msg, { binary: true });
        continue;
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
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach(l => { if (l.trim()) console.error('[ffmpeg/H264]', l); });
  });

  ff.on('close', () => {
    if (stderrBuf.trim()) console.error('[ffmpeg/H264]', stderrBuf);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1001, 'stream sona erdi');
  });

  ff.on('error', (err) => {
    console.error('[Stream] ffmpeg hata:', err.message);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1011, 'ffmpeg hatası');
  });

  ws.on('close', () => _killStream(ws));
  ws.on('error', () => _killStream(ws));
}

// ─────────────────────────────────────────────────────────────────────────────
// MJPEG stream
// ─────────────────────────────────────────────────────────────────────────────

function _startMjpeg(ws, inputUrl) {
  _startMjpegAsync(ws, inputUrl).catch(err => {
    console.error('[Stream/MJPEG] Başlatma hatası:', err.message);
    if (ws.readyState <= 1) ws.close(1011, 'stream hatası');
  });
}

async function _startMjpegAsync(ws, inputUrl) {
  const usePipe = _isGoogleVideoCdn(inputUrl);

  const ytHeaders =
    'User-Agent: Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36\r\n' +
    'Referer: https://www.youtube.com/\r\n' +
    'Origin: https://www.youtube.com\r\n';

  const inputArgs = usePipe
    ? ['-i', 'pipe:0']
    : ['-headers', ytHeaders, '-rtsp_transport', 'tcp', '-i', inputUrl];

  const args = [
    '-fflags', 'nobuffer+discardcorrupt',
    '-flags', 'low_delay',
    ...inputArgs,
    '-an',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
           'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,' +
           'fps=24',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ];

  const ff = spawn(FFMPEG_PATH, args, {
    stdio: [usePipe ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  let fetchHandle = { abort: () => {} };

  if (usePipe) {
    console.log('[Stream/MJPEG] DoH+pipe modu');
    fetchHandle = await _fetchAndPipe(inputUrl, ff.stdin, (err) => {
      console.error('[Stream/MJPEG] Fetch hatası:', err.message);
      try { ff.kill('SIGKILL'); } catch {}
    });
    ff.stdin.on('error', () => {});
  }

  ACTIVE.set(ws, { proc: ff, fetch: fetchHandle });

  const SOI = Buffer.from([0xFF, 0xD8]);
  const EOI = Buffer.from([0xFF, 0xD9]);
  let buffer = Buffer.alloc(0);

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let from = 0;
    while (true) {
      const soiIdx = buffer.indexOf(SOI, from);
      if (soiIdx === -1) { buffer = Buffer.alloc(0); break; }
      const eoiIdx = buffer.indexOf(EOI, soiIdx + 2);
      if (eoiIdx === -1) { buffer = buffer.slice(soiIdx); break; }
      const frame = buffer.slice(soiIdx, eoiIdx + 2);
      if (ws.readyState === 1) {
        const msg = Buffer.allocUnsafe(1 + frame.length);
        msg[0] = 0xFF;
        frame.copy(msg, 1);
        ws.send(msg, { binary: true });
      }
      from = eoiIdx + 2;
    }
  });

  let stderrBuf = '';
  ff.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach(l => { if (l.trim()) console.error('[ffmpeg/MJPEG]', l); });
  });

  ff.on('close', () => {
    if (stderrBuf.trim()) console.error('[ffmpeg/MJPEG]', stderrBuf);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1001, 'stream sona erdi');
  });

  ff.on('error', (err) => {
    console.error('[Stream/MJPEG] ffmpeg hata:', err.message);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1011, 'ffmpeg hatası');
  });

  ws.on('close', () => _killStream(ws));
  ws.on('error', () => _killStream(ws));
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı fonksiyonlar
// ─────────────────────────────────────────────────────────────────────────────

function _splitNalUnits(buf) {
  const units = [];
  let unitStart = -1;
  let i = 0;
  while (i < buf.length - 2) {
    let found = false, scLen = 0;
    if (i + 3 < buf.length && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
      found = true; scLen = 4;
    } else if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) {
      found = true; scLen = 3;
    }
    if (found) {
      if (unitStart >= 0) units.push(buf.slice(unitStart, i));
      unitStart = i;
      i += scLen;
    } else { i++; }
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
    try { entry.proc.kill('SIGKILL'); } catch {}
    ACTIVE.delete(ws);
  }
}

module.exports = { handleStreamConnection };
