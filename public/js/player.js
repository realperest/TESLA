/**
 * Açıl Susam — Canvas Bypass Player
 *
 * Bazı araç tarayıcılarında sürüş kısıtlaması, Chromium donanım H.264/H.265 decoder'ını
 * hareket halindeyken devre dışı bırakır. Ama <canvas> çizimini engelleyemez.
 *
 * Çözüm:
 *   1. Gizli bir <video> elementi oluştur (DOM'a ekleme)
 *   2. hls.js ile HLS stream'i bu video'ya bağla
 *   3. requestAnimationFrame döngüsüyle her kareyi canvas'a çiz
 *
 * Sonuç: tarayıcı video yok sanıyor, oynatma canvas üzerinden devam ediyor.
 */

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.spinnerId   = opts.spinnerId   || 'spinner';
    this.containerId = opts.containerId || 'player-area';
    this.emptyStateId = opts.emptyStateId || 'empty-state';

    // Gizli video — DOM'da değil, sadece bellekte
    this.video = document.createElement('video');
    this.video.muted = false;
    this.video.playsInline = true;
    this.video.preload = 'auto';

    this.hls = null;
    this.rafId = null;
    this.isPlaying = false;
    this.currentChannel = null;
    this._suppressErrorsUntil = 0;

    this._bindEvents();
    this._startRenderLoop();
  }

  /** Stream yükle ve oynat — HLS veya doğrudan MP4 */
  async load(channel, opts = {}) {
    const silentError = !!opts.silentError;
    const throwOnError = !!opts.throwOnError;
    this.stop({ suppressErrorsMs: 300 });
    this.currentChannel = channel;
    this._clearError();

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
          this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            // Ses-only level seçilmesini önlemek için video çözünürlüğü olan en iyi level'ı seç.
            const levels = Array.isArray(this.hls.levels) ? this.hls.levels : [];
            const videoLevels = levels
              .map((lv, idx) => ({ idx, height: lv?.height || 0, width: lv?.width || 0 }))
              .filter((lv) => lv.height > 0 || lv.width > 0)
              .sort((a, b) => b.height - a.height || b.width - a.width);

            if (videoLevels.length) {
              this.hls.startLevel = videoLevels[0].idx;
              this.hls.currentLevel = videoLevels[0].idx;
            }
            resolve();
          });
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
      document.getElementById(this.emptyStateId)?.remove();
      this._clearError();
      return true;

    } catch (err) {
      console.error('[Player] Yükleme hatası:', err.message);
      if (spinner) spinner.classList.remove('active');
      if (!silentError) this._showError(this._toUserError(err?.message, channel));
      if (throwOnError) throw err;
      return false;
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
  stop(opts = {}) {
    const suppressErrorsMs = Number(opts.suppressErrorsMs || 0);
    if (suppressErrorsMs > 0) {
      this._suppressErrorsUntil = Date.now() + suppressErrorsMs;
    }
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
        try {
          // Canvas boyutunu içerik boyutuna ayarla (ilk frame'de)
          if (this.video.videoWidth && this.canvas.width !== this.video.videoWidth) {
            this._resizeCanvas();
          }
          if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
          }
        } catch (err) {
          // Bazı yayınlarda frame çizimi geçici hata verebilir; döngüyü kırma.
          console.warn('[Player] drawImage hatası:', err.message);
        }
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
      if (Date.now() < this._suppressErrorsUntil) {
        document.getElementById(this.spinnerId)?.classList.remove('active');
        return;
      }
      this._showError(this._toUserError('video_error', this.currentChannel));
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
      <div style="font-size:16px;color:#fff">Yayın açılamadı</div>
      <div style="font-size:13px;max-width:520px;line-height:1.5">${msg}</div>
      <button onclick="document.getElementById('${errId}').remove()"
        style="margin-top:12px;padding:10px 24px;background:#e82127;color:#fff;
               border:none;border-radius:8px;font-size:14px;cursor:pointer">
        Kapat
      </button>
    `;
  }

  _toUserError(rawMsg, channel) {
    const name = String(channel?.name || 'Bu kanal');
    const msg = String(rawMsg || '').toLowerCase();

    if (msg.includes('manifestloaderror') || msg.includes('manifest')) {
      return `${name} için yayın listesi alınamadı. Kaynak bağlantısı geçici olarak kapalı veya değişmiş olabilir. Birkaç dakika sonra tekrar deneyin. TV Ayarları bölümünde yayın kaynağını güncellemeyi deneyebilirsiniz.`;
    }

    if (msg.includes('timeout') || msg.includes('zaman aşımı')) {
      return `${name} zamanında yanıt vermedi. Ağ yavaşlığı veya yayın sunucusu yoğunluğu nedeniyle bağlantı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.`;
    }

    if (msg.includes('network') || msg.includes('failed to fetch')) {
      return `${name} için ağ bağlantısı kurulamadı. İnternet bağlantısı, VPN/proxy veya uzak sunucu kaynaklı geçici bir kesinti olabilir.`;
    }

    if (msg.includes('403') || msg.includes('401') || msg.includes('forbidden') || msg.includes('unauthorized')) {
      return `${name} yayını bu bağlantıdan erişime izin vermiyor olabilir. Bölge veya erişim kısıtı nedeniyle kanal açılmadı.`;
    }

    if (msg.includes('404') || msg.includes('not found')) {
      return `${name} yayın adresi artık geçerli görünmüyor (kaynak bulunamadı). TV Ayarları bölümünde yayın kaynağını güncellemeyi deneyebilirsiniz.`;
    }

    if (msg.includes('video_error') || msg.includes('video yüklenemedi')) {
      return `${name} oynatıcı tarafından açılamadı. Kanal bağlantısı formatı desteklenmiyor veya yayın geçici olarak kapalı olabilir.`;
    }

    return `${name} şu anda açılamadı. Yayın sağlayıcısı geçici olarak kapalı olabilir veya bağlantı değişmiş olabilir. Kısa süre sonra tekrar deneyin. TV Ayarları bölümünde yayın kaynağını güncellemeyi deneyebilirsiniz.`;
  }

  _clearError() {
    const errId = this.containerId + '-error';
    const el = document.getElementById(errId);
    if (el) el.remove();
  }
}

// Global instance — app.js tarafından kullanılır
window.TeslaPlayer = TeslaPlayer;
