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
    this._ctx         = null;
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
    this._dummyVideo  = document.createElement('video');
  }

  // Backwards compatibility for app.js UI logic
  get video() { return this._audio || this._dummyVideo; }
  get hasActiveSource() { return !!this._worker || !!this._audio; }

  _startSyncLoop() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => {
      if (this._wcMode && this.isPlaying && this._audioCtx && this._audioCtx.state === 'running') {
        // Master Clock: AudioContext currentTime (ms) -> Worker'a gönder
        this._worker?.postMessage({ 
          type: 'sync', 
          currentTime: this._audioCtx.currentTime * 1000 
        });
        
        // Populate dummy video's timeline to keep app.js happy
        if (this._dummyVideo) {
          try {
            // we don't have exact duration easily available for live streams, just fake it increasing
            this._dummyVideo.currentTime = this._audioCtx.currentTime;
            Object.defineProperty(this._dummyVideo, 'duration', { value: this._audioCtx.currentTime + 3600, configurable: true }); 
          } catch(e) {}
        }
      }
    }, 16); // ~60fps
  }

  async load(channel, opts = {}) {
    const silentError  = !!opts.silentError;
    const throwOnError = !!opts.throwOnError;

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
      return true;
    } catch (err) {
      console.error('[Player] Load Error:', err);
      if (!silentError) this._showError(channel);
      if (throwOnError) throw err;
      return false;
    } finally {
      if (spinner) spinner.classList.remove('active');
    }
  }

  async _loadClassic(channel) {
    throw new Error('Fallback _loadClassic not implemented in V3. Device must support WebCodecs.');
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
      } else if (msg.type === 'audio-pcm') {
        this._handlePcmAudio(msg.pcm, msg.info);
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

  _handlePcmAudio(pcmBuffer, info) {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this._nextAudioTime = this._audioCtx.currentTime + 0.1; // 100ms buffering
    }

    if (this._audioCtx.state === 'suspended' && this.isPlaying) {
      this._audioCtx.resume();
    }

    const { sampleRate, numberOfChannels, numberOfFrames } = info;
    const f32 = new Float32Array(pcmBuffer);
    
    const audioBuffer = this._audioCtx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
    
    // Copy planar data to audio buffer channels
    for (let c = 0; c < numberOfChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      const offset = c * numberOfFrames;
      for (let i = 0; i < numberOfFrames; i++) {
        channelData[i] = f32[offset + i];
      }
    }

    const source = this._audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    // Gain node for volume/mute control
    if (!this._gainNode) {
      this._gainNode = this._audioCtx.createGain();
      this._gainNode.connect(this._audioCtx.destination);
    }
    source.connect(this._gainNode);

    // Sync safety: if we fell too far behind, jump forward
    if (this._nextAudioTime < this._audioCtx.currentTime) {
      this._nextAudioTime = this._audioCtx.currentTime + 0.05;
    }

    source.start(this._nextAudioTime);
    this._nextAudioTime += audioBuffer.duration;
  }

  _stopAudio() {
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._gainNode = null;
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

    if (!this._worker) {
      try {
        if (!this._ctx) this._ctx = this.canvas.getContext('2d');
        if (this._ctx) {
          this._ctx.fillStyle = '#000';
          this._ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
      } catch {}
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
    if (this._audioCtx) {
      if (this._audioCtx.state === 'running') { this._audioCtx.suspend(); this.isPlaying = false; }
      else { this._audioCtx.resume(); this.isPlaying = true; }
    }
  }

  toggleMute() { 
    this._muted = !this._muted;
    if (this._gainNode) {
      this._gainNode.gain.value = this._muted ? 0 : (this._volume !== undefined ? this._volume : 1);
    }
    // Also sync the dummy video for UI updates
    if (this._dummyVideo) this._dummyVideo.muted = this._muted;
    return this._muted;
  }

  setVolume(v) { 
    this._volume = v;
    if (this._gainNode && !this._muted) {
      this._gainNode.gain.value = v; 
    }
    if (this._dummyVideo) this._dummyVideo.volume = v;
  }

  get paused() { return this._audioCtx ? this._audioCtx.state !== 'running' : true; }
}

window.TeslaPlayer = TeslaPlayer;
