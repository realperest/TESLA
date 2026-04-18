'use strict';

const { spawn }  = require('child_process');
const dns        = require('dns');
const https      = require('https');
const http_mod   = require('http');

// Node.js dns.resolve*() için Google DNS (ffmpeg child process'ini etkilemez,
// ama _fetchAndPipe içindeki https.request lookup override'ını etkiler)
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch {
  FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
}

// Aktif stream process'leri: ws → { proc, req }
const ACTIVE = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Railway'de çözümlenemeyen googlevideo.com CDN hostname tespiti
// ─────────────────────────────────────────────────────────────────────────────

function _isGoogleVideoCdn(url) {
  try { return new URL(url).hostname.endsWith('.googlevideo.com'); }
  catch { return false; }
}

/**
 * Node.js dns.resolve4() ile hostname çözer → 8.8.8.8 kullanır.
 * https.request / http.request'in lookup seçeneğine verilir.
 */
function _customLookup(hostname, options, callback) {
  dns.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || !addresses.length) {
      // 8.8.8.8 de çözemediyse OS fallback
      dns.lookup(hostname, options, callback);
      return;
    }
    callback(null, addresses[0], 4);
  });
}

/**
 * googlevideo.com URL'sini Node.js HTTPS üzerinden çeker ve `writable`'a pipe eder.
 * ffmpeg child process DNS'ini bypass etmek için kullanılır.
 * Yönlendirmeleri takip eder (max 5).
 * onError(err)  → HTTP/DNS hatası
 * returns: NodeJS.ClientRequest — abort etmek için kullanılabilir
 */
function _fetchAndPipe(inputUrl, writable, onError) {
  let activeReq = null;

  function doRequest(url, depth) {
    if (depth > 5) { onError(new Error('Çok fazla yönlendirme')); return; }

    let parsed;
    try { parsed = new URL(url); }
    catch (e) { onError(e); return; }

    const isHttps = parsed.protocol === 'https:';
    const mod     = isHttps ? https : http_mod;

    const reqOpts = {
      hostname : parsed.hostname,
      port     : parsed.port || (isHttps ? 443 : 80),
      path     : parsed.pathname + parsed.search,
      method   : 'GET',
      headers  : {
        'User-Agent' : 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36',
        'Referer'    : 'https://www.youtube.com/',
        'Origin'     : 'https://www.youtube.com',
      },
      lookup             : _customLookup,
      rejectUnauthorized : false, // IP ile TLS doğrulaması bazen başarısız olur
    };

    const req = mod.request(reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        doRequest(res.headers.location, depth + 1);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        onError(new Error('CDN HTTP ' + res.statusCode));
        return;
      }
      res.pipe(writable);
      res.on('error', onError);
    });

    req.on('error', onError);
    req.end();
    activeReq = req;
  }

  doRequest(inputUrl, 0);
  return { abort: () => { if (activeReq) try { activeReq.destroy(); } catch {} } };
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
  const usePipe = _isGoogleVideoCdn(inputUrl);

  const ytHeaders =
    'User-Agent: Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36\r\n' +
    'Referer: https://www.youtube.com/\r\n' +
    'Origin: https://www.youtube.com\r\n';

  // Pipe modunda -headers ve -rtsp_transport gerekmiyor
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

  let fetchHandle = null;

  if (usePipe) {
    console.log('[Stream/H264] googlevideo CDN → Node.js pipe modu');
    fetchHandle = _fetchAndPipe(inputUrl, ff.stdin, (err) => {
      console.error('[Stream/H264] CDN fetch hatası:', err.message);
      try { ff.kill('SIGKILL'); } catch {}
    });
    ff.stdin.on('error', () => {}); // ws kapanınca pipe kopabilir, yoksay
  } else {
    console.log('[Stream/H264] Direkt URL modu:', inputUrl.slice(0, 80));
  }

  ACTIVE.set(ws, { proc: ff, fetch: fetchHandle });

  let buffer  = Buffer.alloc(0);
  let spsRaw  = null;
  let ppsRaw  = null;
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
        ppsRaw = unit.slice(scLen);
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

      const tsUs  = BigInt(Date.now() - startMs) * 1000n;
      const isKey = nalType === 5;
      _sendFrame(ws, isKey, tsUs, avcc);
    }
  });

  let stderrBuf = '';
  ff.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    lines.forEach(l => { if (l.trim()) console.error('[ffmpeg/H264]', l); });
  });

  ff.on('close', (code) => {
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

  let fetchHandle = null;

  if (usePipe) {
    console.log('[Stream/MJPEG] googlevideo CDN → Node.js pipe modu');
    fetchHandle = _fetchAndPipe(inputUrl, ff.stdin, (err) => {
      console.error('[Stream/MJPEG] CDN fetch hatası:', err.message);
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

    let searchFrom = 0;
    while (true) {
      const soiIdx = buffer.indexOf(SOI, searchFrom);
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
      searchFrom = eoiIdx + 2;
    }
  });

  let stderrBufM = '';
  ff.stderr.on('data', (chunk) => {
    stderrBufM += chunk.toString();
    const lines = stderrBufM.split('\n');
    stderrBufM = lines.pop();
    lines.forEach(l => { if (l.trim()) console.error('[ffmpeg/MJPEG]', l); });
  });

  ff.on('close', () => {
    if (stderrBufM.trim()) console.error('[ffmpeg/MJPEG]', stderrBufM);
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
    let found = false;
    let scLen = 0;

    if (i + 3 < buf.length && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
      found = true; scLen = 4;
    } else if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) {
      found = true; scLen = 3;
    }

    if (found) {
      if (unitStart >= 0) units.push(buf.slice(unitStart, i));
      unitStart = i;
      i += scLen;
    } else {
      i++;
    }
  }

  const remaining = unitStart >= 0 ? buf.slice(unitStart) : buf;
  return { units, remaining };
}

function _sendFrame(ws, isKey, tsUs, data) {
  const header = Buffer.allocUnsafe(9);
  header[0] = isKey ? 0x01 : 0x00;
  const view = new DataView(header.buffer, header.byteOffset, 8);
  view.setBigUint64(0, tsUs, true);
  const msg = Buffer.concat([header, data]);
  try { ws.send(msg, { binary: true }); } catch {}
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
