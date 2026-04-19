'use strict';

/**
 * Tesla WebCodecs Worker V2 (OffscreenCanvas Edition)
 * 
 * Sorumluluklar:
 * 1. OffscreenCanvas kontrolünü teslim almak ve GPU üzerinden çizim yapmak.
 * 2. VideoDecoder kullanarak H.264 paketlerini decode etmek.
 * 3. Master Clock (PTS) senkronizasyonu ile kareleri sese göre hizalamak.
 * 4. UI Thread'den bağımsız çalışarak Tesla blokajını bypass etmek.
 */

let decoder = null;
let ws = null;
let frameQueue = []; // { frame: VideoFrame, pts: number }
let lastAudioTime = 0;
let offscreenCanvas = null;
let offscreenCtx = null;

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'start') {
    _cleanup();
    
    // Canvas transferi yapıldıysa sakla
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
      
      if (frameQueue.length > 60) {
        const old = frameQueue.shift();
        old.frame.close();
      }
    },
    error: (e) => {
      self.postMessage({ type: 'error', message: 'VideoDecoder hatası: ' + e.message });
    }
  });

  decoder.configure({
    codec: 'avc1.42E029', // H.264 Baseline Profile
    optimizeForLatency: true
  });
}

function _connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => self.postMessage({ type: 'ready' });

  ws.onmessage = (e) => {
    const data = e.data;
    if (!data || data.byteLength < 9) return;

    const view = new DataView(data);
    const msgType = view.getUint8(0);

    if (msgType === 0x01) {
      // Video Packet: [Type:1] [PTS:8] [H264-Payload]
      const pts = Number(view.getBigUint64(1, true));
      const payload = data.slice(9);

      if (decoder && decoder.state === 'configured') {
        const chunk = new EncodedVideoChunk({
          type: (new Uint8Array(payload)[4] & 0x1F) === 5 ? 'key' : 'delta',
          timestamp: pts * 1000,
          data: payload
        });
        decoder.decode(chunk);
      }
    } else if (msgType === 0x02) {
      // Audio Packet: [Type:1] [MP3-Payload]
      const payload = data.slice(1);
      self.postMessage({ type: 'audio', chunk: payload }, [payload]);
    }
  };

  ws.onerror = () => self.postMessage({ type: 'error', message: 'WebSocket bağlantı hatası' });
  ws.onclose = () => { _cleanup(); self.postMessage({ type: 'closed' }); };
}

function _renderBestFrame() {
  if (frameQueue.length === 0 || !offscreenCtx) return;

  let bestIdx = -1;
  const target = lastAudioTime;

  for (let i = 0; i < frameQueue.length; i++) {
    if (frameQueue[i].pts <= target) {
      bestIdx = i;
    } else {
      break;
    }
  }

  if (bestIdx !== -1) {
    for (let i = 0; i < bestIdx; i++) {
      frameQueue.shift().frame.close();
    }

    const item = frameQueue.shift();
    
    // OFFSCREEN RENDERING: UI thread'den tamamen izole çizim
    if (offscreenCanvas.width !== item.frame.displayWidth || offscreenCanvas.height !== item.frame.displayHeight) {
      offscreenCanvas.width = item.frame.displayWidth;
      offscreenCanvas.height = item.frame.displayHeight;
    }

    offscreenCtx.drawImage(item.frame, 0, 0);

    // Mikro-gürültü (Hheuristic bypass): Tesla analiz motorunu şaşırtmak için binde bir şeffaflıkta 1px nokta
    offscreenCtx.globalAlpha = 0.01;
    offscreenCtx.fillStyle = '#ffffff';
    offscreenCtx.fillRect(Math.random() * offscreenCanvas.width, Math.random() * offscreenCanvas.height, 1, 1);
    offscreenCtx.globalAlpha = 1.0;

    item.frame.close();
  }
}

function _cleanup() {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (decoder) { try { decoder.close(); } catch {} decoder = null; }
  frameQueue.forEach(item => item.frame.close());
  frameQueue = [];
}
