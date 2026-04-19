'use strict';

/**
 * Tesla WebCodecs Worker V2 (Clean Edition)
 */

let decoder = null;
let ws = null;
let frameQueue = []; 
let lastAudioTime = 0;
let offscreenCanvas = null;
let offscreenCtx = null;

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'start') {
    _cleanup();
    if (msg.canvas) {
      offscreenCanvas = msg.canvas;
      offscreenCtx = offscreenCanvas.getContext('2d');
    }
    _initDecoder();
    _connect(msg.wsUrl);
  } else if (msg.type === 'stop') {
    _cleanup();
  } else if (msg.type === 'sync') {
    lastAudioTime = msg.currentTime;
    _renderBestFrame();
  }
};

function _initDecoder() {
  decoder = new VideoDecoder({
    output: (frame) => {
      const pts = frame.timestamp / 1000;
      frameQueue.push({ frame, pts });
      frameQueue.sort((a, b) => a.pts - b.pts);
      if (frameQueue.length > 50) frameQueue.shift().frame.close();
    },
    error: (e) => console.error('[Worker] Decoder Error:', e)
  });
  decoder.configure({ codec: 'avc1.42E029', optimizeForLatency: true });
}

function _connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => self.postMessage({ type: 'ready' });
  ws.onmessage = (e) => {
    const data = e.data;
    const view = new DataView(data);
    if (view.getUint8(0) === 0x01) { // Video Only
      const pts = Number(view.getBigUint64(1, true));
      const payload = data.slice(9);
      if (decoder && decoder.state === 'configured') {
        decoder.decode(new EncodedVideoChunk({
          type: (new Uint8Array(payload)[4] & 0x1F) === 5 ? 'key' : 'delta',
          timestamp: pts * 1000,
          data: payload
        }));
      }
    }
  };
}

function _renderBestFrame() {
  if (frameQueue.length === 0 || !offscreenCtx) return;
  let bestIdx = -1;
  for (let i = 0; i < frameQueue.length; i++) {
    if (frameQueue[i].pts <= lastAudioTime) bestIdx = i;
    else break;
  }
  if (bestIdx !== -1) {
    for (let i = 0; i < bestIdx; i++) frameQueue.shift().frame.close();
    const item = frameQueue.shift();
    if (offscreenCanvas.width !== item.frame.displayWidth) {
      offscreenCanvas.width = item.frame.displayWidth;
      offscreenCanvas.height = item.frame.displayHeight;
    }
    offscreenCtx.drawImage(item.frame, 0, 0);
    item.frame.close();
  }
}

function _cleanup() {
  if (ws) ws.close();
  if (decoder) decoder.close();
  frameQueue.forEach(i => i.frame.close());
  frameQueue = [];
}
