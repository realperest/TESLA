/**
 * WebCodecs Stream — H.264 Annex B over WebSocket
 *
 * Tesla sürüş kısıtlaması HTMLVideoElement pipeline'ını bloke eder.
 * Çözüm: ffmpeg ile kaynak stream'i H.264'e encode edip Annex B NAL
 * unit'lerini WebSocket binary frame olarak göndermek. İstemci Worker
 * içinde VideoDecoder (WebCodecs) ile decode eder, canvas'a çizer.
 *
 * Protokol (sunucu → istemci):
 *   Her binary WebSocket mesajı = 1 NAL unit grubu (access unit)
 *   Byte 0    : 0x01 = keyframe, 0x00 = delta frame
 *   Byte 1-8  : timestamp (microsaniye, Uint64LE)
 *   Byte 9+   : Annex B bitstream (00 00 00 01 + NAL data)
 *
 * MJPEG modu (mode=mjpeg):
 *   Byte 0    : 0xFF (MJPEG marker)
 *   Byte 1+   : raw JPEG data (FF D8 ... FF D9)
 */

'use strict';

const { spawn } = require('child_process');

let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch {
  FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
}

// Aktif stream process'leri: ws → ChildProcess
const ACTIVE = new Map();

/**
 * WebSocket bağlantısını karşıla. Verifyfor WS auth server.js tarafından
 * yapılır; buraya gelen ws zaten doğrulanmış kabul edilir.
 */
function handleStreamConnection(ws, req) {
  const search = new URL('http://x' + (req.url || '')).searchParams;
  const rawUrl = search.get('url');
  const mode   = search.get('mode') || 'h264';

  if (!rawUrl) {
    ws.close(1008, 'url gerekli');
    return;
  }

  let inputUrl;
  try {
    inputUrl = decodeURIComponent(rawUrl);
  } catch {
    ws.close(1008, 'geçersiz url');
    return;
  }

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
  const args = [
    '-fflags', 'nobuffer+discardcorrupt',
    '-flags', 'low_delay',
    '-avioflags', 'direct',
    '-rtsp_transport', 'tcp',
    '-i', inputUrl,

    // Sadece video — ses <audio> element ile ayrıca oynatılır
    '-an',

    // H.264 encode
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.0',

    // Annex B + SPS/PPS her keyframe öncesi tekrar
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=60:min-keyint=30:bframes=0:scenecut=0',

    // Çözünürlük + kare hızı
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
           'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,' +
           'fps=30',

    // raw H.264 bitstream pipe'a
    '-f', 'h264',
    'pipe:1',
  ];

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ACTIVE.set(ws, ff);

  let buffer  = Buffer.alloc(0);
  let spsRaw  = null; // start code OLMADAN raw SPS
  let ppsRaw  = null; // start code OLMADAN raw PPS
  let spsSent = false; // SPS/PPS istemciye gönderildi mi?
  let startMs = Date.now();

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { units, remaining } = _splitNalUnits(buffer);
    buffer = remaining;

    for (const unit of units) {
      if (!unit.length) continue;

      // Start code uzunluğunu bul (00 00 00 01 veya 00 00 01)
      const scLen = (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1) ? 4 : 3;
      if (unit.length <= scLen) continue;
      const nalType = unit[scLen] & 0x1F;

      // AUD (9) ve filler (12) → atla
      if (nalType === 9 || nalType === 12) continue;

      if (ws.readyState !== 1) return;

      if (nalType === 7) {
        // SPS — start code olmadan raw NAL'ı sakla ve istemciye gönder
        spsRaw  = unit.slice(scLen);
        spsSent = false;
        // Mesaj: [0x07, ...raw_sps]
        const msg = Buffer.allocUnsafe(1 + spsRaw.length);
        msg[0] = 0x07;
        spsRaw.copy(msg, 1);
        ws.send(msg, { binary: true });
        continue;
      }

      if (nalType === 8) {
        // PPS — start code olmadan raw NAL'ı sakla ve gönder
        ppsRaw = unit.slice(scLen);
        // Mesaj: [0x08, ...raw_pps]
        const msg = Buffer.allocUnsafe(1 + ppsRaw.length);
        msg[0] = 0x08;
        ppsRaw.copy(msg, 1);
        ws.send(msg, { binary: true });
        continue;
      }

      // Frame: AVCC formatına çevir (4-byte big-endian length + raw NAL)
      const rawNal = unit.slice(scLen);
      const avcc   = Buffer.allocUnsafe(4 + rawNal.length);
      avcc.writeUInt32BE(rawNal.length, 0);
      rawNal.copy(avcc, 4);

      const tsUs  = BigInt(Date.now() - startMs) * 1000n;
      const isKey = nalType === 5;

      _sendFrame(ws, isKey, tsUs, avcc);
    }
  });

  ff.stderr.on('data', () => {}); // ffmpeg log'u sessizce yut

  ff.on('close', () => {
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
// MJPEG stream (fallback — VideoDecoder desteklenmeyen araçlar için)
// ─────────────────────────────────────────────────────────────────────────────

function _startMjpeg(ws, inputUrl) {
  const args = [
    '-fflags', 'nobuffer+discardcorrupt',
    '-flags', 'low_delay',
    '-rtsp_transport', 'tcp',
    '-i', inputUrl,
    '-an',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
           'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,' +
           'fps=24',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ];

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ACTIVE.set(ws, ff);

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
      if (eoiIdx === -1) {
        // Frame henüz tamamlanmadı, SOI'den itibaren buffer'a al
        buffer = buffer.slice(soiIdx);
        break;
      }

      const frame = buffer.slice(soiIdx, eoiIdx + 2);
      if (ws.readyState === 1) {
        // Header: 1 byte MJPEG marker (0xFF)
        const msg = Buffer.allocUnsafe(1 + frame.length);
        msg[0] = 0xFF;
        frame.copy(msg, 1);
        ws.send(msg, { binary: true });
      }
      searchFrom = eoiIdx + 2;
    }
  });

  ff.stderr.on('data', () => {});

  ff.on('close', () => {
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

/**
 * Buffer'dan NAL unit'leri çıkar. Son tamamlanmamış unit remaining'e bırakılır.
 * Annex B start code: 00 00 00 01 (4 byte) veya 00 00 01 (3 byte)
 */
function _splitNalUnits(buf) {
  const units = [];
  let unitStart = -1;
  let i = 0;

  while (i < buf.length - 2) {
    const is3 = buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1;
    const is4 = is3 && i > 0 && buf[i - 1] === 0;

    let found = false;
    let scLen = 0;

    if (i + 3 < buf.length && buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
      found = true; scLen = 4;
    } else if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) {
      found = true; scLen = 3;
    }

    if (found) {
      if (unitStart >= 0) {
        units.push(buf.slice(unitStart, i));
      }
      unitStart = i;
      i += scLen;
    } else {
      i++;
    }
  }

  const remaining = unitStart >= 0 ? buf.slice(unitStart) : buf;
  return { units, remaining };
}

/**
 * Binary WebSocket mesajı gönder.
 * Format: [1 byte isKey] [8 byte timestamp_us LE] [NAL data]
 */
function _sendFrame(ws, isKey, tsUs, data) {
  const header = Buffer.allocUnsafe(9);
  header[0] = isKey ? 0x01 : 0x00;
  const view = new DataView(header.buffer, header.byteOffset, 8);
  view.setBigUint64(0, tsUs, true); // Little-endian
  const msg = Buffer.concat([header, data]);
  try {
    ws.send(msg, { binary: true });
  } catch {
    // ws kapatılmış olabilir
  }
}

function _killStream(ws) {
  const proc = ACTIVE.get(ws);
  if (proc) {
    try { proc.kill('SIGKILL'); } catch {}
    ACTIVE.delete(ws);
  }
}

module.exports = { handleStreamConnection };
