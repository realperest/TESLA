'use strict';

let ws = null;

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'start') { _cleanup(); _connect(msg.wsUrl); return; }
  if (msg.type === 'stop')  { _cleanup(); }
};

function _connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = function () {
    self.postMessage({ type: 'ready' });
  };

  ws.onmessage = function (e) {
    const data = e.data;
    if (!data || data.byteLength < 2) return;

    const view     = new Uint8Array(data);
    const msgType  = view[0];
    const payload  = data.slice(1);

    if (msgType === 0x01) {
      // Video frame: JPEG → ImageBitmap
      createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
        .then(function (bitmap) {
          self.postMessage({ type: 'frame', bitmap }, [bitmap]);
        })
        .catch(function () {});
      return;
    }

    if (msgType === 0x02) {
      // Ses chunk: MP3 verisi → ana thread'e ilet
      self.postMessage({ type: 'audio', chunk: payload }, [payload]);
      return;
    }
  };

  ws.onerror = function () {
    self.postMessage({ type: 'error', message: 'WebSocket bağlantı hatası' });
  };

  ws.onclose = function () {
    _cleanup();
    self.postMessage({ type: 'closed' });
  };
}

function _cleanup() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}
