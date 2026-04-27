'use strict';

/**
 * TeslaPlayer V4 (HD + Precise Sync + HUD Force)
 * - v260425.0109: HUD z-index 9999 !important yapıldı. Drift prevention eklendi.
 */
class TeslaPlayerV4 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
        this._spinnerDelayTimer = null;
        this._hudContainer = document.getElementById('yt-player-container'); // Kontrollerin olduğu kapsayıcı
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
        // Saniyeyi tam sayıya yuvarlayarak gönderiyoruz (backend beklentisi)
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
            audioBufferSize: 512 * 1024,   // 512KB
            videoBufferSize: 2 * 1024 * 1024, // 2MB
            maxAudioLag: 0.8, // Agresif senkronizasyon (Yağ gibi akış için)
            onPlay: () => {
                this.isPlaying = true;
                // Bağlantı geri geldiğinde sesi sıfırla (üst üste binmeyi önler)
                if (this.mpegPlayer.audioOut && this.mpegPlayer.audioOut.context) {
                    this.mpegPlayer.audioOut.context.resume();
                }
                this._sessionStartedAtMs = Date.now();
                if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);
                
                this.canvas.style.visibility = 'visible';
                this._removeFreezeFrame();
                this._removeResumingOverlay();
                console.log('[V4] Playback started');

                // Oynarken kontrollerin otomatik gizlenmesine izin ver (style'ı temizle)
                const controls = document.getElementById('yt-external-controls');
                const header = document.getElementById('yt-external-header');
                if (controls) controls.style.opacity = '';
                if (header) header.style.opacity = '';

                if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
                const spinner = document.getElementById(this.spinnerId);
                if (spinner) spinner.classList.remove('active');
                
                // Merkezi pause ikonunu kaldır
                document.getElementById('yt-player-area')?.classList.remove('yt-paused');
                const btn = document.getElementById('yt-btn-play');
                if (btn && typeof YC_ICONS !== 'undefined') btn.innerHTML = YC_ICONS.pause;
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
        }, 100);

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
            this._pausedAtAbs = this._lastKnownAbsTime;
            this._pausedChannel = this.currentChannel;
            this.stop(true); 
            
            // DURAKLATINCA KONTROLLERİ ZORLA GÖRÜNÜR YAP
            const controls = document.getElementById('yt-external-controls');
            const header = document.getElementById('yt-external-header');
            if (controls) controls.style.opacity = '1';
            if (header) header.style.opacity = '1';
            
            return;
        }

        if (this._pausedChannel && this._pausedAtAbs > 0) {
            // Tam saniyeden devam
            this.load(this._pausedChannel, { startTime: this._pausedAtAbs });
        } else if (this.currentChannel) {
            this.load(this.currentChannel, { startTime: this.startTime || 0 });
        }
    }

    _createFreezeFrame() {
        // Kontrollerin olduğu yt-player-container içine ekle
        const container = this._hudContainer || document.getElementById('yt-player-container');
        if (!container || !this.canvas) return;
        
        this._removeFreezeFrame();
        
        const freeze = document.createElement('canvas');
        freeze.id = 'v4-freeze-frame';
        freeze.width = this.canvas.width;
        freeze.height = this.canvas.height;
        // z-index: 1 -> Canvas'ın üstünde ama HUD'un (z-index belirtilmemişse 0'dır, ama genelde üsttedir) altında
        // HUD elemanları player-container içinde olduğu için bu canvas'ı en başa eklersek arkada kalır
        freeze.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; z-index:1; pointer-events:none; object-fit:contain;';

        const ctx = freeze.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(this.canvas, 0, 0);
                // Container'ın en başına ekle (diğer elemanların arkasında kalsın)
                container.insertBefore(freeze, container.firstChild);
            } catch (e) { console.warn('[V4] Clone failed:', e); }
        }
    }

    _removeFreezeFrame() {
        const old = document.getElementById('v4-freeze-frame');
        if (old) old.remove();
    }

    _showResumingOverlay() {
        const container = this._hudContainer || document.getElementById('yt-player-container');
        if (!container) return;
        this._removeResumingOverlay();

        const overlay = document.createElement('div');
        overlay.id = 'v4-resuming-overlay';
        overlay.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:50; pointer-events:none; background-color:rgba(0,0,0,0.4);';

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
            const controls = document.getElementById('yt-external-controls');
            const header = document.getElementById('yt-external-header');
            if (controls) controls.style.opacity = '';
            if (header) header.style.opacity = '';

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
