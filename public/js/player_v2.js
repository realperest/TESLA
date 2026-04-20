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

        // Sync helper
        this._syncTimer = null;
    }

    async load(channel, opts = {}) {
        this.stop();
        this.currentChannel = channel;
        this.ptsOffset = opts.startTime || 0;
        this._forcedDuration = channel.duration || 0;

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
        if (this.worker) return;

        this.worker = new Worker('/js/webcodecs_worker_v2.js');
        
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
        
        this.audio.onplay = () => {
            this.isPlaying = true;
            if (this.spinner) this.spinner.classList.remove('active');
        };

        // Master Clock Loop
        this._syncTimer = setInterval(() => {
            if (this.audio && this.worker) {
                this.worker.postMessage({
                    type: 'clock',
                    payload: { time: this.audio.currentTime }
                });
            }
        }, 16); // ~60fps sync
    }

    _initWebSocket(channel, t) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/stream/ws_v2?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        let firstBinaryReceived = false;

        this.ws.onmessage = async (e) => {
            if (!(e.data instanceof ArrayBuffer)) return;
            
            // ATOMIC START: İlk veri geldiğinde sesi uyandır
            if (!firstBinaryReceived) {
                firstBinaryReceived = true;
                if (this.audio && this.audio.paused) {
                    this.audio.play().catch(() => {});
                }
            }

            if (this.worker) {
                this.worker.postMessage({
                    type: 'video',
                    payload: e.data
                });
            }
        };

        this.ws.onclose = () => this.stop();
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
        this.audio.paused ? this.audio.play() : this.audio.pause();
    }

    setVolume(v) {
        if (this.audio) this.audio.volume = v / 100;
    }

    seekTo(seconds) {
        this.load(this.currentChannel, { startTime: seconds });
    }

    get currentTime() { return this.audio ? this.audio.currentTime : 0; }
    get duration() { return this._forcedDuration || (this.audio ? this.audio.duration : 0); }
    get paused() { return this.audio ? this.audio.paused : true; }
}

window.TeslaPlayerV2 = TeslaPlayerV2;
