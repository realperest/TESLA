'use strict';

/**
 * TeslaPlayer V5 (Buffer Freeze Edition)
 * - V4'ün HD altyapısını kullanır.
 * - Pause/Resume sırasında bağlantıyı koparmaz.
 * - Backend'e "pause" sinyali göndererek FFmpeg pipe'ını dondurur.
 * - Böylece anında kaldığı yerden, hiçbir kayıp olmadan devam eder.
 */
class TeslaPlayerV5 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
        this._spinnerDelayTimer = null;
        this._hudContainer = document.getElementById('yt-player-container');
    }

    async load(channel, opts = {}) {
        // Eğer zaten bu kanaldaysak ve mpegPlayer varsa, baştan yükleme, sadece resume yap.
        if (this.currentChannel && this.currentChannel.ytUrl === (channel.ytUrl || channel.url) && this.mpegPlayer && !this.isPlaying) {
            this.togglePlay();
            return true;
        }

        this.stop(false, true); // tam sıfırlama
        
        this.currentChannel = channel;
        this.startTime = opts.startTime || 0;
        
        const spinner = document.getElementById(this.spinnerId);
        if (spinner) spinner.classList.add('active');

        try {
            this._startJsmpeg(channel, this.startTime);
            return true;
        } catch (err) {
            console.error('[V5] Load Error:', err);
            this._removeFreezeFrame();
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
            audioBufferSize: 4 * 1024 * 1024,
            videoBufferSize: 16 * 1024 * 1024,
            maxAudioLag: 0.8,
            onPlay: () => {
                this.isPlaying = true;
                if (this.mpegPlayer.audioOut && this.mpegPlayer.audioOut.context) {
                    this.mpegPlayer.audioOut.context.resume();
                }
                this._sessionStartedAtMs = Date.now();
                if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);
                
                this.canvas.style.visibility = 'visible';
                this._removeFreezeFrame();

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
            if (this.isPlaying) {
                const audio = this.mpegPlayer?.audioOut;
                if (audio?.context?.state === 'suspended') audio.context.resume();
            }
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
        if (!this.mpegPlayer || !this.mpegPlayer.source || !this.mpegPlayer.source.socket) return;
        const socket = this.mpegPlayer.source.socket;

        if (this.isPlaying) {
            // BACKEND'İ DONDUR
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'pause' }));
            }
            
            // FRONTEND OYNATICIYI DURDUR
            if (this.mpegPlayer) this.mpegPlayer.pause();
            this.isPlaying = false;
            
            // Çerçevenin son halini ekranda tutmak için freeze frame oluştur.
            setTimeout(() => this._createFreezeFrame(), 100);
            
            const controls = document.getElementById('yt-external-controls');
            const header = document.getElementById('yt-external-header');
            if (controls) controls.style.opacity = '1';
            if (header) header.style.opacity = '1';
        } else {
            // BACKEND'İ ÇÖZ
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'resume' }));
            }
            
            // TAMPONU TEMİZLE (Hızlı sarmayı engeller)
            if (this.mpegPlayer) {
                if (this.mpegPlayer.videoOut) this.mpegPlayer.videoOut.reset();
                if (this.mpegPlayer.audioOut) this.mpegPlayer.audioOut.reset();
                this.mpegPlayer.play();
            }
            this.isPlaying = true;
            
            this._removeFreezeFrame();

            const controls = document.getElementById('yt-external-controls');
            const header = document.getElementById('yt-external-header');
            if (controls) controls.style.opacity = '';
            if (header) header.style.opacity = '';
        }
    }

    _createFreezeFrame() {
        const container = this._hudContainer || document.getElementById('yt-player-container');
        if (!container || !this.canvas) return;
        
        this._removeFreezeFrame();
        
        const freeze = document.createElement('canvas');
        freeze.id = 'v5-freeze-frame';
        freeze.width = this.canvas.width;
        freeze.height = this.canvas.height;
        freeze.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; z-index:1; pointer-events:none; object-fit:contain;';

        const ctx = freeze.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(this.canvas, 0, 0);
                container.insertBefore(freeze, container.firstChild);
            } catch (e) { console.warn('[V5] Clone failed:', e); }
        }
    }

    _removeFreezeFrame() {
        const old = document.getElementById('v5-freeze-frame');
        if (old) old.remove();
    }

    stop(keepFrame = false, forceDestroy = false) {
        if (!forceDestroy && this.isPlaying) {
            // Sadece duraklat
            this.togglePlay();
            return;
        }

        // Tamamen yok et
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._spinnerDelayTimer) { clearTimeout(this._spinnerDelayTimer); this._spinnerDelayTimer = null; }
        if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
        if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }

        if (this.mpegPlayer) {
            this.mpegPlayer.destroy();
            this.mpegPlayer = null;
        }
        
        this.isPlaying = false;
        this._removeFreezeFrame();

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

window.TeslaPlayerV5 = TeslaPlayerV5;
