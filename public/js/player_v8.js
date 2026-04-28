'use strict';

/**
 * TeslaPlayer V8 (Ultimate WebCodecs Engine)
 * - SIFIR Sunucu CPU kullanımı (Copy Codec).
 * - Tesla Donanım Dekoderi (Prefer Hardware).
 * - Canvas Rendering (No Video Tag).
 * - Stealth Mode (Bypass Driving Block).
 */
class TeslaPlayerV8 {
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
        this._videoHealthy = false;
        this._lastKnownTime = 0;
        this._workerInitialized = false;
        this._syncTimer = null;
    }

    async load(channel, opts = {}) {
        this.stop();
        this.currentChannel = channel;
        this.ptsOffset = opts.startTime || 0;
        this._videoHealthy = false;
        this._lastKnownTime = this.ptsOffset;

        if (this.spinner) this.spinner.classList.add('active');

        try {
            this._initWorker();
            if (this.worker) this.worker.postMessage({ type: 'reset' });
            this._initAudio(channel, this.ptsOffset);
            this._initWebSocket(channel, this.ptsOffset);
            return true;
        } catch (err) {
            console.error('[V8] Load Error:', err);
            return false;
        }
    }

    _initWorker() {
        if (this.worker) return;

        this.worker = new Worker('/js/webcodecs_worker_v2.js');
        this.worker.onmessage = (ev) => {
            const { type, payload } = ev.data || {};
            if (type !== 'status') return;

            const state = (typeof payload === 'string') ? payload : payload?.state;
            if (state === 'healthy') {
                if (payload && typeof payload.pts === 'number') {
                    this._lastVideoPts = payload.pts;
                }
                this._videoHealthy = true;
                if (this.spinner) this.spinner.classList.remove('active');
                this._startAudioWhenVideoReady();
            }
        };
        
        if (!this._workerInitialized) {
            const offscreen = this.canvas.transferControlToOffscreen();
            this.worker.postMessage({
                type: 'init',
                payload: { canvas: offscreen }
            }, [offscreen]);
            this._workerInitialized = true;
        }
    }

    _initAudio(channel, t) {
        if (this.audio) { this.audio.pause(); this.audio.src = ''; }
        
        // Ses akışını da V2 üzerinden çekiyoruz (Master Clock için)
        this.audio = new Audio(`/stream/audio_v2?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}`);
        this.audio.crossOrigin = 'anonymous';
        this.audio.autoplay = false;
        this.audio.preload = 'auto';
        
        this.audio.onplay = () => { this.isPlaying = true; };
        this.audio.onpause = () => { this.isPlaying = false; };
        this.audio.ontimeupdate = () => {
            if (this.audio && Number.isFinite(this.audio.currentTime)) {
                this._lastKnownTime = this.audio.currentTime;
            }
        };

        // Master Clock Sync Loop
        this._syncTimer = setInterval(() => {
            if (this.worker) {
                const clockTime = this._getMasterClock();
                this.worker.postMessage({ type: 'clock', payload: { time: clockTime } });
            }
        }, 16);
    }

    _initWebSocket(channel, t) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/stream/ws_v2?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this._clockBaseMs = Date.now();

        this.ws.onmessage = (e) => {
            if (!(e.data instanceof ArrayBuffer)) return;
            if (this.worker) this.worker.postMessage({ type: 'video', payload: e.data });
        };

        this.ws.onclose = () => this.stop();
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

    stop() {
        if (this._syncTimer) clearInterval(this._syncTimer);
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.audio) { this.audio.pause(); this.audio.src = ''; }
        this.isPlaying = false;
        if (this.spinner) this.spinner.classList.remove('active');
    }

    togglePlay() {
        if (!this.audio) return;
        if (this.audio.paused) this.audio.play().catch(() => {});
        else this.audio.pause();
    }

    seek(seconds) {
        this.load(this.currentChannel, { startTime: seconds });
    }

    setVolume(v) { if (this.audio) this.audio.volume = v / 100; }
    
    get video() { return this.audio; } // UI kontrolleri için referans
    get paused() { return this.audio ? this.audio.paused : true; }
    get currentTime() { return this.audio ? this.audio.currentTime : this._lastKnownTime; }
    get hasActiveSource() { return !!this.ws; }
    unlockAudio() { if (this.audio) this.audio.play().then(() => this.audio.pause()).catch(() => {}); }
}

window.TeslaPlayerV8 = TeslaPlayerV8;
