/**
 * Açıl Susam — TeslaPlayer V2 (OffscreenCanvas Edition)
 */

'use strict';

function isTesla() {
  return /Tesla\//.test(navigator.userAgent);
}

function supportsWebCodecs() {
  return typeof VideoDecoder !== 'undefined' && typeof Worker !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'undefined';
}

class TeslaPlayer {
  constructor(canvasId, opts = {}) {
    this.canvas       = document.getElementById(canvasId);
    this.ctx          = this.canvas.getContext('2d');
    this.spinnerId    = opts.spinnerId    || 'spinner';
    this.containerId  = opts.containerId  || 'player-area';
    this.emptyStateId = opts.emptyStateId || 'empty-state';

    this.video          = document.createElement('video');
    this.video.muted    = false;
    this.video.playsInline = true;
    this.video.preload  = 'auto';

    this.hls = null;
    this.rafId = null;

    this._worker       = null;
    this._workerActive = false;

    this._audio    = null;
    this._audioHls = null;

    this._mediaSource       = null;
    this._sourceBuffer      = null;
    this._sourceBufferReady = false;
    this._audioQueue        = [];

    this.isPlaying      = false;
    this.currentChannel = null;
    this._wcMode        = false;
    this._suppressErrorsUntil = 0;

    this._syncTimer = null;
    this._startSyncLoop();
  }

  _startSyncLoop() {
    const sync = () => {
      if (this._wcMode && this.isPlaying && this._audio) {
        const currentTime = this._audio.currentTime * 1000;
        this._worker?.postMessage({ type: 'sync', currentTime });
      }
      this._syncTimer = setTimeout(sync, 16);
    };
    sync();
  }

  async load(channel, opts = {}) {
    const silentError  = !!opts.silentError;
    const throwOnError = !!opts.throwOnError;

    this.stop({ suppressErrorsMs: 300 });
    this.currentChannel = channel;
    this._clearError();

    const spinner = document.getElementById(this.spinnerId);
    if (spinner) spinner.classList.add('active');

    try {
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

  async _loadWebCodecs(channel) {
    this._wcMode = true;
    this._stopWorker();

    const rawUrl  = channel.ytUrl || this._extractOriginalUrl(channel.url);
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl   = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}`;

    this._worker = new Worker('/js/webcodecs-worker.js');
    this._workerActive = true;

    // OFFSCREEN CANVAS TRANSFER: Tesla blokajını aşmak için en kritik adım
    let offscreen = null;
    try {
      offscreen = this.canvas.transferControlToOffscreen();
    } catch (e) {
      console.warn('[Player] transferControlToOffscreen başarısız, eski usül devam ediliyor:', e.message);
    }

    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'audio') {
        this._feedAudioChunk(msg.chunk);
        return;
      }

      if (msg.type === 'ready') {
        this.isPlaying = true;
        this._startAudio(channel);
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

    // Canvas'ı Worker'a transfer et (Eğer transfer edildiyse)
    if (offscreen) {
      this._worker.postMessage({ type: 'start', wsUrl, canvas: offscreen }, [offscreen]);
    } else {
      this._worker.postMessage({ type: 'start', wsUrl });
    }

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

  _startAudio(channel) {
    this._stopAudio();
    const audioUrl = channel.ytUrl
      ? `/stream/audio?url=${encodeURIComponent(channel.ytUrl)}`
      : channel.url;

    if (!audioUrl) return;

    this._audio = document.createElement('audio');
    this._audio.volume = 1;
    this._audio.muted  = false;
    this._audio.autoplay = true;

    const isHls = !channel.ytUrl && (audioUrl.includes('.m3u8') || audioUrl.includes('/proxy/hls') || channel.isHls);

    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this._audioHls = new Hls({
        enableWorker   : true,
        lowLatencyMode : false,
        maxMaxBufferLength: 10,
      });
      this._audioHls.loadSource(audioUrl);
      this._audioHls.attachMedia(this._audio);
      this._audioHls.on(Hls.Events.MANIFEST_PARSED, () => {
        this._audio.play().catch(() => {});
      });
    } else {
      this._audio.src = audioUrl;
      this._audio.play().catch(() => {});
    }
  }

  _feedAudioChunk(chunk) {
    if (!this._mediaSource) {
      this._mediaSource    = new MediaSource();
      this._audioQueue     = [];
      this._sourceBufferReady = false;

      this._audio     = document.createElement('audio');
      this._audio.src = URL.createObjectURL(this._mediaSource);
      this._audio.volume = 1;
      this._audio.autoplay = true;

      this._mediaSource.addEventListener('sourceopen', () => {
        const mime = 'audio/mpeg';
        if (!MediaSource.isTypeSupported(mime)) return;
        this._sourceBuffer = this._mediaSource.addSourceBuffer(mime);
        this._sourceBuffer.mode = 'sequence';
        this._sourceBuffer.addEventListener('updateend', () => {
          this._flushAudioQueue();
        });
        this._sourceBufferReady = true;
        this._flushAudioQueue();
      });

      this._audio.play().catch(() => {});
    }

    this._audioQueue.push(chunk instanceof ArrayBuffer ? chunk : chunk.buffer || chunk);
    this._flushAudioQueue();
  }

  _flushAudioQueue() {
    if (!this._sourceBufferReady || !this._sourceBuffer || this._sourceBuffer.updating) return;
    if (!this._audioQueue || this._audioQueue.length === 0) return;
    try {
      this._sourceBuffer.appendBuffer(this._audioQueue.shift());
    } catch (e) {}
  }

  _stopAudio() {
    if (this._audioHls) { try { this._audioHls.destroy(); } catch {} this._audioHls = null; }
    if (this._audio) { try { this._audio.pause(); this._audio.src = ''; } catch {} this._audio = null; }
    if (this._mediaSource) { try { this._mediaSource.endOfStream(); } catch {} this._mediaSource = null; }
    this._sourceBuffer = null;
    this._sourceBufferReady = false;
    this._audioQueue = [];
  }

  _stopWorker() {
    if (this._worker) {
      this._worker.onmessage = null;
      try { this._worker.postMessage({ type: 'stop' }); } catch {}
      try { this._worker.terminate(); } catch {}
      this._worker = null;
    }
    this._workerActive = false;
  }

  async _loadClassic(channel) {
    this._wcMode = false;
    const isHls = channel.isHls || (channel.url && channel.url.includes('.m3u8'));

    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      this.hls.loadSource(channel.url);
      this.hls.attachMedia(this.video);
      await new Promise((resolve, reject) => {
        this.hls.on(Hls.Events.MANIFEST_PARSED, resolve);
        setTimeout(() => reject(new Error('HLS zaman aşımı')), 10000);
      });
    } else {
      this.video.src = channel.url;
      await new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const cleanup = () => { this.video.removeEventListener('canplay', onReady); };
        this.video.addEventListener('canplay', onReady, { once: true });
        setTimeout(() => { cleanup(); reject(new Error('Video zaman aşımı')); }, 10000);
      });
    }
    this.video.play().catch(() => {});
    this.isPlaying = true;
    this._startClassicRenderLoop();
  }

  _startClassicRenderLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const draw = () => {
      if (!this._wcMode && this.isPlaying && !this.video.paused) {
        if (this.video.videoWidth) {
          if (this.canvas.width !== this.video.videoWidth) {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
          }
          this.ctx.drawImage(this.video, 0, 0);
        }
      }
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  togglePlay() {
    if (this._wcMode) {
      if (this._workerActive) {
        this._stopWorker();
        this._stopAudio();
        this.isPlaying = false;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      } else {
        if (this.currentChannel) this.load(this.currentChannel, { silentError: true });
      }
      return;
    }
    if (this.video.paused) { this.video.play(); this.isPlaying = true; } 
    else { this.video.pause(); this.isPlaying = false; }
  }

  toggleMute() {
    const a = this._wcMode ? this._audio : this.video;
    if (!a) return false;
    a.muted = !a.muted;
    return a.muted;
  }

  setVolume(v) {
    const a = this._wcMode ? this._audio : this.video;
    if (a) a.volume = Math.max(0, Math.min(1, v));
  }

  get paused() { return this._wcMode ? (this._audio ? this._audio.paused : !this.isPlaying) : this.video.paused; }
  get hasActiveSource() { return this._wcMode ? this._workerActive : !!(this.video.src || this.hls); }

  stop(opts = {}) {
    const suppressMs = Number(opts.suppressErrorsMs || 0);
    if (suppressMs > 0) this._suppressErrorsUntil = Date.now() + suppressMs;

    this._stopWorker();
    this._stopAudio();
    this._wcMode = false;

    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.video.pause();
    this.video.src = '';
    this.isPlaying = false;

    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _clearError() { document.getElementById(this.containerId + '-error')?.remove(); }

  _showError(msg) {
    this._clearError();
    const area = document.getElementById(this.containerId);
    if (!area) return;
    const el = document.createElement('div');
    el.id = this.containerId + '-error';
    el.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#888;text-align:center;padding:30px;background:#000;z-index:100;';
    el.innerHTML = `<div style="font-size:48px">&#9888;</div><div style="font-size:16px;color:#fff">Yayın açılamadı</div><div style="font-size:13px;max-width:520px;line-height:1.5">${msg}</div><button onclick="this.parentElement.remove()" style="margin-top:12px;padding:10px 24px;background:#e82127;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Kapat</button>`;
    area.appendChild(el);
  }

  _toUserError(m, c) { return `${c?.name || 'Kanal'} şu anda açılamadı.`; }
}

window.TeslaPlayer = TeslaPlayer;
