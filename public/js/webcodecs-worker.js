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
 * Ana thread → Worker:
 *   { type: 'start', wsUrl }
 *   { type: 'stop' }
 *
 * Worker → Ana thread:
 *   { type: 'frame', frame }  — Transferable VideoFrame (ana thread drawImage yapar)
 *   { type: 'ready' }
 *   { type: 'closed' }
 *   { type: 'error', message }
 */

'use strict';

let ws      = null;
let decoder = null;
let spsRaw  = null;
let ppsRaw  = null;

// ─────────────────────────────────────────────────────────────────────────────
// Ana thread mesajları
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'start') {
    _cleanup();
    _connect(msg.wsUrl);
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
    self.postMessage({ type: 'ready' });
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

  if (msgType === 0x07) {
    spsRaw = new Uint8Array(buf.slice(1));
    return;
  }

  if (msgType === 0x08) {
    ppsRaw = new Uint8Array(buf.slice(1));
    if (spsRaw) _configureDecoder(spsRaw, ppsRaw);
    return;
  }

  if (msgType !== 0x00 && msgType !== 0x01) return;
  if (buf.byteLength < 10) return;
  if (!decoder || decoder.state !== 'configured') return;

  const isKey = msgType === 0x01;
  const view  = new DataView(buf);
  const tsUs  = Number(view.getBigUint64(1, true));
  const avcc  = buf.slice(9);

  if (decoder.decodeQueueSize > 8 && !isKey) return;

  try {
    decoder.decode(new EncodedVideoChunk({
      type      : isKey ? 'key' : 'delta',
      timestamp : tsUs,
      data      : avcc,
    }));
  } catch (err) {
    if (isKey && spsRaw && ppsRaw) {
      try { decoder.close(); } catch {}
      decoder = null;
      _configureDecoder(spsRaw, ppsRaw).catch(function () {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoDecoder konfigürasyonu
// ─────────────────────────────────────────────────────────────────────────────

function _configureDecoder(sps, pps) {
  if (decoder) {
    try { decoder.close(); } catch {}
    decoder = null;
  }

  const description = _buildAVCC(sps, pps);
  const codec = 'avc1.' + _hex(sps[1]) + _hex(sps[2]) + _hex(sps[3]);

  decoder = new VideoDecoder({
    output: function (frame) {
      self.postMessage({ type: 'frame', frame }, [frame]);
    },
    error: function (err) {
      self.postMessage({ type: 'error', message: 'VideoDecoder: ' + err.message });
      decoder = null;
    },
  });

  try {
    decoder.configure({
      codec,
      description,
      hardwareAcceleration: 'no-preference',
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: 'Decoder configure: ' + err.message });
    try { decoder.close(); } catch {}
    decoder = null;
  }
}

/**
 * AVCC DecoderConfigurationRecord oluşturur (start code olmadan ham NAL verisi).
 */
function _buildAVCC(sps, pps) {
  const size = 11 + sps.length + pps.length;
  const buf  = new Uint8Array(size);
  let i = 0;
  buf[i++] = 1;
  buf[i++] = sps[1];
  buf[i++] = sps[2];
  buf[i++] = sps[3];
  buf[i++] = 0xFF;
  buf[i++] = 0xE1;
  buf[i++] = (sps.length >> 8) & 0xFF;
  buf[i++] = sps.length  & 0xFF;
  buf.set(sps, i); i += sps.length;
  buf[i++] = 1;
  buf[i++] = (pps.length >> 8) & 0xFF;
  buf[i++] = pps.length  & 0xFF;
  buf.set(pps, i);
  return buf.buffer;
}

function _hex(n) {
  return (n & 0xFF).toString(16).padStart(2, '0');
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
