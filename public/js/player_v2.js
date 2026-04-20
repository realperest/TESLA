'use strict';

/**
 * TeslaPlayer V2 (WebCodecs + OffscreenCanvas Edition)
 * Zero UI-thread activity to bypass Tesla motion detection.
 */
class TeslaPlayerV2 {
    constructor(canvasId, opts = {}) {
        this.canvas = document.getElementById(canvasId);
        this.spinner = document.getElementById(opts.spinnerId || 'yt-spinner');
        
        this.worker = null;
        this.ws = null;
        this.audio = null;
        this.isPlaying = false;
        this.currentChannel = null;
        this.ptsOffset = 0;
        this._clockBaseMs = 0;
        this._lastVideoPts = 0;
        this._audioStarted = false;
        this._audioStartFallback = null;
        this._videoHealthy = false;
        this._estimatedBufferedEnd = 0;
        this._videoFallbackTimer = null;
        this._fallbackPlayer = null;
        this._fallbackCanvas = null;
        this._pausedAt = 0;
        this._pausedChannel = null;
        this._lastKnownTime = 0;

        // Sync helper
        this._syncTimer = null;
    }

    async load(channel, opts = {}) {
        this.stop();
        this.currentChannel = channel;
        this.ptsOffset = opts.startTime || 0;
        this._forcedDuration = channel.duration || 0;
        this._videoHealthy = false;
        this._estimatedBufferedEnd = this.ptsOffset;
        this._lastKnownTime = this.ptsOffset;

        if (this.spinner) this.spinner.classList.add('active');

        try {
            this._initWorker();
            this._initAudio(channel, this.ptsOffset);
            this._initWebSocket(channel, this.ptsOffset);
            return true;
        } catch (err) {
            console.error('[PlayerV2] Load Error:', err);
            return false;
        }
    }

    _initWorker() {
        if (this.worker) {
            try { this.worker.terminate(); } catch {}
            this.worker = null;
        }

        this.worker = new Worker('/js/webcodecs_worker_v2.js');
        this.worker.onmessage = (ev) => {
            const { type, payload } = ev.data || {};
            if (type !== 'status') return;

            const state = (typeof payload === 'string') ? payload : payload?.state;
            if (state === 'healthy') {
                if (payload && typeof payload.pts === 'number') {
                    this._lastVideoPts = payload.pts;
                    this._estimatedBufferedEnd = Math.max(this._estimatedBufferedEnd, payload.pts + 20);
                    this._lastKnownTime = Math.max(this._lastKnownTime || 0, payload.pts);
                }
                this._videoHealthy = true;
                if (this._videoFallbackTimer) { clearTimeout(this._videoFallbackTimer); this._videoFallbackTimer = null; }
                if (this._fallbackPlayer) {
                    try { this._fallbackPlayer.destroy(); } catch {}
                    this._fallbackPlayer = null;
                }
                if (this.spinner) this.spinner.classList.remove('active');
                this._startAudioWhenVideoReady();
                this._resyncAudioToVideo();
            }
        };
        
        // Transfer Canvas control to Worker
        const offscreen = this.canvas.transferControlToOffscreen();
        this.worker.postMessage({
            type: 'init',
            payload: { canvas: offscreen }
        }, [offscreen]);
    }

    _initAudio(channel, t) {
        if (this.audio) { this.audio.pause(); this.audio.src = ''; }
        
        this.audio = new Audio(`/stream/audio_v2?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}`);
        this.audio.crossOrigin = 'anonymous';
        this.audio.autoplay = false; // Video ile senkron için bekleteceğiz
        this.audio.preload = 'auto';
        this.audio.playbackRate = 1.0;
        
        this.audio.onplay = () => {
            this.isPlaying = true;
            this._audioStarted = true;
        };

        this.audio.onpause = () => {
            this._audioStarted = false;
            this.isPlaying = false;
        };

        this.audio.ontimeupdate = () => {
            const tNow = Number(this.audio?.currentTime || 0);
            if (Number.isFinite(tNow) && tNow > 0) {
                this._lastKnownTime = Math.max(this._lastKnownTime || 0, tNow);
            }
        };

        // Master Clock Loop
        this._syncTimer = setInterval(() => {
            if (this.worker) {
                const clockTime = this._getMasterClock();
                this.worker.postMessage({
                    type: 'clock',
                    payload: { time: clockTime }
                });
            }
        }, 16); // ~60fps sync
    }

    _initWebSocket(channel, t) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/stream/ws_v2?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this._clockBaseMs = Date.now();
        this._lastVideoPts = this.ptsOffset || 0;
        this._videoFallbackTimer = setTimeout(() => {
            if (this._videoHealthy) return;
            this._startVideoFallback(channel, t);
        }, 4500);
        this._audioStartFallback = setTimeout(() => {
            this._startAudioWhenVideoReady();
        }, 2500);

        this.ws.onmessage = (e) => {
            if (!(e.data instanceof ArrayBuffer)) return;
            if (this.worker) {
                this.worker.postMessage({ type: 'video', payload: e.data });
            }
        };

        this.ws.onclose = () => this.stop();
    }

    stop() {
        if (this._syncTimer) clearInterval(this._syncTimer);
        if (this._audioStartFallback) { clearTimeout(this._audioStartFallback); this._audioStartFallback = null; }
        if (this._videoFallbackTimer) { clearTimeout(this._videoFallbackTimer); this._videoFallbackTimer = null; }
        if (this._fallbackPlayer) {
            try { this._fallbackPlayer.destroy(); } catch {}
            this._fallbackPlayer = null;
        }
        if (this._fallbackCanvas) {
            try { this._fallbackCanvas.remove(); } catch {}
            this._fallbackCanvas = null;
        }
        if (this.worker) {
            try { this.worker.terminate(); } catch {}
            this.worker = null;
        }
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.audio) { this.audio.pause(); this.audio.src = ''; }
        this._audioStarted = false;
        this._lastVideoPts = 0;
        this._clockBaseMs = 0;
        this.isPlaying = false;
        if (this.spinner) this.spinner.classList.remove('active');
    }

    togglePlay() {
        // Hard pause/resume: ses+görüntü akışını birlikte durdurup aynı andan devam et.
        if (!this.paused) {
            const fromAudio = this.audio && Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
            const fromVideo = Number.isFinite(this._lastVideoPts) ? this._lastVideoPts : 0;
            this._pausedAt = Math.max(0, this._lastKnownTime || 0, fromAudio || 0, fromVideo || 0, this.ptsOffset || 0);
            this._pausedChannel = this.currentChannel;
            this.stop();
            return;
        }
        const ch = this._pausedChannel || this.currentChannel;
        if (ch) {
            this.load(ch, { startTime: this._pausedAt || this.ptsOffset || 0 });
            this._pausedChannel = null;
        }
    }

    setVolume(v) {
        if (this.audio) this.audio.volume = v / 100;
    }

    seekTo(seconds) {
        this.load(this.currentChannel, { startTime: seconds });
    }

    _getMasterClock() {
        if (this.audio && !this.audio.paused && Number.isFinite(this.audio.currentTime)) {
            return this.audio.currentTime;
        }
        const elapsed = this._clockBaseMs ? ((Date.now() - this._clockBaseMs) / 1000) : 0;
        return (this.ptsOffset || 0) + elapsed;
    }

    _startAudioWhenVideoReady() {
        if (!this.audio || !this.audio.paused) return;
        this.audio.play().catch(() => {});
    }

    _startVideoFallback(channel, t) {
        if (this._fallbackPlayer || this._videoHealthy) return;
        const rawUrl = channel.ytUrl || channel.url;
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}&t=${t}`;
        try {
            const host = this.canvas?.parentElement;
            if (!host) return;
            host.style.position = host.style.position || 'relative';
            this._fallbackCanvas = document.createElement('canvas');
            this._fallbackCanvas.style.position = 'absolute';
            this._fallbackCanvas.style.inset = '0';
            this._fallbackCanvas.style.width = '100%';
            this._fallbackCanvas.style.height = '100%';
            this._fallbackCanvas.style.display = 'block';
            this._fallbackCanvas.style.zIndex = '2';
            host.appendChild(this._fallbackCanvas);

            this._fallbackPlayer = new window.JSMpeg.Player(wsUrl, {
                canvas: this._fallbackCanvas,
                audio: false,
                video: true,
                autoplay: true,
                disableGl: true,
                videoBufferSize: 12 * 1024 * 1024
            });
            if (this.spinner) this.spinner.classList.remove('active');
        } catch (err) {
            console.warn('[PlayerV2] Fallback video start failed:', err?.message || err);
        }
    }

    _resyncAudioToVideo() {
        if (!this.audio || this.audio.paused) return;
        if (!Number.isFinite(this._lastVideoPts) || this._lastVideoPts <= 0) return;
        const drift = this.audio.currentTime - this._lastVideoPts;
        // Sadece ses görüntünün ilerisine geçtiyse geri çek.
        // Negatif drift'te (ses gerideyse) ileri zıplatma yapmıyoruz ki
        // konuşma ortadan başlamasın.
        if (drift > 0.35) {
            try {
                this.audio.currentTime = Math.max(0, this._lastVideoPts);
            } catch (err) {
                // Bazı tarayıcılar sık seek'i engelleyebilir.
            }
        }
    }

    get currentTime() { return this.audio ? this.audio.currentTime : 0; }
    get duration() { return this._forcedDuration || (this.audio ? this.audio.duration : 0); }
    get paused() { return this.audio ? this.audio.paused : true; }
    get hasActiveSource() { return !!(this.ws || this._fallbackPlayer); }
    get hasPendingResume() { return !!(this._pausedChannel && Number.isFinite(this._pausedAt)); }
    getBufferedEnd() {
        const dur = Number(this.duration || 0);
        const end = Number(this._estimatedBufferedEnd || this.currentTime || 0);
        return dur > 0 ? Math.min(dur, end) : end;
    }
}

window.TeslaPlayerV2 = TeslaPlayerV2;
