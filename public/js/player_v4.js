'use strict';

/**
 * TeslaPlayer V4 (Precise HUD + Sync Variant)
 * Amaç: Duraklatıldığında HUD araçlarının görünür kalmasını sağlamak 
 * ve Resume sırasında saniye atlamasını (offset ile) engellemek.
 */
class TeslaPlayerV4 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
        this._spinnerDelayTimer = null;
    }

    async load(channel, opts = {}) {
        this.stop(true); 
        
        this.currentChannel = channel;
        this.startTime = opts.startTime || 0;
        
        const isResume = this.startTime > 0;
        const spinner = document.getElementById(this.spinnerId);
        
        if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);

        if (isResume) {
            if (spinner) spinner.classList.remove('active');
            this._showResumingOverlay();
        } else {
            if (spinner) spinner.classList.add('active');
        }

        try {
            this._startJsmpeg(channel, this.startTime);
            return true;
        } catch (err) {
            console.error('[V4] Load Error:', err);
            this._removeFreezeFrame();
            this._removeResumingOverlay();
            return false;
        }
    }

    _startJsmpeg(channel, t = 0) {
        const rawUrl = channel.ytUrl || channel.url;
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const seekTime = Math.floor(t);
        const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}&t=${seekTime}`;

        if (this.mpegPlayer) {
            this.mpegPlayer.destroy();
            this.mpegPlayer = null;
        }

        if (t > 0) this.canvas.style.visibility = 'hidden';

        this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
            canvas: this.canvas,
            audio: true,
            video: true,
            autoplay: true,
            disableGl: true,
            preserveDrawingBuffer: true,
            audioBufferSize: 2 * 1024 * 1024,
            videoBufferSize: 4 * 1024 * 1024,
            maxAudioLag: 0.8,
            onPlay: () => {
                this.isPlaying = true;
                this._sessionStartedAtMs = Date.now();
                if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);
                
                this.canvas.style.visibility = 'visible';
                this._removeFreezeFrame();
                this._removeResumingOverlay();

                if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
                const spinner = document.getElementById(this.spinnerId);
                if (spinner) spinner.classList.remove('active');
            }
        });

        this._audioRetry = setInterval(() => {
            const audio = this.mpegPlayer?.audioOut;
            if (audio?.context?.state === 'suspended') audio.context.resume();
        }, 2000);

        this._dummyTimer = setInterval(() => {
            if (!this.mpegPlayer) return;
            const abs = (this.mpegPlayer.currentTime || 0) + (this.startTime || 0);
            this._dummyVideo.currentTime = abs;
            this._lastKnownAbsTime = Math.max(this._lastKnownAbsTime || 0, abs || 0);
            
            const dur = this.currentChannel?.duration || 3600;
            if (this._dummyVideo.duration !== dur) {
                Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
            }
        }, 120);

        this._heartbeatTimer = setInterval(() => {
            if (this.mpegPlayer && this.mpegPlayer.source && this.mpegPlayer.source.socket) {
                const socket = this.mpegPlayer.source.socket;
                if (socket.readyState === 1) {
                    socket.send(JSON.stringify({ type: 'hb', ts: Date.now() }));
                }
            }
        }, 10000);
    }

    togglePlay() {
        if (this.isPlaying) {
            // Duraklatırken süreyi milisaniyelik hassasiyetle yakala
            const exactTime = this._lastKnownAbsTime;
            this._pausedAtAbs = exactTime;
            this._pausedChannel = this.currentChannel;
            this.stop(true); // Freeze frame aktif
            return;
        }

        if (this._pausedChannel && this._pausedAtAbs > 0) {
            // ATLAMA ÖNLEYİCİ: Durulan yerin 0.5 - 1 saniye gerisinden başla (Flow koruması)
            const resumePoint = Math.max(0, this._pausedAtAbs - 0.5);
            this.load(this._pausedChannel, { startTime: resumePoint });
        } else if (this.currentChannel) {
            this.load(this.currentChannel, { startTime: this.startTime || 0 });
        }
    }

    _createFreezeFrame() {
        const container = document.getElementById(this.containerId);
        if (!container || !this.canvas) return;
        
        this._removeFreezeFrame();
        const rect = this.canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const freeze = document.createElement('canvas');
        freeze.id = 'v4-freeze-frame';
        freeze.width = this.canvas.width;
        freeze.height = this.canvas.height;
        
        // Z-INDEX: Kontrollerin (HUD) altında kalması için 2 yapıldı
        freeze.style.cssText = `position:absolute; top:${rect.top - containerRect.top}px; left:${rect.left - containerRect.left}px; width:${rect.width}px; height:${rect.height}px; z-index:2; pointer-events:none;`;

        const ctx = freeze.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(this.canvas, 0, 0);
                container.appendChild(freeze);
            } catch (e) { console.warn('[V4] Clone failed:', e); }
        }
    }

    _removeFreezeFrame() {
        const old = document.getElementById('v4-freeze-frame');
        if (old) old.remove();
    }

    _showResumingOverlay() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        this._removeResumingOverlay();

        const overlay = document.createElement('div');
        overlay.id = 'v4-resuming-overlay';
        // Z-INDEX: Kontrollerin ve freeze-frame'in üzerinde olması için 15
        overlay.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:15; pointer-events:none; backdrop-filter:blur(3px); background-color:rgba(0,0,0,0.1);';

        const text = (typeof AppI18n !== 'undefined' ? AppI18n.t('resuming') : 'DEVAM EDİLİYOR...').toUpperCase();
        overlay.innerHTML = `
            <div style="background:rgba(0,0,0,0.85); color:#fff; padding:14px 28px; border-radius:14px; font-size:14px; font-weight:800; border:1px solid rgba(255,255,255,0.1); box-shadow:0 12px 40px rgba(0,0,0,0.6); display:flex; align-items:center; gap:14px; letter-spacing:1px;">
                <div class="spinner-ring" style="width:22px;height:22px;border-width:3px;border-top-color:#e82127"></div>
                <span>${text}</span>
            </div>
        `;
        container.appendChild(overlay);
    }

    _removeResumingOverlay() {
        const old = document.getElementById('v4-resuming-overlay');
        if (old) old.remove();
    }

    stop(keepFrame = false) {
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._spinnerDelayTimer) { clearTimeout(this._spinnerDelayTimer); this._spinnerDelayTimer = null; }
        if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
        if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }

        if (keepFrame && this.canvas) {
            this._createFreezeFrame();
        }

        if (this.mpegPlayer) {
            this.mpegPlayer.destroy();
            this.mpegPlayer = null;
        }
        
        this.isPlaying = false;

        if (!keepFrame) {
            this._removeFreezeFrame();
            this._removeResumingOverlay();
            try {
                const ctx = this.canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                }
            } catch {}
        }
    }
}

window.TeslaPlayerV4 = TeslaPlayerV4;
