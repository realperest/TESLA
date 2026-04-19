/**
 * Açıl Susam — TeslaPlayer V2 (Stable Clean Edition)
 * Versiyon: 260419.0020
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

    this._worker      = null;
    this._audio       = null;
    this._audioHls    = null;
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
        this._startAudio(channel);
        this._startSyncLoop();
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

  _startAudio(channel) {
    this._stopAudio();
    const audioUrl = channel.ytUrl
      ? `/stream/audio?url=${encodeURIComponent(channel.ytUrl)}`
      : channel.url;

    this._audio = document.createElement('audio');
    this._audio.volume = 1;
    this._audio.crossOrigin = 'anonymous';

    if (!channel.ytUrl && (audioUrl.includes('.m3u8') || channel.isHls)) {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        this._audioHls = new Hls({ enableWorker: true });
        this._audioHls.loadSource(audioUrl);
        this._audioHls.attachMedia(this._audio);
        this._audioHls.on(Hls.Events.MANIFEST_PARSED, () => this._audio.play());
      } else {
        this._audio.src = audioUrl;
        this._audio.play();
      }
    } else {
      this._audio.src = audioUrl;
      this._audio.play();
    }
  }

  _stopAudio() {
    if (this._audioHls) { this._audioHls.destroy(); this._audioHls = null; }
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio.remove(); }
    this._audio = null;
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

    // Canvas'ı manuel temizle (Eğer transfer edilmediyse)
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

  // UI Event Handlers
  togglePlay() {
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
