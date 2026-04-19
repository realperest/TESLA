/**
 * Açıl Susam — TeslaPlayer V3 (Multiplex & Stable Edition)
 * Versiyon: 260419.0021
 */

'use strict';

function isTesla() { return /Tesla\//.test(navigator.userAgent); }

function supportsWebCodecs() { 
  return typeof VideoDecoder !== 'undefined' && 
         typeof Worker !== 'undefined' && 
         typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'undefined'; 
}

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas       = document.getElementById(canvasId);
    this.ctx          = this.canvas.getContext('2d');
    this.spinnerId    = opts.spinnerId    || 'spinner';
    this.containerId  = opts.containerId  || 'player-area';
    this.container    = document.getElementById(this.containerId);

    // Audio Elements for MSE
    this._audio             = null;
    this._mediaSource       = null;
    this._sourceBuffer      = null;
    this._sourceBufferReady = false;
    this._audioQueue        = [];

    this._worker      = null;
    this.isPlaying    = false;
    this._wcMode      = false;
    this.currentChannel = null;

    this._syncTimer   = null;
  }

  _startSyncLoop() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => {
      if (this._wcMode && this.isPlaying && this._audio && !this._audio.paused) {
        // Master Clock: Audio currentTime (ms) -> Worker'a gönder
        this._worker?.postMessage({ 
          type: 'sync', 
          currentTime: this._audio.currentTime * 1000 
        });
      }
    }, 16); // ~60fps
  }

  async load(channel) {
    this.stop();
    this.currentChannel = channel;
    
    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      if (isTesla() || supportsWebCodecs()) {
        await this._loadWebCodecs(channel);
      } else {
        await this._loadClassic(channel);
      }
    } catch (err) {
      console.error('[Player] Load Error:', err);
      this._showError(channel);
    } finally {
      if (spinner) spinner.classList.remove('active');
    }
  }

  async _loadWebCodecs(channel) {
    this._wcMode = true;
    const rawUrl = channel.ytUrl || channel.url;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}`;

    this._worker = new Worker('/js/webcodecs-worker.js');
    
    let offscreen = null;
    try { offscreen = this.canvas.transferControlToOffscreen(); } catch (e) {}

    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        this.isPlaying = true;
        this._startSyncLoop();
      } else if (msg.type === 'audio') {
        this._feedAudioChunk(msg.chunk);
      } else if (msg.type === 'error') {
        console.error('[Player/Worker] Error:', msg.message);
      }
    };

    if (offscreen) {
      this._worker.postMessage({ type: 'start', wsUrl, canvas: offscreen }, [offscreen]);
    } else {
      this._worker.postMessage({ type: 'start', wsUrl });
    }

    // Handshake bekle
    return new Promise((res, rej) => {
      const timeout = setTimeout(() => rej('Worker Timeout'), 15000);
      const originalHandler = this._worker.onmessage;
      this._worker.onmessage = (e) => {
        originalHandler(e);
        if (e.data.type === 'ready') { clearTimeout(timeout); res(); }
      };
    });
  }

  _feedAudioChunk(chunk) {
    if (!this._mediaSource) {
      this._mediaSource    = new MediaSource();
      this._audioQueue     = [];
      this._sourceBufferReady = false;

      this._audio          = document.createElement('audio');
      this._audio.src      = URL.createObjectURL(this._mediaSource);
      this._audio.volume   = 1;
      this._audio.autoplay = true;

      this._mediaSource.addEventListener('sourceopen', () => {
        const mime = 'audio/mpeg';
        if (!MediaSource.isTypeSupported(mime)) {
          console.error('[Player] audio/mpeg MediaSource desteklenmiyor!');
          return;
        }
        try {
          this._sourceBuffer = this._mediaSource.addSourceBuffer(mime);
          this._sourceBuffer.mode = 'sequence';
          this._sourceBuffer.addEventListener('updateend', () => this._flushAudioQueue());
          this._sourceBufferReady = true;
          this._flushAudioQueue();
        } catch (e) {
          console.error('[Player] SourceBuffer hatası:', e);
        }
      });

      this._audio.play().catch(() => {});
    }

    this._audioQueue.push(chunk instanceof ArrayBuffer ? chunk : Buffer.from(chunk));
    this._flushAudioQueue();
  }

  _flushAudioQueue() {
    if (!this._sourceBufferReady || !this._sourceBuffer || this._sourceBuffer.updating) return;
    if (!this._audioQueue || this._audioQueue.length === 0) return;
    try {
      this._sourceBuffer.appendBuffer(this._audioQueue.shift());
    } catch (e) {
      // Ignore quota exceeded temporarily
    }
  }

  _stopAudio() {
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio.remove();
      this._audio = null;
    }
    if (this._mediaSource && this._mediaSource.readyState === 'open') {
      try { this._mediaSource.endOfStream(); } catch {}
    }
    this._mediaSource = null;
    this._sourceBuffer = null;
    this._sourceBufferReady = false;
    this._audioQueue = [];
  }

  stop() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    this._syncTimer = null;

    if (this._worker) {
      this._worker.postMessage({ type: 'stop' });
      this._worker.terminate();
    }
    this._worker = null;
    this._stopAudio();
    
    this.isPlaying = false;
    this._wcMode = false;

    if (this.ctx && !this._worker) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _showError(c) {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);color:#fff;display:flex;align-items:center;justify-content:center;z-index:99;font-family:sans-serif;';
    errDiv.innerHTML = `<div><b>⚠️ Bağlantı Hatası</b><br>${c?.name || ''} yüklenemedi.</div>`;
    this.container?.appendChild(errDiv);
    setTimeout(() => errDiv.remove(), 5000);
  }

  togglePlay() {
    // In multiplex mode, pause is tricky since data still arrives from WebSocket.
    // For now, mute audio. True pause would require sending a signal to backend.
    if (this._audio) {
      if (this._audio.paused) { this._audio.play(); this.isPlaying = true; }
      else { this._audio.pause(); this.isPlaying = false; }
    }
  }

  toggleMute() { if (this._audio) return (this._audio.muted = !this._audio.muted); }
  setVolume(v) { if (this._audio) this._audio.volume = v; }
  get paused() { return this._audio ? this._audio.paused : true; }
}

window.TeslaPlayer = TeslaPlayer;
