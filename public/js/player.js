'use strict';

/**
 * TeslaPlayer V4 (JSMpeg Edition)
 * Rebuilt from scratch using JSMpeg for 100% Canvas & AudioContext compatibility.
 * Bypasses all complex WebCodecs and container restrictions.
 */

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas       = document.getElementById(canvasId);
    this.spinnerId    = opts.spinnerId    || 'spinner';
    this.containerId  = opts.containerId  || 'player-area';
    this.container    = document.getElementById(this.containerId);

    this.isPlaying    = false;
    this.currentChannel = null;
    
    // Internal JSMpeg instance
    this.mpegPlayer = null;
    
    // For backwards app.js compatibility
    this._dummyVideo  = document.createElement('video');
    this._dummyTimer  = null;
  }

  get video() { return this._dummyVideo; }
  get hasActiveSource() { return !!this.mpegPlayer; }

  async load(channel, opts = {}) {
    const silentError  = !!opts.silentError;
    const throwOnError = !!opts.throwOnError;

    this.stop();
    this.currentChannel = channel;
    
    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      this._startJsmpeg(channel);
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

  _startJsmpeg(channel) {
    const rawUrl = channel.ytUrl || channel.url;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}`;

    if (this.mpegPlayer) {
      this.mpegPlayer.destroy();
    }

    this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
      canvas: this.canvas,
      audio: true,
      video: true,
      autoplay: true,
      audioBufferSize: 512 * 1024,
      onPlay: () => {
        this.isPlaying = true;
      },
      onPause: () => {
        this.isPlaying = false;
      }
    });

    this.isPlaying = true;

    // Fake timeline for app.js progress bar
    if (this._dummyTimer) clearInterval(this._dummyTimer);
    this._dummyTimer = setInterval(() => {
        if (this.mpegPlayer) {
            this._dummyVideo.currentTime = this.mpegPlayer.currentTime || 0;
            Object.defineProperty(this._dummyVideo, 'duration', { value: this._dummyVideo.currentTime + 3600, configurable: true }); 
        }
    }, 50);
  }

  stop() {
    if (this._dummyTimer) {
      clearInterval(this._dummyTimer);
      this._dummyTimer = null;
    }

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

  _showError(c) {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);color:#fff;display:flex;align-items:center;justify-content:center;z-index:99;font-family:sans-serif;';
    errDiv.innerHTML = `<div><b>⚠️ Bağlantı Hatası</b><br>${c?.name || ''} yüklenemedi.</div>`;
    this.container?.appendChild(errDiv);
    setTimeout(() => { if (errDiv.parentNode) errDiv.remove(); }, 3000);
  }

  togglePlay() {
    if (!this.mpegPlayer) return;
    if (this.isPlaying) {
      this.mpegPlayer.pause();
    } else {
      this.mpegPlayer.play();
    }
  }

  toggleMute() { 
    if (!this.mpegPlayer || !this.mpegPlayer.audioOut) return false;
    const isMuted = this.mpegPlayer.audioOut.unlocked ? this.mpegPlayer.volume === 0 : false;
    
    if (isMuted) {
      this.mpegPlayer.volume = this._lastVol || 1;
    } else {
      this._lastVol = this.mpegPlayer.volume;
      this.mpegPlayer.volume = 0;
    }
    
    const newMuted = this.mpegPlayer.volume === 0;
    this._dummyVideo.muted = newMuted;
    return newMuted;
  }

  setVolume(v) { 
    if (!this.mpegPlayer) return;
    this.mpegPlayer.volume = v;
    this._dummyVideo.volume = v;
  }

  get paused() { return !this.isPlaying; }
}

window.TeslaPlayer = TeslaPlayer;
