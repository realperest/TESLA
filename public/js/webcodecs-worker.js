'use strict';

/**
 * Tesla WebCodecs Worker V2 (Stable Edition)
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
      // Küçüktün büyüğe sırala
      frameQueue.sort((a, b) => a.pts - b.pts);
      
      // Buffer çok şişerse temizle (Gecikmeyi önlemek için)
      if (frameQueue.length > 45) {
        frameQueue.shift().frame.close();
      }
    },
    error: (e) => {
      console.error('[Worker] Decoder Hatası:', e);
      self.postMessage({ type: 'error', message: 'Decoder: ' + e.message });
    }
  });

  decoder.configure({
    codec: 'avc1.42E01F', // Daha geniş uyumluluk için Level 3.1 Baseline
    optimizeForLatency: true
  });
}

function _connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  
  ws.onopen = () => self.postMessage({ type: 'ready' });
  
  ws.onmessage = (e) => {
    const data = e.data;
    if (data.byteLength < 9) return;

    const view = new DataView(data);
    if (view.getUint8(0) === 0x01) { // Video Packet
      const pts = Number(view.getBigUint64(1, true));
      const payload = data.slice(9);
      
      if (decoder && decoder.state === 'configured') {
        const nalArray = new Uint8Array(payload);
        // NAL Unit Type kontrolü (bit 0-4)
        const nalType = nalArray[4] & 0x1F; 
        
        try {
          decoder.decode(new EncodedVideoChunk({
            type: (nalType === 5) ? 'key' : 'delta',
            timestamp: pts * 1000,
            data: payload
          }));
        } catch (err) {
          console.warn('[Worker] Decode failed:', err.message);
        }
      }
    }
  };

  ws.onclose = () => self.postMessage({ type: 'closed' });
  ws.onerror = (e) => self.postMessage({ type: 'error', message: 'WebSocket Error' });
}

function _renderBestFrame() {
  if (frameQueue.length === 0 || !offscreenCtx) return;

  // Ses zamanına en uygun frame'i bul
  let bestIdx = -1;
  const target = lastAudioTime;

  // Ses çok ilerlemişse (Network lag), eski frame'leri hızlıca boşalt
  if (frameQueue[frameQueue.length - 1].pts < target - 500) {
    // 500ms'den fazla gerideysek buffer'ı temizle ki güncele yetişelim
    while(frameQueue.length > 5) frameQueue.shift().frame.close();
    return;
  }

  for (let i = 0; i < frameQueue.length; i++) {
    if (frameQueue[i].pts <= target) {
      bestIdx = i;
    } else {
      break;
    }
  }

  if (bestIdx !== -1) {
    // Seçilen frame'den öncekileri at
    for (let i = 0; i < bestIdx; i++) {
      frameQueue.shift().frame.close();
    }
    const item = frameQueue.shift();
    
    // Canvas boyutu kontrol
    if (offscreenCanvas.width !== item.frame.displayWidth) {
      offscreenCanvas.width = item.frame.displayWidth;
      offscreenCanvas.height = item.frame.displayHeight;
    }

    offscreenCtx.drawImage(item.frame, 0, 0);
    item.frame.close();
  }
}

function _cleanup() {
  if (ws) { ws.close(); ws = null; }
  if (decoder) { 
    try { decoder.close(); } catch {} 
    decoder = null; 
  }
  frameQueue.forEach(f => f.frame.close());
  frameQueue = [];
}
