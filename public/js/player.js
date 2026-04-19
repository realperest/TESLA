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
      if (!silentError) this._showError(channel, err.message || err.toString());
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

    console.log('[Player] Initializing JSMpeg for:', wsUrl);
    this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
      canvas: this.canvas,
      audio: true,
      video: true,
      autoplay: true,
      disableGl: true, // Absolutely crucial for Tesla D-gear bypass
      audioBufferSize: 1024 * 1024,
      videoBufferSize: 2 * 1024 * 1024, // Increased for stability
      maxAudioLag: 0.3,
      onPlay: () => {
        console.log('[Player] JSMpeg started playing');
        this.isPlaying = true;
        if (this.mpegPlayer && this.mpegPlayer.audioOut) {
          this.mpegPlayer.volume = 1; 
        }
      },
      onPause: () => {
        console.log('[Player] JSMpeg paused');
        this.isPlaying = false;
      },
      onSourceEstablished: () => {
        console.log('[Player] JSMpeg socket connected');
      }
    });

    this.isPlaying = true;
    
    // Periodically check/resume audio context as Tesla browser aggressively suspends it
    if (this._audioRetry) clearInterval(this._audioRetry);
    this._audioRetry = setInterval(() => {
        if (this.mpegPlayer && this.mpegPlayer.audioOut && this.mpegPlayer.audioOut.context) {
            if (this.mpegPlayer.audioOut.context.state === 'suspended') {
                console.log('[Player] Resuming audio context...');
                this.mpegPlayer.audioOut.context.resume();
            }
        }
    }, 2000);

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

  _showError(c, errDetails = '') {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);color:#fff;display:flex;align-items:center;justify-content:center;z-index:99;font-family:sans-serif;';
    errDiv.innerHTML = `<div style="text-align:center;padding:20px;">
        <div style="font-size:24px;margin-bottom:10px;">⚠️ Bağlantı Hatası</div>
        <div style="margin-bottom:15px;">${c?.name || ''} yüklenemedi.</div>
        <div style="color:#ff6b6b;font-size:12px;background:rgba(0,0,0,0.5);padding:10px;border-radius:4px;word-break:break-all;">${errDetails}</div>
        <button onclick="location.reload()" style="margin-top:15px;padding:8px 20px;background:#fff;color:#000;border:none;border-radius:20px;font-weight:bold;cursor:pointer;">Yeniden Dene</button>
    </div>`;
    this.container?.appendChild(errDiv);
  }

  // New helper to force audio unlock from UI
  unlockAudio() {
    if (this.mpegPlayer && this.mpegPlayer.audioOut) {
        console.log('[Player] Attempting manual audio unlock...');
        this.mpegPlayer.audioOut.unlock(() => {
            console.log('[Player] Audio UNLOCKED successfully');
            if (this.mpegPlayer.audioOut.context) {
                this.mpegPlayer.audioOut.context.resume();
            }
        });
    } else {
        // Fallback: Try to resume any context we can find
        const ctx = window.AudioContext || window.webkitAudioContext;
        if (ctx) {
            const tempCtx = new ctx();
            tempCtx.resume();
        }
    }
  }

  // Diagnostic: Play a simple beep to see if AudioContext is alive at all
  testAudio() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, context.currentTime);
        gainNode.gain.setValueAtTime(0.1, context.currentTime);

        oscillator.connect(gainNode);
        gainNode.connect(context.destination);

        oscillator.start();
        setTimeout(() => oscillator.stop(), 500);
        console.log('[Player] Diagnostic beep sent');
        alert('Diagnostic Beep Sent. Did you hear it?');
    } catch (e) {
        console.error('[Player] Diagnostic failed:', e);
        alert('Audio Error: ' + e.message);
    }
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
