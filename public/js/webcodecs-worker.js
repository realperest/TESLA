/**
 * WebCodecs Stream Worker
 *
 * Ana thread tarafından Worker olarak başlatılır.
 * Sunucudan WebSocket üzerinden gelen H.264 Annex B NAL unit'lerini
 * VideoDecoder (WebCodecs API) ile decode eder ve her frame'i
 * ImageBitmap olarak ana thread'e gönderir.
 *
 * Ana thread canvas 2D ile ImageBitmap'i drawImage() ile çizer.
 * Bu sayede HTMLVideoElement hiç kullanılmaz → Tesla sürüş kısıtlamasını atlatır.
 *
 * MJPEG fallback:
 * VideoDecoder desteklenmiyorsa sunucu MJPEG gönderir,
 * Worker createImageBitmap() ile decode eder ve aynı yolla gönderir.
 *
 * Ana thread mesajları (gelen):
 *   { type: 'start', wsUrl, mode }   — bağlantıyı başlat
 *   { type: 'stop' }                  — bağlantıyı kapat
 *
 * Ana thread mesajları (gönderilen):
 *   { type: 'frame', bitmap }         — her decode edilen kare (Transferable)
 *   { type: 'closed' }                — WebSocket kapandı
 *   { type: 'error', message }        — hata oluştu
 *   { type: 'ready', mode }           — bağlantı kuruldu, hangi mod kullanılıyor
 */

'use strict';

let ws       = null;
let decoder  = null;
let mode     = 'h264'; // 'h264' | 'mjpeg'
let frameTs  = 0;      // monoton timestamp (VideoDecoder için)

// ─────────────────────────────────────────────────────────────────────────────
// Ana thread'den mesaj al
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'start') {
    _cleanup();
    mode = msg.mode || 'h264';

    // VideoDecoder yoksa otomatik MJPEG'e düş
    if (mode === 'h264' && typeof VideoDecoder === 'undefined') {
      mode = 'mjpeg';
    }

    _connect(msg.wsUrl, mode);
    return;
  }

  if (msg.type === 'stop') {
    _cleanup();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket bağlantısı
// ─────────────────────────────────────────────────────────────────────────────

function _connect(wsUrl, streamMode) {
  const url = streamMode === 'mjpeg'
    ? (wsUrl + (wsUrl.includes('?') ? '&' : '?') + 'mode=mjpeg')
    : wsUrl;

  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = function () {
    if (streamMode === 'h264') {
      _initDecoder();
    }
    self.postMessage({ type: 'ready', mode: streamMode });
  };

  ws.onmessage = streamMode === 'h264' ? _onH264Message : _onMjpegMessage;

  ws.onerror = function () {
    self.postMessage({ type: 'error', message: 'WebSocket bağlantı hatası' });
  };

  ws.onclose = function () {
    _cleanup();
    self.postMessage({ type: 'closed' });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H.264 — VideoDecoder
// ─────────────────────────────────────────────────────────────────────────────

function _initDecoder() {
  if (decoder) {
    try { decoder.close(); } catch {}
    decoder = null;
  }

  decoder = new VideoDecoder({
    output: function (frame) {
      // VideoFrame → ImageBitmap → ana thread (zero-copy Transferable)
      createImageBitmap(frame).then(function (bitmap) {
        frame.close();
        self.postMessage({ type: 'frame', bitmap: bitmap }, [bitmap]);
      }).catch(function () {
        frame.close();
      });
    },
    error: function (err) {
      self.postMessage({ type: 'error', message: 'VideoDecoder: ' + err.message });
    },
  });

  decoder.configure({
    codec: 'avc1.42001E',           // H.264 Baseline Level 3.0
    hardwareAcceleration: 'prefer-hardware',
    optimizeForLatency: true,
  });
}

function _onH264Message(e) {
  const buf = e.data;
  if (!buf || buf.byteLength < 10) return;

  const view   = new DataView(buf);
  const isKey  = view.getUint8(0) === 0x01;
  const tsUs   = Number(view.getBigUint64(1, true)); // Little-endian
  const nalBuf = buf.slice(9);

  if (!nalBuf.byteLength) return;

  if (!decoder || decoder.state === 'closed') return;

  // Decoder kuyruğu dolarsa (backpressure) eski frame'leri at
  if (decoder.decodeQueueSize > 10) {
    if (!isKey) return; // keyframe bekle
  }

  try {
    decoder.decode(new EncodedVideoChunk({
      type      : isKey ? 'key' : 'delta',
      timestamp : tsUs,
      data      : nalBuf,
    }));
  } catch (err) {
    // decode hatası genelde codec config uyumsuzluğu; keyframe bekle
    if (isKey) {
      // Decoder'ı sıfırla ve yeniden yapılandır
      try { decoder.close(); } catch {}
      _initDecoder();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MJPEG — createImageBitmap
// ─────────────────────────────────────────────────────────────────────────────

function _onMjpegMessage(e) {
  const buf = e.data;
  if (!buf || buf.byteLength < 2) return;

  const first = new Uint8Array(buf, 0, 1)[0];
  if (first !== 0xFF) return; // MJPEG marker kontrolü

  const jpegData = buf.slice(1);
  const blob = new Blob([jpegData], { type: 'image/jpeg' });

  createImageBitmap(blob).then(function (bitmap) {
    self.postMessage({ type: 'frame', bitmap: bitmap }, [bitmap]);
  }).catch(function () {
    // Hatalı JPEG — atla
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Temizlik
// ─────────────────────────────────────────────────────────────────────────────

function _cleanup() {
  if (decoder) {
    try { decoder.close(); } catch {}
    decoder = null;
  }
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}
