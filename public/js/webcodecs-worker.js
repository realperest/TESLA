'use strict';

/**
 * Tesla WebCodecs Worker V3 (Multiplex Edition)
 */

let decoder = null;
let audioDecoder = null;
let ws = null;
let frameQueue = []; 
let audioQueue = [];
let lastAudioTime = -1;
let videoPtsOffset = null;
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
  // VIDEO DECODER
  decoder = new VideoDecoder({
    output: (frame) => {
      const rawPts = frame.timestamp / 1000;
      frameQueue.push({ frame, rawPts });
      frameQueue.sort((a, b) => a.rawPts - b.rawPts);
      
      if (frameQueue.length > 50) {
        frameQueue.shift().frame.close();
      }
    },
    error: (e) => {
      console.error('[Worker] Video Decoder Hatası:', e);
    }
  });

  decoder.configure({
    codec: 'avc1.42E01F',
    optimizeForLatency: true
  });

  // AUDIO DECODER
  audioDecoder = new AudioDecoder({
    output: (audioData) => {
      const size = audioData.allocationSize({ planeIndex: 0, format: 'f32-planar' });
      const buffer = new ArrayBuffer(size);
      const f32 = new Float32Array(buffer);
      audioData.copyTo(buffer, { planeIndex: 0, format: 'f32-planar' });
      
      const pcmInfo = {
        sampleRate: audioData.sampleRate,
        numberOfChannels: audioData.numberOfChannels,
        numberOfFrames: audioData.numberOfFrames,
        timestamp: audioData.timestamp / 1000
      };
      
      audioData.close();

      self.postMessage({ type: 'audio-pcm', pcm: buffer, info: pcmInfo }, [buffer]);
    },
    error: (e) => {
      console.error('[Worker] Audio Decoder Hatası:', e);
    }
  });

  audioDecoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2
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
    const type = view.getUint8(0);
    const pts = Number(view.getBigUint64(1, true));
    const payload = data.slice(9);

    if (type === 0x01) { // Video Packet
      if (decoder && decoder.state === 'configured') {
        const nalArray = new Uint8Array(payload);
        const nalType = nalArray[4] & 0x1F; 
        try {
          decoder.decode(new EncodedVideoChunk({
            type: (nalType === 5 || nalType === 7 || nalType === 8) ? 'key' : 'delta',
            timestamp: pts * 1000,
            data: payload
          }));
        } catch (err) {}
      }
    } else if (type === 0x02) { // Audio (ADTS) Packet
      if (audioDecoder && audioDecoder.state === 'configured') {
        try {
          audioDecoder.decode(new EncodedAudioChunk({
            type: 'key', // usually all ADTS chunks can be treated as key frames
            timestamp: pts * 1000,
            data: payload
          }));
        } catch (err) {}
      }
    }
  };

  ws.onclose = () => self.postMessage({ type: 'closed' });
  ws.onerror = (e) => self.postMessage({ type: 'error', message: 'WebSocket Error' });
}

function _renderBestFrame() {
  if (frameQueue.length === 0 || !offscreenCtx) return;

  // Ses henüz başlamamışsa, gelen çerçeveleri doğrudan ekrana bas
  if (lastAudioTime < 0) {
    const item = frameQueue.shift();
    _draw(item.frame);
    item.frame.close();
    return;
  }

  // Ses başladı, video ve ses PTS ofsetini hesapla
  if (videoPtsOffset === null && frameQueue.length > 0) {
    // İlk hesaplama
    videoPtsOffset = frameQueue[0].rawPts - lastAudioTime;
  }

  // Hedef zaman: Sesin güncel süresi üzerine baştaki offseti ekle
  const targetPts = lastAudioTime + (videoPtsOffset || 0);

  // Network lag senaryosu: Video çok geride kaldıysa buffer'ı boşalt
  if (frameQueue[frameQueue.length - 1].rawPts < targetPts - 500) {
    while(frameQueue.length > 5) frameQueue.shift().frame.close();
    return;
  }

  let bestIdx = -1;
  for (let i = 0; i < frameQueue.length; i++) {
    if (frameQueue[i].rawPts <= targetPts) {
      bestIdx = i;
    } else {
      break;
    }
  }

  if (bestIdx !== -1) {
    for (let i = 0; i < bestIdx; i++) frameQueue.shift().frame.close();
    const item = frameQueue.shift();
    _draw(item.frame);
    item.frame.close();
  }
}

function _draw(frame) {
  if (offscreenCanvas.width !== frame.displayWidth) {
    offscreenCanvas.width = frame.displayWidth;
    offscreenCanvas.height = frame.displayHeight;
  }
  offscreenCtx.drawImage(frame, 0, 0);
}

function _cleanup() {
  if (ws) { ws.close(); ws = null; }
  if (decoder) { try { decoder.close(); } catch {} decoder = null; }
  frameQueue.forEach(f => f.frame.close());
  frameQueue = [];
  lastAudioTime = -1;
  videoPtsOffset = null;
}
