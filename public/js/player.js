/**
 * Açıl Susam — TeslaPlayer V2 (Clean Edition)
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

    this.video        = document.createElement('video');
    this.video.muted  = false;
    this.video.playsInline = true;

    this._worker      = null;
    this._audio       = null;
    this._audioHls    = null;
    this.isPlaying    = false;
    this._wcMode      = false;

    this._syncTimer   = null;
    this._startSyncLoop();
  }

  _startSyncLoop() {
    const sync = () => {
      if (this._wcMode && this.isPlaying && this._audio && !this._audio.paused) {
        // Master Clock: Audio currentTime (ms) -> Worker'a gönder
        this._worker?.postMessage({ type: 'sync', currentTime: this._audio.currentTime * 1000 });
      }
      this._syncTimer = setTimeout(sync, 16);
    };
    sync();
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
      if (spinner) spinner.classList.remove('active');
    } catch (err) {
      console.error('[Player] Error:', err);
      if (spinner) spinner.classList.remove('active');
      this._showError(channel);
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
      if (e.data.type === 'ready') {
        this.isPlaying = true;
        this._startAudio(channel);
      }
    };

    if (offscreen) {
      this._worker.postMessage({ type: 'start', wsUrl, canvas: offscreen }, [offscreen]);
    } else {
      this._worker.postMessage({ type: 'start', wsUrl });
    }

    // Ready bekle
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej('Timeout'), 10000);
      const prev = this._worker.onmessage;
      this._worker.onmessage = (e) => {
        prev(e);
        if (e.data.type === 'ready') { clearTimeout(t); res(); }
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
    this._audio.autoplay = true;

    if (!channel.ytUrl && (audioUrl.includes('.m3u8') || channel.isHls)) {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        this._audioHls = new Hls({ enableWorker: true });
        this._audioHls.loadSource(audioUrl);
        this._audioHls.attachMedia(this._audio);
      }
    } else {
      this._audio.src = audioUrl;
    }
    this._audio.play().catch(() => {});
  }

  _stopAudio() {
    if (this._audioHls) this._audioHls.destroy();
    if (this._audio) { this._audio.pause(); this._audio.src = ''; }
    this._audio = null;
    this._audioHls = null;
  }

  stop() {
    if (this._worker) this._worker.terminate();
    this._worker = null;
    this._stopAudio();
    this.isPlaying = false;
    this._wcMode = false;
    if (this.ctx && !this.canvas.transferControlToOffscreen) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _showError(c) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;z-index:99';
    el.innerHTML = `Yüklenemedi: ${c?.name || ''}`;
    this.container?.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // UI uyumluluk metodları
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
