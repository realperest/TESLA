'use strict';

/**
 * TeslaPlayer V6 (Hidden HTML5 Video + Canvas Hack)
 * - Sunucuda FFmpeg YOKTUR. CPU kullanımı %0'dır.
 * - MP4 stream doğrudan gizli bir <video> etiketine verilir.
 * - requestAnimationFrame ile gizli videodan Canvas'a kopyalama yapılır.
 */
class TeslaPlayerV6 extends TeslaPlayer {
  constructor(canvasId, opts = {}) {
    super(canvasId, opts);
    this.container = document.getElementById(this.containerId || 'player-area');
    
    // Gizli HTML5 Video Elementi
    this._hiddenVideo = document.createElement('video');
    this._hiddenVideo.setAttribute('playsinline', '');
    this._hiddenVideo.setAttribute('webkit-playsinline', '');
    this._hiddenVideo.crossOrigin = 'anonymous';
    // Görünmez yapmak için:
    this._hiddenVideo.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; z-index:-1;';
    
    // Konteyner olarak yt-player-container'ı seçmeye çalış (daha iyi hizalama için)
    this.playerContainer = document.getElementById('yt-player-container') || this.container;
    
    if (this.playerContainer) {
      this.playerContainer.appendChild(this._hiddenVideo);
    } else {
      document.body.appendChild(this._hiddenVideo);
    }

    this._drawLoop = null;
    
    this._hiddenVideo.addEventListener('play', () => {
      this.isPlaying = true;
      const spinner = document.getElementById(this.spinnerId);
      if (spinner) spinner.classList.remove('active');
      this._startDrawLoop();
    });

    this._hiddenVideo.addEventListener('pause', () => {
      this.isPlaying = false;
      cancelAnimationFrame(this._drawLoop);
    });

    this._hiddenVideo.addEventListener('ended', () => {
      this.isPlaying = false;
      cancelAnimationFrame(this._drawLoop);
    });
    
    // app.js ui senkronizasyonu için mevcut video objesini override ediyoruz
    Object.defineProperty(this, 'video', { get: () => this._hiddenVideo });
  }

  async load(channel, opts = {}) {
    this.stop(true);
    this.currentChannel = channel;
    this.startTime = opts.startTime || 0;
    
    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      this._startPlayback(channel, this.startTime);
      return true;
    } catch (err) {
      console.error('[V6] Load Error:', err);
      if (spinner) spinner.classList.remove('active');
      return false;
    }
  }

  async seek(seconds) {
    if (this._hiddenVideo) {
      // Native seeking: Tarayıcı Range desteği ile sadece o saniyeyi çeker.
      this._hiddenVideo.currentTime = seconds;
    }
  }

  _startPlayback(channel, t = 0) {
    let streamUrl = channel.url;
    
    // Eğer HLS değilse (saf MP4 ise), sunucu üzerinden proxy yapalım (IP yetkilendirmesi için)
    if (!channel.isHls && streamUrl && streamUrl.startsWith('http')) {
      streamUrl = `/proxy/mp4?url=${encodeURIComponent(streamUrl)}`;
    }
    
    // Eğer zaten aynı video yüklüyse sadece süreyi değiştir (re-load yapma)
    if (this._hiddenVideo.src.includes(streamUrl.split('?')[0])) {
      if (t > 0) this._hiddenVideo.currentTime = t;
      this._hiddenVideo.play().catch(e => {});
      return;
    }
    
    this._hiddenVideo.src = streamUrl;
    this._hiddenVideo.load();
    if (t > 0) {
      this._hiddenVideo.currentTime = t;
    }
    this._hiddenVideo.play().catch(e => console.error('[V6] Oynatma hatası:', e));
  }

  _startDrawLoop() {
    const ctx = this.canvas.getContext('2d');
    const draw = () => {
      if (!this._hiddenVideo.paused && !this._hiddenVideo.ended) {
        // Çözünürlüğü Canvas'a uyarla
        if (this.canvas.width !== this._hiddenVideo.videoWidth && this._hiddenVideo.videoWidth > 0) {
          this.canvas.width = this._hiddenVideo.videoWidth;
          this.canvas.height = this._hiddenVideo.videoHeight;
        }
        ctx.drawImage(this._hiddenVideo, 0, 0, this.canvas.width, this.canvas.height);
      }
      this._drawLoop = requestAnimationFrame(draw);
    };
    draw();
  }

  play() {
    if (this._hiddenVideo) {
      this._hiddenVideo.play().catch(e => console.error('[V6] Play error:', e));
    }
  }

  pause() {
    if (this._hiddenVideo) {
      this._hiddenVideo.pause();
    }
  }

  stop(keepOverlay = false) {
    if (this._hiddenVideo) {
      this._hiddenVideo.pause();
      this._hiddenVideo.removeAttribute('src');
      this._hiddenVideo.load();
    }
    cancelAnimationFrame(this._drawLoop);
    this.isPlaying = false;
    if (!keepOverlay) {
      const ctx = this.canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setVolume(v) {
    if (this._hiddenVideo) this._hiddenVideo.volume = v;
  }
}

window.TeslaPlayerV6 = TeslaPlayerV6;
