'use strict';

/**
 * TeslaPlayer V4 (Audio+Canvas Variant)
 * Amaç: JSMpeg tabanlı, hafif ve stabil oynatıcı. 
 * Duraklatma (Pause) sırasında bağlantıyı keser ancak son kareyi (freeze-frame) ekranda tutar.
 * Devam ederken (Play) yükleniyor yazısını geciktirerek akıcı bir geçiş sağlar.
 */
class TeslaPlayerV4 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
        this._spinnerDelayTimer = null;
    }

    async load(channel, opts = {}) {
        // Durdur ama ekranı karartma
        this.stop(true); 
        
        this.currentChannel = channel;
        this.startTime = opts.startTime || 0;
        this._pausedChannel = null;
        this._pausedAtAbs = 0;
        
        const isResume = this.startTime > 0;
        const spinner = document.getElementById(this.spinnerId);
        
        if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);

        // Resume (devam etme) durumunda spinner'ı hemen gösterme, 2 saniye bekle.
        // Eğer 2 saniye içinde yayın başlarsa kullanıcı hiç "Yükleniyor" görmez.
        if (isResume) {
            if (spinner) spinner.classList.remove('active');
            this._spinnerDelayTimer = setTimeout(() => {
                if (!this.isPlaying && spinner) spinner.classList.add('active');
            }, 2000);
        } else {
            if (spinner) spinner.classList.add('active');
        }

        try {
            this._startJsmpeg(channel, this.startTime);
            return true;
        } catch (err) {
            console.error('[V4] Load Error:', err);
            if (spinner) spinner.classList.remove('active');
            return false;
        }
    }

    _startJsmpeg(channel, t = 0) {
        const rawUrl = channel.ytUrl || channel.url;
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}&t=${t}`;

        if (this.mpegPlayer) this.mpegPlayer.destroy();

        this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
            canvas: this.canvas,
            audio: true,
            video: true,
            autoplay: true,
            disableGl: true,
            audioBufferSize: 8 * 1024 * 1024,
            videoBufferSize: 20 * 1024 * 1024,
            maxAudioLag: 1.8,
            onPlay: () => {
                this.isPlaying = true;
                if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);
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
            const dur = channel.duration || 3600;
            Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
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
            this._pausedAtAbs = this._lastKnownAbsTime;
            this._pausedChannel = this.currentChannel;
            // stop(true) -> ekranı karartmadan durdur
            this.stop(true); 
            return;
        }

        if (this._pausedChannel && this._pausedAtAbs > 0) {
            this.load(this._pausedChannel, { startTime: this._pausedAtAbs });
        } else if (this.currentChannel) {
            this.load(this.currentChannel, { startTime: this.startTime || 0 });
        }
    }

    /**
     * @param {boolean} keepFrame - Eğer true ise ekran siyaha boyanmaz, son kare kalır.
     */
    stop(keepFrame = false) {
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._spinnerDelayTimer) { clearTimeout(this._spinnerDelayTimer); this._spinnerDelayTimer = null; }
        if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
        if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }

        if (this.mpegPlayer) {
            this.mpegPlayer.destroy();
            this.mpegPlayer = null;
        }
        
        this.isPlaying = false;

        // Ekranı karartma mantığı (Base class'tan farklı olarak opsiyonel)
        if (!keepFrame) {
            try {
                const ctx = this.canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                }
            } catch {}
        }
    }

    getDiagnostics() {
        return {
            audioEnabled: true,
            currentTime: Number(this.mpegPlayer?.currentTime || 0),
            hbActive: !!this._heartbeatTimer
        };
    }
}

window.TeslaPlayerV4 = TeslaPlayerV4;
