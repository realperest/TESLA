/**
 * Açıl Susam — TeslaPlayer
 *
 * İki oynatma modu:
 *
 * 1) WebCodecs modu (Tesla sürüş bypass):
 *    - Sunucuya /stream/ws WebSocket bağlantısı açılır.
 *    - ffmpeg kaynağı H.264 Annex B NAL unit'lerine encode eder.
 *    - Worker (webcodecs-worker.js) içinde VideoDecoder ile decode edilir.
 *    - Her frame ImageBitmap olarak ana thread'e postMessage ile gelir.
 *    - Canvas 2D'ye drawImage() ile çizilir.
 *    - Ses: ayrı bir <audio> elementi HLS stream URL'sini hls.js ile oynatır.
 *      <audio> elementi Tesla sürüş kısıtlamasından etkilenmez.
 *
 * 2) Klasik mod (Tesla dışı tarayıcılar veya WebCodecs yoksa MJPEG fallback):
 *    - Gizli <video> elementi bellekte tutulur (DOM'a eklenmez).
 *    - hls.js ile HLS stream bağlanır.
 *    - requestAnimationFrame döngüsüyle canvas'a drawImage() yapılır.
 *
 * Mod seçimi:
 *    isTesla() → her zaman WebCodecs modu
 *    Değilse   → Worker + VideoDecoder varsa WebCodecs, yoksa klasik mod
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Araç tespiti
// ─────────────────────────────────────────────────────────────────────────────

function isTesla() {
  return /Tesla\//.test(navigator.userAgent);
}

function supportsWebCodecs() {
  return typeof VideoDecoder !== 'undefined' && typeof Worker !== 'undefined';
}

// ─────────────────────────────────────────────────────────────────────────────
// TeslaPlayer sınıfı
// ─────────────────────────────────────────────────────────────────────────────

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas       = document.getElementById(canvasId);
    this.ctx          = this.canvas.getContext('2d');
    this.spinnerId    = opts.spinnerId    || 'spinner';
    this.containerId  = opts.containerId  || 'player-area';
    this.emptyStateId = opts.emptyStateId || 'empty-state';

    // Klasik mod: gizli <video> (DOM'a eklenmez)
    this.video          = document.createElement('video');
    this.video.muted    = false;
    this.video.playsInline = true;
    this.video.preload  = 'auto';

    // Klasik mod için HLS
    this.hls = null;
    this.rafId = null;

    // WebCodecs modu için Worker
    this._worker       = null;
    this._workerActive = false;

    // Ses için ayrı <audio> elementi (WebCodecs modunda kullanılır)
    this._audio    = null;
    this._audioHls = null;

    this.isPlaying      = false;
    this.currentChannel = null;
    this._wcMode        = false; // Şu an WebCodecs modunda mı?
    this._suppressErrorsUntil = 0;

    this._bindVideoEvents();
    this._startClassicRenderLoop();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Yükleme
  // ─────────────────────────────────────────────────────────────────────────

  async load(channel, opts = {}) {
    const silentError  = !!opts.silentError;
    const throwOnError = !!opts.throwOnError;

    this.stop({ suppressErrorsMs: 300 });
    this.currentChannel = channel;
    this._clearError();

    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
      // Tesla veya WebCodecs destekleniyorsa WebCodecs modu dene
      if (isTesla() || supportsWebCodecs()) {
        await this._loadWebCodecs(channel);
      } else {
        await this._loadClassic(channel);
      }

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

  // ─────────────────────────────────────────────────────────────────────────
  // WebCodecs modu
  // ─────────────────────────────────────────────────────────────────────────

  async _loadWebCodecs(channel, mode) {
    mode = mode || 'h264';
    this._wcMode = true;
    this._stopWorker();

    // ytUrl varsa (YouTube videosu) → sunucu yt-dlp pipeline kullanır, CDN sorunları yok
    const rawUrl  = channel.ytUrl || this._extractOriginalUrl(channel.url);
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl   = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}`;

    this._worker = new Worker('/js/webcodecs-worker.js');
    this._workerActive = true;

    let audioStarted = false;

    const _onFrame = (msg) => {
      if (!this._wcMode || !msg.bitmap) return;
      const w = msg.bitmap.width;
      const h = msg.bitmap.height;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width  = w;
        this.canvas.height = h;
      }
      this.ctx.drawImage(msg.bitmap, 0, 0, w, h);
      msg.bitmap.close();
      // Sesi ilk görüntüyle birlikte başlat — senkron için
      if (!audioStarted) { audioStarted = true; this._startAudio(channel); }
    };

    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'frame')  { _onFrame(msg); return; }

      if (msg.type === 'ready') {
        this.isPlaying = true;
        return;
      }

      if (msg.type === 'error') {
        console.error('[Player/WC] Worker hata:', msg.message);
      }

      if (msg.type === 'closed') {
        this.isPlaying = false;
      }
    };

    this._worker.onerror = (e) => {
      console.error('[Player/WC] Worker uncaught:', e.message);
      this._wcMode = false;
      this._stopWorker();
      this._loadClassic(channel).catch(() => {});
    };

    this._worker.postMessage({ type: 'start', wsUrl, mode });

    // WebSocket bağlantısı için kısa bekle
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bağlantı zaman aşımı')), 10000);
      const prev = this._worker.onmessage;
      this._worker.onmessage = (e) => {
        prev(e);
        if (e.data?.type === 'ready') { clearTimeout(timeout); resolve(); }
        if (e.data?.type === 'error') { clearTimeout(timeout); reject(new Error(e.data.message)); }
      };
    });
  }

  /**
   * /proxy/hls?url=<encoded> formatındaki proxy URL'lerinden orijinal URL'yi çıkar.
   * ffmpeg doğrudan orijinal URL'yi okuyabilmeli.
   */
  _extractOriginalUrl(url) {
    if (!url) return url;
    const u = String(url);
    if (u.includes('/proxy/hls?url=')) {
      try {
        const parsed = new URL(u, location.origin);
        return decodeURIComponent(parsed.searchParams.get('url') || u);
      } catch {
        return u;
      }
    }
    return u;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ses: ayrı <audio> element (Tesla'da sürüş modunda bloke edilmiyor)
  // ─────────────────────────────────────────────────────────────────────────

  _startAudio(channel) {
    this._stopAudio();

    const url = channel.url;
    if (!url) return;

    this._audio = document.createElement('audio');
    this._audio.volume = 1;
    this._audio.muted  = false;

    const isHls = url.includes('.m3u8') || url.includes('/proxy/hls') || channel.isHls;

    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this._audioHls = new Hls({
        enableWorker   : true,
        lowLatencyMode : false,
        maxMaxBufferLength: 10,
      });
      this._audioHls.loadSource(url);
      this._audioHls.attachMedia(this._audio);
      this._audioHls.on(Hls.Events.MANIFEST_PARSED, () => {
        this._audio.play().catch(() => {});
      });
    } else {
      this._audio.src = url;
      this._audio.play().catch(() => {});
    }
  }

  _stopAudio() {
    if (this._audioHls) {
      try { this._audioHls.destroy(); } catch {}
      this._audioHls = null;
    }
    if (this._audio) {
      try { this._audio.pause(); this._audio.src = ''; } catch {}
      this._audio = null;
    }
  }

  _stopWorker() {
    if (this._worker) {
      try { this._worker.postMessage({ type: 'stop' }); } catch {}
      try { this._worker.terminate(); } catch {}
      this._worker = null;
    }
    this._workerActive = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Klasik mod (gizli <video> + canvas render loop)
  // ─────────────────────────────────────────────────────────────────────────

  async _loadClassic(channel) {
    this._wcMode = false;
    const isHls = channel.isHls || (channel.url && channel.url.includes('.m3u8'));

    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker      : true,
        lowLatencyMode    : false,
        abrEwmaFastLive   : 3,
        abrEwmaSlowLive   : 9,
        maxMaxBufferLength: 30,
      });
      this.hls.loadSource(channel.url);
      this.hls.attachMedia(this.video);

      await new Promise((resolve, reject) => {
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const levels = Array.isArray(this.hls.levels) ? this.hls.levels : [];
          const videoLevels = levels
            .map((lv, idx) => ({ idx, height: lv?.height || 0, width: lv?.width || 0 }))
            .filter((lv) => lv.height > 0 || lv.width > 0)
            .sort((a, b) => b.height - a.height || b.width - a.width);
          if (videoLevels.length) {
            this.hls.startLevel   = videoLevels[0].idx;
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
      this.video.src = channel.url;
      await new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onErr   = () => { cleanup(); reject(new Error('Video yüklenemedi')); };
        const cleanup = () => {
          this.video.removeEventListener('canplay', onReady);
          this.video.removeEventListener('error', onErr);
        };
        this.video.addEventListener('canplay', onReady, { once: true });
        this.video.addEventListener('error',   onErr,   { once: true });
        setTimeout(() => { cleanup(); reject(new Error('Zaman aşımı')); }, 15000);
      });
    }

    await this.video.play();
    this.isPlaying = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render döngüsü (sadece klasik mod için)
  // ─────────────────────────────────────────────────────────────────────────

  _startClassicRenderLoop() {
    const draw = () => {
      if (!this._wcMode && this.isPlaying && !this.video.paused && this.video.readyState >= 2) {
        try {
          if (this.video.videoWidth && this.canvas.width !== this.video.videoWidth) {
            this.canvas.width  = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
          }
          if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
          }
        } catch (err) {
          console.warn('[Player] drawImage hatası:', err.message);
        }
      }
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Kontrol metodları (dışarıdan çağrılır)
  // ─────────────────────────────────────────────────────────────────────────

  togglePlay() {
    if (this._wcMode) {
      // WebCodecs modunda oynat/duraklat: sesi kontrol et
      if (!this._audio) return;
      if (this._audio.paused) {
        this._audio.play().catch(() => {});
        this.isPlaying = true;
      } else {
        this._audio.pause();
        this.isPlaying = false;
      }
      return;
    }
    // Klasik mod
    if (!this.video.src && !this.hls) return;
    if (this.video.paused) {
      this.video.play();
      this.isPlaying = true;
    } else {
      this.video.pause();
      this.isPlaying = false;
    }
  }

  toggleMute() {
    if (this._wcMode) {
      if (!this._audio) return false;
      this._audio.muted = !this._audio.muted;
      return this._audio.muted;
    }
    this.video.muted = !this.video.muted;
    return this.video.muted;
  }

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    if (this._wcMode) {
      if (this._audio) this._audio.volume = vol;
      return;
    }
    this.video.volume = vol;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // app.js uyumluluk getter'ları
  // ─────────────────────────────────────────────────────────────────────────

  /** Oynatma duraklatılmış mı? (her iki mod için doğru sonuç) */
  get paused() {
    if (this._wcMode) return this._audio ? this._audio.paused : !this.isPlaying;
    return this.video.paused;
  }

  /** Aktif kaynak var mı? (video src veya HLS veya WebCodecs worker) */
  get hasActiveSource() {
    if (this._wcMode) return this._workerActive;
    return !!(this.video.src || this.hls);
  }

  stop(opts = {}) {
    const suppressMs = Number(opts.suppressErrorsMs || 0);
    if (suppressMs > 0) {
      this._suppressErrorsUntil = Date.now() + suppressMs;
    }

    // Worker ve ses durdur
    this._stopWorker();
    this._stopAudio();
    this._wcMode = false;

    // Klasik mod
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

  // ─────────────────────────────────────────────────────────────────────────
  // Dahili yardımcılar
  // ─────────────────────────────────────────────────────────────────────────

  _bindVideoEvents() {
    this.video.addEventListener('error', () => {
      if (Date.now() < this._suppressErrorsUntil) {
        document.getElementById(this.spinnerId)?.classList.remove('active');
        return;
      }
      this._showError(this._toUserError('video_error', this.currentChannel));
      document.getElementById(this.spinnerId)?.classList.remove('active');
    });

    window.addEventListener('resize', () => {
      if (!this._wcMode && this.video.videoWidth) {
        this.canvas.width  = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      }
    });
  }

  _showError(msg) {
    const area  = document.getElementById(this.containerId);
    if (!area) return;
    const errId = this.containerId + '-error';
    let el = document.getElementById(errId);
    if (!el) {
      el = document.createElement('div');
      el.id = errId;
      el.style.cssText = `
        position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:12px;
        color:#888;text-align:center;padding:30px;background:#000;
      `;
      area.appendChild(el);
    }
    el.innerHTML = `
      <div style="font-size:48px">&#9888;</div>
      <div style="font-size:16px;color:#fff">Yayın açılamadı</div>
      <div style="font-size:13px;max-width:520px;line-height:1.5">${msg}</div>
      <button onclick="document.getElementById('${errId}').remove()"
        style="margin-top:12px;padding:10px 24px;background:#e82127;color:#fff;
               border:none;border-radius:8px;font-size:14px;cursor:pointer">
        Kapat
      </button>
    `;
  }

  _clearError() {
    const errId = this.containerId + '-error';
    document.getElementById(errId)?.remove();
  }

  _toUserError(rawMsg, channel) {
    const name = String(channel?.name || 'Bu kanal');
    const msg  = String(rawMsg || '').toLowerCase();

    if (msg.includes('manifestloaderror') || msg.includes('manifest')) {
      return `${name} için yayın listesi alınamadı. Kaynak bağlantısı geçici olarak kapalı veya değişmiş olabilir.`;
    }
    if (msg.includes('timeout') || msg.includes('zaman aşımı')) {
      return `${name} zamanında yanıt vermedi. Ağ yavaşlığı veya yayın sunucusu yoğunluğu nedeniyle bağlantı kurulamadı.`;
    }
    if (msg.includes('network') || msg.includes('failed to fetch')) {
      return `${name} için ağ bağlantısı kurulamadı.`;
    }
    if (msg.includes('403') || msg.includes('401') || msg.includes('forbidden') || msg.includes('unauthorized')) {
      return `${name} yayını bu bağlantıdan erişime izin vermiyor.`;
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return `${name} yayın adresi artık geçerli görünmüyor (kaynak bulunamadı).`;
    }
    if (msg.includes('video_error') || msg.includes('video yüklenemedi')) {
      return `${name} oynatıcı tarafından açılamadı. Kanal bağlantısı formatı desteklenmiyor olabilir.`;
    }
    return `${name} şu anda açılamadı. Yayın sağlayıcısı geçici olarak kapalı olabilir. Kısa süre sonra tekrar deneyin.`;
  }
}

// Global instance — app.js tarafından kullanılır
window.TeslaPlayer = TeslaPlayer;
