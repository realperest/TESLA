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

    // Her WebSocket mesajı = 1 tam JPEG frame (FF D8 ... FF D9)
    createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      .then(function (bitmap) {
        self.postMessage({ type: 'frame', bitmap }, [bitmap]);
      })
      .catch(function () {});
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
