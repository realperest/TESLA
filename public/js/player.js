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
    this._startTimeout = null;
    this._pausedAtAbs = 0;
    this._pausedChannel = null;
  }

  get video() { return this._dummyVideo; }
  get hasActiveSource() { return !!this.mpegPlayer; }

  async load(channel, opts = {}) {
    this.stop();
    this.currentChannel = channel;
    this.startTime = opts.startTime || 0;
    this._pausedChannel = null;
    this._pausedAtAbs = 0;
    
    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      this._startJsmpeg(channel, this.startTime);
      // Çok yavaş ağda kullanıcıya sürekli spinner göstermeyelim.
      this._startTimeout = setTimeout(() => {
        if (spinner && spinner.classList.contains('active') && this.isPlaying) {
          spinner.classList.remove('active');
        }
      }, 12000);
      return true;
    } catch (err) {
      console.error('[Player] Start Error:', err);
      this._showError(channel, err.toString());
      if (spinner) spinner.classList.remove('active');
      return false;
    }
  }

  _startJsmpeg(channel, t = 0) {
    const rawUrl = channel.ytUrl || channel.url;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}&t=${t}`;

    if (this.mpegPlayer) this.mpegPlayer.destroy();

    this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
      canvas: this.canvas,
      audio: true,
      video: true,
      autoplay: true,
      disableGl: true, // Stealth mode for Tesla
      audioBufferSize: 8 * 1024 * 1024,
      videoBufferSize: 20 * 1024 * 1024,
      maxAudioLag: 1.8,
      onPlay: () => {
        this.isPlaying = true;
        if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
        const spinner = document.getElementById(this.spinnerId);
        if (spinner) spinner.classList.remove('active');
      }
    });

    // Auto-resume AudioContext for Tesla persistence
    this._audioRetry = setInterval(() => {
        const audio = this.mpegPlayer?.audioOut;
        if (audio?.context?.state === 'suspended') audio.context.resume();
    }, 2000);

    // Sync virtual video for HUD progress bars with OFFSET support
    this._dummyTimer = setInterval(() => {
        if (this.mpegPlayer) {
          // absolute position = current offset + stream time
          const abs = (this.mpegPlayer.currentTime || 0) + (this.startTime || 0);
          this._dummyVideo.currentTime = abs;
          
          const dur = channel.duration || 3600; 
          Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
        }
    }, 100);
  }

  stop() {
    if (this._startTimeout) { clearTimeout(this._startTimeout); this._startTimeout = null; }
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

  seekTo(seconds) {
    if (!this.currentChannel) return;
    const newTime = Math.max(0, seconds);
    console.log(`[Player] Seeking to absolute: ${newTime}s`);
    this.load(this.currentChannel, { startTime: newTime });
  }

  seekRelative(seconds) {
    if (!this.mpegPlayer || !this.currentChannel) return;
    const current = this.mpegPlayer.currentTime || 0;
    this.seekTo(current + seconds);
  }

  togglePlay() {
    // Hard pause: akışı gerçekten durdur, resume'da aynı saniyeden yeniden bağlan.
    if (this.mpegPlayer && this.isPlaying) {
      this._pausedAtAbs = Math.max(0, (this.startTime || 0) + Number(this.mpegPlayer.currentTime || 0));
      this._pausedChannel = this.currentChannel;
      if (this._startTimeout) { clearTimeout(this._startTimeout); this._startTimeout = null; }
      if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
      if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }
      try { this.mpegPlayer.destroy(); } catch {}
      this.mpegPlayer = null;
      this.isPlaying = false;
      return;
    }

    if (!this.mpegPlayer) {
      const ch = this._pausedChannel || this.currentChannel;
      const t = this._pausedAtAbs || (this.startTime || 0);
      if (ch) this.load(ch, { startTime: t });
    }
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

  getBufferedEnd() {
    if (!this.mpegPlayer) return 0;
    const current = Number(this.mpegPlayer.currentTime || 0);
    const dur = Number(this._dummyVideo.duration || 0);
    const ahead = 35; // Hedef: daha agresif prebuffer hissi
    const end = current + ahead;
    return dur > 0 ? Math.min(dur, end) : end;
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
