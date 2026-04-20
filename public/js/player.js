'use strict';

/**
 * TeslaPlayer V5 (Final Stable JSMpeg Edition)
 * Optimized for 100% stealth and stability on Tesla browsers.
 * No WebCodecs, no hardware restrictions - just pure Canvas performance.
 */

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas       = document.getElementById(canvasId);
    this.spinnerId    = opts.spinnerId    || 'spinner';
    this.containerId  = opts.containerId  || 'player-area';
    this.container    = document.getElementById(this.containerId);

    this.isPlaying    = false;
    this.currentChannel = null;
    this.mpegPlayer   = null;
    
    // Virtual video element for app.js UI compatibility
    this._dummyVideo  = document.createElement('video');
    this._dummyTimer  = null;
    this._audioRetry  = null;
  }

  get video() { return this._dummyVideo; }
  get hasActiveSource() { return !!this.mpegPlayer; }

  async load(channel, opts = {}) {
    this.stop();
    this.currentChannel = channel;
    
    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      this._startJsmpeg(channel);
      return true;
    } catch (err) {
      console.error('[Player] Start Error:', err);
      this._showError(channel, err.toString());
      return false;
    } finally {
      if (spinner) spinner.classList.remove('active');
    }
  }

  _startJsmpeg(channel) {
    const rawUrl = channel.ytUrl || channel.url;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}`;

    if (this.mpegPlayer) this.mpegPlayer.destroy();

    this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
      canvas: this.canvas,
      audio: true,
      video: true,
      autoplay: true,
      disableGl: true, // Stealth mode for Tesla
      audioBufferSize: 4 * 1024 * 1024,
      videoBufferSize: 8 * 1024 * 1024,
      maxAudioLag: 3.0, // MAX STABILITY: 3 seconds deep buffer
      onPlay: () => {
        this.isPlaying = true;
        if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
      }
    });

    // Auto-resume AudioContext for Tesla persistence
    this._audioRetry = setInterval(() => {
        const audio = this.mpegPlayer?.audioOut;
        if (audio?.context?.state === 'suspended') audio.context.resume();
    }, 2000);

    // Sync virtual video for HUD progress bars
    this._dummyTimer = setInterval(() => {
        if (this.mpegPlayer) {
          this._dummyVideo.currentTime = this.mpegPlayer.currentTime || 0;
          Object.defineProperty(this._dummyVideo, 'duration', { value: 3600*10, configurable: true });
        }
    }, 100);
  }

  stop() {
    if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
    if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }

    if (this.mpegPlayer) {
      this.mpegPlayer.destroy();
      this.mpegPlayer = null;
    }
    
    this.isPlaying = false;
    this.currentChannel = null;

    try {
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    } catch {}
  }

  unlockAudio() {
    if (this.mpegPlayer?.audioOut) {
        this.mpegPlayer.audioOut.unlock(() => {
            if (this.mpegPlayer.audioOut.context) this.mpegPlayer.audioOut.context.resume();
        });
    }
  }

  togglePlay() {
    if (!this.mpegPlayer) return;
    this.isPlaying ? this.mpegPlayer.pause() : this.mpegPlayer.play();
  }

  toggleMute() { 
    if (!this.mpegPlayer?.audioOut) return false;
    const isMuted = this.mpegPlayer.volume === 0;
    this.mpegPlayer.volume = isMuted ? (this._lastVol || 1) : 0;
    if (!isMuted) this._lastVol = 1;
    return this.mpegPlayer.volume === 0;
  }

  setVolume(v) { 
    if (this.mpegPlayer) this.mpegPlayer.volume = v;
  }

  _showError(c, errDetails = '') {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.85);color:#fff;display:flex;align-items:center;justify-content:center;z-index:99;font-family:sans-serif;backdrop-filter:blur(10px);';
    errDiv.innerHTML = `<div style="text-align:center;padding:20px;">
        <div style="font-size:40px;margin-bottom:20px;">⚠️</div>
        <div style="font-size:20px;margin-bottom:10px;">${c?.name || 'Yayın'} Hazırlanamıyor</div>
        <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-bottom:20px;">${errDetails}</div>
        <button onclick="location.reload()" style="padding:12px 30px;background:#fff;color:#000;border:none;border-radius:30px;font-weight:bold;cursor:pointer;box-shadow:0 10px 20px rgba(0,0,0,0.2);">Yeniden Dene</button>
    </div>`;
    this.container?.appendChild(errDiv);
  }

  get paused() { return !this.isPlaying; }
}

window.TeslaPlayer = TeslaPlayer;
