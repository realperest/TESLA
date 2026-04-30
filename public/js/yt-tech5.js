/**
 * YouTube Teknik 5: WebCodecs + MJPEG (canvas -> jpeg -> img)
 * Girdi: tek bir MP4 URL (audio+video aynı kaynak)
 */

(function () {
  const Tech5 = {
    id: 'tech5',
    img: null,
    canvas: null,
    ctx: null,
    audio: null,
    decoder: null,
    mp4boxfile: null,
    timescale: 90000,
    isAVCC: false,
    isConfigured: false,
    pendingSamples: [],
    duration: 0,
    isPlaying: false,
    firstFrameSeen: false,
    renderGen: 0,
    _progressRaf: null,
    _mp4Url: '',
    _pausedAt: 0,
    _syncToleranceSec: 0.12,
    _maxResyncAttempts: 2,
    _resyncAttempts: 0,
    _resumeToken: 0,
    _resumeWatchdogTimer: null,
    _onMeta: null,
    _hardRecovering: false,
    _hardRecoverTimer: null,

    init({ img, volumeEl, progressWrapEl }) {
      this.img = img;
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.volume = 1.0;

      if (volumeEl) {
        volumeEl.addEventListener('input', () => {
          this.audio.volume = Number(volumeEl.value || 0);
        });
      }

      if (progressWrapEl) {
        progressWrapEl.addEventListener('click', (e) => this._onSeekClick(e, progressWrapEl));
        progressWrapEl.addEventListener('touchend', (e) => {
          e.preventDefault();
          if (!e.changedTouches || !e.changedTouches.length) return;
          this._onSeekClick(e.changedTouches[0], progressWrapEl);
        }, { passive: false });
      }
    },

    reset() {
      this.isPlaying = false;
      this.firstFrameSeen = false;
      this.renderGen++;
      this.isConfigured = false;
      this.isAVCC = false;
      this.pendingSamples = [];
      this.duration = 0;
      this.timescale = 90000;
      this._mp4Url = '';
      this._pausedAt = 0;
      this._resyncAttempts = 0;
      this._resumeToken++;
      if (this._resumeWatchdogTimer) { clearTimeout(this._resumeWatchdogTimer); this._resumeWatchdogTimer = null; }
      if (this._hardRecoverTimer) { clearTimeout(this._hardRecoverTimer); this._hardRecoverTimer = null; }
      this._hardRecovering = false;
      this._onMeta = null;

      try { this.audio.pause(); } catch {}
      if (this.audio) this.audio.src = '';

      if (this.decoder) {
        try { this.decoder.close(); } catch {}
        this.decoder = null;
      }

      if (this.mp4boxfile) {
        try { this.mp4boxfile.flush(); } catch {}
        this.mp4boxfile = null;
      }

      if (this._progressRaf) {
        cancelAnimationFrame(this._progressRaf);
        this._progressRaf = null;
      }

      if (this.img) {
        const old = String(this.img.src || '');
        if (old.startsWith('blob:')) {
          try { URL.revokeObjectURL(old); } catch {}
        }
        this.img.src = '';
      }
    },

    play() {
      if (!this.mp4boxfile) return;
      if (this.isPlaying) return;
      this.isPlaying = true;
      this.renderGen++;
      this._resyncAttempts = 0;
      this._resumeToken++;
      const token = this._resumeToken;

      if (this.isConfigured) {
        const resumeAt = Number(this._pausedAt || this.audio.currentTime || 0);
        this.firstFrameSeen = false;
        this._resumeAtAsync(resumeAt, token);
      } else {
        try { this.audio.currentTime = 0; } catch {}
        try { this.mp4boxfile.start(); } catch {}
      }

      if (this._resumeWatchdogTimer) clearTimeout(this._resumeWatchdogTimer);
      this._resumeWatchdogTimer = setTimeout(() => {
        if (!this.isPlaying) return;
        if (this.firstFrameSeen) return;
        if (token !== this._resumeToken) return;
        try { this.decoder && this.decoder.flush && this.decoder.flush().catch(() => {}); } catch {}
        try {
          const t = Number(this._pausedAt || this.audio.currentTime || 0);
          this.mp4boxfile.seek(t, true);
          this.mp4boxfile.start();
        } catch {}
      }, 1400);

      if (this._hardRecoverTimer) clearTimeout(this._hardRecoverTimer);
      this._hardRecoverTimer = setTimeout(() => {
        if (!this.isPlaying) return;
        if (this.firstFrameSeen) return;
        if (token !== this._resumeToken) return;
        this._hardRecoverResume(token);
      }, 3200);
    },

    pause() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      this.renderGen++;
      this._pausedAt = Number(this.audio && Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0);
      this._resumeToken++;
      if (this._resumeWatchdogTimer) { clearTimeout(this._resumeWatchdogTimer); this._resumeWatchdogTimer = null; }
      if (this._hardRecoverTimer) { clearTimeout(this._hardRecoverTimer); this._hardRecoverTimer = null; }
      try { this.audio.pause(); } catch {}
      try { this.mp4boxfile && this.mp4boxfile.stop && this.mp4boxfile.stop(); } catch {}
      try { this.decoder && this.decoder.flush && this.decoder.flush().catch(() => {}); } catch {}
      if (this._progressRaf) {
        cancelAnimationFrame(this._progressRaf);
        this._progressRaf = null;
      }
    },

    seek(timeSec) {
      if (!this.mp4boxfile || !this.duration) return;
      const t = Math.max(0, Math.min(Number(timeSec) || 0, this.duration));
      this.renderGen++;
      this._pausedAt = t;
      try { this.audio.currentTime = t; } catch {}
      try { this.decoder && this.decoder.flush && this.decoder.flush().catch(() => {}); } catch {}
      try {
        this.mp4boxfile.seek(t, true);
        this.mp4boxfile.start();
      } catch {}
      this.firstFrameSeen = false;
      if (this.isPlaying) {
        // Audio, ilk frame ile hizalama doğrulandıktan sonra başlatılacak
      }
    },

    _resumeAtAsync(timeSec, token) {
      const t = Math.max(0, Number(timeSec) || 0);
      try { this.audio.pause(); } catch {}
      try { this.audio.currentTime = t; } catch {}

      const audio = this.audio;
      const done = () => {
        if (!this.isPlaying) return;
        if (token !== this._resumeToken) return;
        try { this.decoder && this.decoder.flush && this.decoder.flush().catch(() => {}); } catch {}
        try {
          this.mp4boxfile.seek(t, true);
          this.mp4boxfile.start();
        } catch {}
      };

      let settled = false;
      const onSeeked = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('seeked', onSeeked);
        done();
      };
      try { audio.addEventListener('seeked', onSeeked, { once: true }); } catch {}
      setTimeout(() => {
        if (settled) return;
        settled = true;
        try { audio.removeEventListener('seeked', onSeeked); } catch {}
        done();
      }, 800);
    },

    async loadMp4(mp4Url, info) {
      this.reset();
      this._mp4Url = String(mp4Url || '');
      if (!this._mp4Url) throw new Error('mp4_url_missing');
      this._onMeta = info && typeof info.onMeta === 'function' ? info.onMeta : null;

      this.audio.src = this._mp4Url;
      try { this.audio.load(); } catch {}

      this.mp4boxfile = MP4Box.createFile();

      this.mp4boxfile.onReady = (readyInfo) => {
        const track = readyInfo && readyInfo.videoTracks ? readyInfo.videoTracks[0] : null;
        if (!track) return;

        this.timescale = Number(track.timescale) || 90000;
        this.duration = Number(readyInfo.duration) / Number(readyInfo.timescale || this.timescale || 90000);

        const avcCDesc = this._getAVCCFromMP4Box(track);
        const config = {
          codec: track.codec,
          codedWidth: track.track_width,
          codedHeight: track.track_height,
        };

        if (avcCDesc && avcCDesc.byteLength > 4) {
          config.description = avcCDesc;
          this.isAVCC = true;
        } else {
          this.isAVCC = false;
        }

        this.decoder = new VideoDecoder({
          output: (frame) => this._processFrame(frame),
          error: () => {},
        });

        try {
          this.decoder.configure(config);
          this.isConfigured = true;
          const pending = this.pendingSamples.slice();
          this.pendingSamples = [];
          pending.forEach(s => this._sendSample(s));
        } catch {}

        try {
          const m = this.mp4boxfile.setExtractionConfig ? 'setExtractionConfig' : 'setExtractionOptions';
          this.mp4boxfile[m](track.id, null, { nb_samples: 1 });
        } catch {}

        // Eğer kullanıcı play'e bastıysa ve onReady sonradan geldiyse extraction'ı kesin başlat
        if (this.isPlaying) {
          try { this.mp4boxfile.start(); } catch {}
        }

        if (info && typeof info.onMeta === 'function') {
          info.onMeta({ duration: this.duration });
        }
      };

      this.mp4boxfile.onSamples = (id, user, samples) => {
        if (!samples || !samples.length) return;
        for (const sample of samples) {
          if (!this.isConfigured) this.pendingSamples.push(sample);
          else this._sendSample(sample);
        }
      };

      const response = await fetch(this._mp4Url);
      if (!response.ok || !response.body) throw new Error('mp4_fetch_failed');

      const reader = response.body.getReader();
      let offset = 0;

      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { try { this.mp4boxfile.flush(); } catch {} break; }
          const slice = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          slice.fileStart = offset;
          offset += slice.byteLength;
          try { this.mp4boxfile.appendBuffer(slice); } catch {}
        }
      };
      pump().catch(() => {});
    },

    _hardRecoverResume(token) {
      if (this._hardRecovering) return;
      const url = String(this._mp4Url || '').trim();
      if (!url) return;
      this._hardRecovering = true;
      const t = Number(this._pausedAt || (this.audio ? this.audio.currentTime : 0) || 0);
      const wasPlaying = this.isPlaying;
      try { this.audio.pause(); } catch {}
      try { this.mp4boxfile && this.mp4boxfile.stop && this.mp4boxfile.stop(); } catch {}
      try { this.decoder && this.decoder.close && this.decoder.close(); } catch {}

      this.isPlaying = false;
      this.isConfigured = false;
      this.firstFrameSeen = false;
      this.pendingSamples = [];
      this.renderGen++;

      this.loadMp4(url, { onMeta: this._onMeta || (() => {}) })
        .then(() => {
          if (!wasPlaying) return;
          if (token !== this._resumeToken) return;
          this._pausedAt = t;
          this.isPlaying = true;
          this.renderGen++;
          this.firstFrameSeen = false;
          this._resumeAtAsync(t, token);
        })
        .catch(() => {})
        .finally(() => {
          this._hardRecovering = false;
        });
    },

    _sendSample(sample) {
      if (!this.decoder || this.decoder.state !== 'configured') return;
      try {
        const tsUs = Math.round((Number(sample.cts || 0) / this.timescale) * 1_000_000);
        const durUs = Math.round((Number(sample.duration || 0) / this.timescale) * 1_000_000);
        this.decoder.decode(new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: tsUs,
          duration: durUs,
          data: this.isAVCC ? sample.data : this._toAnnexB(sample.data),
        }));
      } catch {}
    },

    _toAnnexB(data) {
      const src = new Uint8Array(data instanceof ArrayBuffer ? data : (data.buffer || data));
      const dst = new Uint8Array(src.length);
      dst.set(src);
      let i = 0;
      while (i + 4 < dst.length) {
        const len = (dst[i] << 24) | (dst[i + 1] << 16) | (dst[i + 2] << 8) | dst[i + 3];
        if (len <= 0 || i + 4 + len > dst.length) break;
        dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; dst[i + 3] = 1;
        i += 4 + len;
      }
      return dst;
    },

    _getAVCCFromMP4Box(track) {
      try {
        const trak = this.mp4boxfile.getTrackById ? this.mp4boxfile.getTrackById(track.id) : null;
        const avcC = trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl && trak.mdia.minf.stbl.stsd
          ? (trak.mdia.minf.stbl.stsd.entries && trak.mdia.minf.stbl.stsd.entries[0] && trak.mdia.minf.stbl.stsd.entries[0].avcC)
          : null;
        if (!avcC) return null;
        const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
        avcC.write(stream);
        return new Uint8Array(stream.buffer, 8);
      } catch {
        return null;
      }
    },

    _updateProgressUi(helpers) {
      if (!this.duration || !this.audio) return;
      const cur = Number(this.audio.currentTime || 0);
      const pct = Math.min((cur / this.duration) * 100, 100);
      if (helpers && typeof helpers.setProgress === 'function') helpers.setProgress(pct, cur, this.duration);
      if (this.isPlaying) {
        this._progressRaf = requestAnimationFrame(() => this._updateProgressUi(helpers));
      }
    },

    _processFrame(frame) {
      const frameTs = frame.timestamp / 1_000_000;
      const masterTs = Number(this.audio.currentTime || 0);
      const drift = frameTs - masterTs;
      if (!this.isPlaying) { try { frame.close(); } catch {} return; }

      if (!this.firstFrameSeen) {
        if (Math.abs(drift) > this._syncToleranceSec && this._resyncAttempts < this._maxResyncAttempts) {
          this._resyncAttempts++;
          this.renderGen++;
          this.firstFrameSeen = false;
          try { frame.close(); } catch {}
          try { this.decoder && this.decoder.flush && this.decoder.flush().catch(() => {}); } catch {}
          try {
            const t = Number(this.audio.currentTime || this._pausedAt || 0);
            this.mp4boxfile.seek(t, true);
            this.mp4boxfile.start();
          } catch {}
          return;
        }
        // Audio'yu, gerçekten ilk frame render edileceği anda başlatacağız.
      }
      if (drift < -0.15) { try { frame.close(); } catch {} return; }

      const currentGen = this.renderGen;
      let started = false;
      const startAudioOnce = () => {
        if (started) return;
        started = true;
        if (!this.firstFrameSeen) {
          this.firstFrameSeen = true;
          try { this.audio.currentTime = frameTs; } catch {}
          try { this.audio.play().catch(() => {}); } catch {}
          if (window.YtTechUi && typeof window.YtTechUi.startProgress === 'function') {
            window.YtTechUi.startProgress(() => this._updateProgressUi(window.YtTechUi));
          } else {
            this._updateProgressUi(null);
          }
        }
      };
      const doRender = () => {
        if (currentGen !== this.renderGen || !this.isPlaying) {
          try { frame.close(); } catch {}
          return;
        }
        startAudioOnce();
        try {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
          this.ctx.drawImage(frame, 0, 0);
        } catch {}

        try {
          this.canvas.toBlob((blob) => {
            if (!blob || currentGen !== this.renderGen || !this.img) return;
            const url = URL.createObjectURL(blob);
            const old = String(this.img.src || '');
            this.img.src = url;
            if (old.startsWith('blob:')) {
              try { URL.revokeObjectURL(old); } catch {}
            }
          }, 'image/jpeg', 0.82);
        } catch {}

        try { frame.close(); } catch {}
      };

      if (drift > 0.02) setTimeout(doRender, drift * 1000);
      else doRender();
    },
  };

  window.YtTech5 = Tech5;
})();

