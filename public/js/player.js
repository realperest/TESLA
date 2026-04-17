/**
 * Tesla TV — Canvas Bypass Player
 *
 * Tesla'nın sürüş kısıtlaması, Chromium'un donanım H.264/H.265 decoder'ını
 * araç hareket halindeyken devre dışı bırakır. Ama <canvas> çizimini engelleyemez.
 *
 * Çözüm:
 *   1. Gizli bir <video> elementi oluştur (DOM'a ekleme)
 *   2. hls.js ile HLS stream'i bu video'ya bağla
 *   3. requestAnimationFrame döngüsüyle her kareyi canvas'a çiz
 *
 * Sonuç: Tesla "video yok" sanıyor, oynatma devam ediyor.
 */

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.spinnerId   = opts.spinnerId   || 'spinner';
    this.containerId = opts.containerId || 'player-area';

    // Gizli video — DOM'da değil, sadece bellekte
    this.video = document.createElement('video');
    this.video.muted = false;
    this.video.playsInline = true;

    this.hls = null;
    this.rafId = null;
    this.isPlaying = false;
    this.currentChannel = null;

    this._bindEvents();
    this._startRenderLoop();
  }

  /** Stream yükle ve oynat — HLS veya doğrudan MP4 */
  async load(channel) {
    this.stop();
    this.currentChannel = channel;

    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      const isHls = channel.isHls || channel.url.includes('.m3u8');

      if (isHls && Hls.isSupported()) {
        this.hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          abrEwmaFastLive: 3,
          abrEwmaSlowLive: 9,
          maxMaxBufferLength: 30,
        });

        this.hls.loadSource(channel.url);
        this.hls.attachMedia(this.video);

        await new Promise((resolve, reject) => {
          this.hls.on(Hls.Events.MANIFEST_PARSED, resolve);
          this.hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) reject(new Error(data.details));
          });
          setTimeout(() => reject(new Error('Zaman aşımı')), 15000);
        });
      } else {
        // Doğrudan MP4 / native HLS (Safari) / diğer formatlar
        this.video.src = channel.url;
        await new Promise((resolve, reject) => {
          const onReady = () => { cleanup(); resolve(); };
          const onErr   = () => { cleanup(); reject(new Error('Video yüklenemedi')); };
          const cleanup = () => {
            this.video.removeEventListener('canplay', onReady);
            this.video.removeEventListener('error', onErr);
          };
          this.video.addEventListener('canplay', onReady, { once: true });
          this.video.addEventListener('error', onErr, { once: true });
          setTimeout(() => { cleanup(); reject(new Error('Zaman aşımı')); }, 15000);
        });
      }

      await this.video.play();
      this.isPlaying = true;

      if (spinner) spinner.classList.remove('active');
      document.getElementById('empty-state')?.remove();

    } catch (err) {
      console.error('[Player] Yükleme hatası:', err.message);
      if (spinner) spinner.classList.remove('active');
      this._showError(err.message);
    }
  }

  /** Oynat / Duraklat */
  togglePlay() {
    if (!this.video.src && !this.hls) return;
    if (this.video.paused) {
      this.video.play();
      this.isPlaying = true;
    } else {
      this.video.pause();
      this.isPlaying = false;
    }
  }

  /** Ses aç/kapat */
  toggleMute() {
    this.video.muted = !this.video.muted;
    return this.video.muted;
  }

  /** Ses seviyesi (0-1) */
  setVolume(v) {
    this.video.volume = Math.max(0, Math.min(1, v));
  }

  /** Durdur ve kaynağı temizle */
  stop() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.pause();
    this.video.src = '';
    this.isPlaying = false;
    // Canvas'ı karart
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── Dahili ────────────────────────────────────────────────

  _startRenderLoop() {
    const draw = () => {
      if (this.isPlaying && !this.video.paused && this.video.readyState >= 2) {
        // Canvas boyutunu içerik boyutuna ayarla (ilk frame'de)
        if (this.video.videoWidth && this.canvas.width !== this.video.videoWidth) {
          this._resizeCanvas();
        }
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  _resizeCanvas() {
    // Canvas'ı videonun native çözünürlüğüne ayarla.
    // CSS (object-fit: contain) görüntü alanına sığdırmayı halleder;
    // böylece drawImage tam çözünürlükte çizer, tarayıcı ölçekler.
    this.canvas.width  = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
  }

  _bindEvents() {
    // Video hata yönetimi
    this.video.addEventListener('error', () => {
      this._showError('Stream yüklenemedi.');
      document.getElementById(this.spinnerId)?.classList.remove('active');
    });

    // Pencere yeniden boyutlandırıldığında canvas'ı güncelle
    window.addEventListener('resize', () => {
      if (this.video.videoWidth) this._resizeCanvas();
    });
  }

  _showError(msg) {
    const area = document.getElementById(this.containerId);
    const errId = this.containerId + '-error';
    let el = document.getElementById(errId);
    if (!el) {
      el = document.createElement('div');
      el.id = errId;
      el.style.cssText = `
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:12px;
        color:#888; text-align:center; padding:30px; background:#000;
      `;
      area.appendChild(el);
    }
    el.innerHTML = `
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:16px;color:#fff">Stream yüklenemedi</div>
      <div style="font-size:13px">${msg}</div>
      <button onclick="document.getElementById('${errId}').remove()"
        style="margin-top:12px;padding:10px 24px;background:#e82127;color:#fff;
               border:none;border-radius:8px;font-size:14px;cursor:pointer">
        Kapat
      </button>
    `;
  }
}

// Global instance — app.js tarafından kullanılır
window.TeslaPlayer = TeslaPlayer;
