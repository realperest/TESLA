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
        if (this.audioContext) { try { this.audioContext.close(); } catch {} }
        
        // JSMpeg'in ses motorunu bağımsız olarak kullanıyoruz
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.audioOut = new window.JSMpeg.AudioOutput({ context: this.audioContext });
        this.audioOut.volume = 1;
        
        // Master Clock Sync Loop
        this._syncTimer = setInterval(() => {
            if (this.worker && this.audioContext) {
                const clockTime = this._getMasterClock();
                this.worker.postMessage({ type: 'clock', payload: { time: clockTime } });
            }
        }, 16);
    }

    _initWebSocket(channel, t) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        // V5/V8 Hibrit Akış: Hem ses hem video içeren WS
        const url = `${proto}//${location.host}/stream/ws?url=${encodeURIComponent(channel.ytUrl || channel.url)}&t=${t}&v8=1`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this._clockBaseMs = Date.now();

        this.ws.onmessage = (e) => {
            if (!(e.data instanceof ArrayBuffer)) return;
            const buf = e.data;
            // İlk byte kontrolü: 0x00=Video, 0x01=Audio (Backend buna göre gönderecek)
            const view = new Uint8Array(buf);
            if (view[0] === 0x00) {
                if (this.worker) this.worker.postMessage({ type: 'video', payload: buf.slice(1) });
            } else if (view[0] === 0x01) {
                if (this.audioOut) this.audioOut.write(buf.slice(1));
            }
        };

        this.ws.onclose = () => this.stop();
    }

    _getMasterClock() {
        if (this.audioContext && this.audioContext.state === 'running') {
            return this.audioContext.currentTime + (this.ptsOffset || 0);
        }
        const elapsed = this._clockBaseMs ? ((Date.now() - this._clockBaseMs) / 1000) : 0;
        return (this.ptsOffset || 0) + elapsed;
    }

    _startAudioWhenVideoReady() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    stop() {
        if (this._syncTimer) clearInterval(this._syncTimer);
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.audioContext) { try { this.audioContext.close(); } catch {} this.audioContext = null; }
        this.audioOut = null;
        this.isPlaying = false;
        if (this.spinner) this.spinner.classList.remove('active');
    }

    togglePlay() {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'running') {
            this.audioContext.suspend();
            this.isPlaying = false;
        } else {
            this.audioContext.resume();
            this.isPlaying = true;
        }
    }

    seek(seconds) {
        this.load(this.currentChannel, { startTime: seconds });
    }

    setVolume(v) { if (this.audioOut) this.audioOut.volume = v / 100; }
    
    get paused() { return this.audioContext ? this.audioContext.state === 'suspended' : true; }
    get currentTime() { return this._getMasterClock(); }
    get hasActiveSource() { return !!this.ws; }
    unlockAudio() { 
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {}); 
        }
    }
}

window.TeslaPlayerV8 = TeslaPlayerV8;
