'use strict';

/**
 * TeslaPlayer V7 (Direct HTML5 Video / Native Decoder)
 * - Canvas tamamen devre dışı bırakılır, saf HTML5 <video> etiketi kullanılır.
 * - Amaç: Tesla tarayıcısının normal <video> etiketini tam ekranda veya hareket halindeyken engelleyip engellemediğini test etmek.
 * - Sunucu yükü %0'dır. En yüksek kalite ve 60fps akıcılık sağlar.
 */
class TeslaPlayerV7 extends TeslaPlayer {
  constructor(canvasId, opts = {}) {
    super(canvasId, opts);
    this.container = document.getElementById(this.containerId || 'player-area');
    
    // Canvas'ı gizle
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }

    // Görünür HTML5 Video Elementi
    this._realVideo = document.createElement('video');
    this._realVideo.setAttribute('playsinline', '');
    this._realVideo.setAttribute('webkit-playsinline', '');
    this._realVideo.crossOrigin = 'anonymous';
    // Canvas'ın bulunduğu alanı kaplaması için stillendir
    this._realVideo.style.cssText = 'width:100%; height:100%; object-fit:contain; background:#000;';
    
    if (this.container) {
      // Canvas'ın önüne ekleyelim
      this.container.insertBefore(this._realVideo, this.canvas);
    } else {
      document.body.appendChild(this._realVideo);
    }
    
    this._realVideo.addEventListener('play', () => {
      this.isPlaying = true;
      const spinner = document.getElementById(this.spinnerId);
      if (spinner) spinner.classList.remove('active');
    });

    this._realVideo.addEventListener('pause', () => {
      this.isPlaying = false;
    });

    this._realVideo.addEventListener('ended', () => {
      this.isPlaying = false;
    });
    
    Object.defineProperty(this, 'video', { get: () => this._realVideo });
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
      console.error('[V7] Load Error:', err);
      if (spinner) spinner.classList.remove('active');
      return false;
    }
  }

  _startPlayback(channel, t = 0) {
    const rawUrl = channel.ytUrl || channel.url;
    // Yeni HTTP proxy rotasını kullanıyoruz (ham MP4 stream)
    const streamUrl = `/stream/http?url=${encodeURIComponent(rawUrl)}&t=${t}`;
    
    this._realVideo.src = streamUrl;
    this._realVideo.load();
    this._realVideo.play().catch(e => console.error('[V7] Oynatma hatası:', e));
  }

  play() {
    if (this._realVideo) this._realVideo.play();
  }

  pause() {
    if (this._realVideo) this._realVideo.pause();
  }

  stop(keepOverlay = false) {
    if (this._realVideo) {
      this._realVideo.pause();
      this._realVideo.removeAttribute('src');
      this._realVideo.load();
    }
    this.isPlaying = false;
  }

  setVolume(v) {
    if (this._realVideo) this._realVideo.volume = v;
  }
}

window.TeslaPlayerV7 = TeslaPlayerV7;
