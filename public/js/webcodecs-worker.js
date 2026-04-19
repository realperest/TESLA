/**
 * WebCodecs Stream Worker
 *
 * Sunucu → istemci mesaj protokolü (H.264 modu):
 *   Byte 0 = 0x07 → raw SPS NAL (start code olmadan)
 *   Byte 0 = 0x08 → raw PPS NAL (start code olmadan)
 *   Byte 0 = 0x01 → keyframe   (IDR) — AVCC formatı (4-byte length + raw NAL)
 *   Byte 0 = 0x00 → delta frame       — AVCC formatı
 *   Header byte 1-8 (sadece frame mesajlarında): timestamp microsaniye LE
 *
 * SPS + PPS gelince AVCC DecoderConfigurationRecord oluşturulur ve
 * VideoDecoder description ile konfigure edilir.
 *
 * MJPEG modu:
 *   Byte 0 = 0xFF → JPEG frame (byte 1'den itibaren raw JPEG)
 *
 * Ana thread → Worker:
 *   { type: 'start', wsUrl, mode }
 *   { type: 'stop' }
 *
 * Worker → Ana thread:
 *   { type: 'frame', bitmap }   — Transferable ImageBitmap
 *   { type: 'ready', mode }
 *   { type: 'closed' }
 *   { type: 'error', message }
 */

'use strict';

let ws      = null;
let decoder = null;
let spsRaw  = null; // Uint8Array, start code olmadan
let ppsRaw  = null; // Uint8Array, start code olmadan

// ─────────────────────────────────────────────────────────────────────────────
// Ana thread mesajları
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'start') {
    _cleanup();
    _connect(msg.wsUrl, 'h264');
    return;
  }
  if (msg.type === 'stop') {
    _cleanup();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────────────────────

function _connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = function () {
    self.postMessage({ type: 'ready', mode: 'h264' });
  };

  ws.onmessage = _onH264;

  ws.onerror = function () {
    self.postMessage({ type: 'error', message: 'WebSocket bağlantı hatası' });
  };

  ws.onclose = function () {
    _cleanup();
    self.postMessage({ type: 'closed' });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H.264 mesaj işleme
// ─────────────────────────────────────────────────────────────────────────────

function _onH264(e) {
  const buf = e.data;
  if (!buf || buf.byteLength < 1) return;

  const msgType = new Uint8Array(buf, 0, 1)[0];

  // SPS mesajı
  if (msgType === 0x07) {
    spsRaw = new Uint8Array(buf.slice(1));
    return;
  }

  // PPS mesajı — her iki NAL hazırsa decoder'ı configure et
  if (msgType === 0x08) {
    ppsRaw = new Uint8Array(buf.slice(1));
    if (spsRaw) _configureDecoder(spsRaw, ppsRaw);
    return;
  }

  // Frame mesajı (0x00 veya 0x01)
  if (msgType !== 0x00 && msgType !== 0x01) return;
  if (buf.byteLength < 10) return; // header 9 byte + en az 1 byte data

  if (!decoder || decoder.state === 'configured' === false) return;

  const isKey = msgType === 0x01;
  const view  = new DataView(buf);
  const tsUs  = Number(view.getBigUint64(1, true)); // byte 1-8, LE
  const avcc  = buf.slice(9); // AVCC formatında NAL data

  // Backpressure kontrolü: kuyruk doluysa delta frame'leri at
  if (decoder.decodeQueueSize > 8 && !isKey) return;

  try {
    decoder.decode(new EncodedVideoChunk({
      type      : isKey ? 'key' : 'delta',
      timestamp : tsUs,
      data      : avcc,
    }));
  } catch (err) {
    // Decoder hata verdiyse keyframe bekle
    if (isKey && spsRaw && ppsRaw) {
      try { decoder.close(); } catch {}
      decoder = null;
      _configureDecoder(spsRaw, ppsRaw);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoDecoder konfigürasyonu — AVCC description tabanlı
// ─────────────────────────────────────────────────────────────────────────────

function _configureDecoder(sps, pps) {
  if (decoder) {
    try { decoder.close(); } catch {}
    decoder = null;
  }

  // AVCC DecoderConfigurationRecord oluştur
  const description = _buildAVCC(sps, pps);

  // codec string: avc1.PPCCLL (profile, compat, level hex)
  const codec = 'avc1.' +
    _hex(sps[1]) + _hex(sps[2]) + _hex(sps[3]);

  decoder = new VideoDecoder({
    output: function (frame) {
      try {
        const ofc = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
        ofc.getContext('2d').drawImage(frame, 0, 0);
        frame.close();
        const bitmap = ofc.transferToImageBitmap();
        self.postMessage({ type: 'frame', bitmap }, [bitmap]);
      } catch (err) {
        try { frame.close(); } catch {}
        self.postMessage({ type: 'error', message: 'Frame render: ' + err.message });
      }
    },
    error: function (err) {
      self.postMessage({ type: 'error', message: 'VideoDecoder: ' + err.message });
    },
  });

  try {
    decoder.configure({
      codec,
      description,
      hardwareAcceleration : 'prefer-hardware',
      optimizeForLatency   : true,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: 'Decoder configure: ' + err.message });
    try { decoder.close(); } catch {}
    decoder = null;
  }
}

/**
 * SPS + PPS byte dizilerinden AVCC DecoderConfigurationRecord oluşturur.
 * Her iki dizi de start code OLMADAN ham NAL verisi içermeli.
 * Returns: ArrayBuffer
 */
function _buildAVCC(sps, pps) {
  const size = 11 + sps.length + pps.length;
  const buf  = new Uint8Array(size);
  let i = 0;
  buf[i++] = 1;          // configurationVersion
  buf[i++] = sps[1];     // AVCProfileIndication
  buf[i++] = sps[2];     // profile_compatibility
  buf[i++] = sps[3];     // AVCLevelIndication
  buf[i++] = 0xFF;       // lengthSizeMinusOne = 3 → 4-byte length
  buf[i++] = 0xE1;       // numSequenceParameterSets = 1
  buf[i++] = (sps.length >> 8) & 0xFF;
  buf[i++] = sps.length  & 0xFF;
  buf.set(sps, i); i += sps.length;
  buf[i++] = 1;          // numPictureParameterSets
  buf[i++] = (pps.length >> 8) & 0xFF;
  buf[i++] = pps.length  & 0xFF;
  buf.set(pps, i);
  return buf.buffer;
}

function _hex(n) {
  return (n & 0xFF).toString(16).padStart(2, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// MJPEG
// ─────────────────────────────────────────────────────────────────────────────

function _onMjpeg(e) {
  const buf = e.data;
  if (!buf || buf.byteLength < 2) return;

  const first = new Uint8Array(buf, 0, 1)[0];
  if (first !== 0xFF) return;

  const jpegData = buf.slice(1);
  const blob = new Blob([jpegData], { type: 'image/jpeg' });

  createImageBitmap(blob).then(function (bitmap) {
    self.postMessage({ type: 'frame', bitmap }, [bitmap]);
  }).catch(function () {});
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
  spsRaw = null;
  ppsRaw = null;
}
