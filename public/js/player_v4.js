'use strict';

/**
 * TeslaPlayer V4 (Audio+Canvas Variant)
 * Amaç: JSMpeg tabanlı, hafif ve stabil oynatıcı. 
 * Duraklatma (Pause) sırasında bağlantıyı tamamen keser, devam ederken (Play) son pozisyondan yeniden bağlanır.
 * Bu sayede duraklatma sonrası oluşan ses/görüntü binişmesi ve "catch-up" (yetişme) sorunu engellenir.
 */
class TeslaPlayerV4 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
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
                if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
                // Spinner'ı kaldır (Base class desteği için)
                const spinner = document.getElementById(this.spinnerId);
                if (spinner) spinner.classList.remove('active');
            }
        });

        // Tesla tarayıcılarında suspend olabilen AudioContext'i canlı tut
        this._audioRetry = setInterval(() => {
            const audio = this.mpegPlayer?.audioOut;
            if (audio?.context?.state === 'suspended') audio.context.resume();
        }, 2000);

        // İlerleme senkronizasyonu
        this._dummyTimer = setInterval(() => {
            if (!this.mpegPlayer) return;
            const abs = (this.mpegPlayer.currentTime || 0) + (this.startTime || 0);
            this._dummyVideo.currentTime = abs;
            this._lastKnownAbsTime = Math.max(this._lastKnownAbsTime || 0, abs || 0);
            const dur = channel.duration || 3600;
            Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
        }, 120);

        // Cloudflare/Railway Zaman Aşımı Engelleyici (Heartbeat)
        // Her 10 saniyede bir boş paket göndererek bağlantıyı aktif tutar.
        this._heartbeatTimer = setInterval(() => {
            if (this.mpegPlayer && this.mpegPlayer.source && this.mpegPlayer.source.socket) {
                const socket = this.mpegPlayer.source.socket;
                if (socket.readyState === 1) { // OPEN
                    socket.send(JSON.stringify({ type: 'hb', ts: Date.now() }));
                }
            }
        }, 10000);
    }

    /**
     * Pause/Resume mantığını V4 için özelleştiriyoruz.
     * Duraklatma yapıldığında stream'i tamamen durdurur (Stop).
     * Oynatma yapıldığında son kalınan saniyeden tekrar bağlanır (Load).
     */
    togglePlay() {
        if (this.isPlaying) {
            // DURAKLAT (PAUSE) -> Aslında tamamen durduruyoruz.
            this._pausedAtAbs = this._lastKnownAbsTime;
            this._pausedChannel = this.currentChannel;
            console.log(`[V4] Paused at: ${this._pausedAtAbs}s - Connection closed.`);
            this.stop();
            return;
        }

        // DEVAM ET (PLAY) -> Son kalınan noktadan yükle.
        if (this._pausedChannel && this._pausedAtAbs > 0) {
            console.log(`[V4] Resuming at: ${this._pausedAtAbs}s - Reconnecting...`);
            this.load(this._pausedChannel, { startTime: this._pausedAtAbs });
            this._pausedChannel = null;
            this._pausedAtAbs = 0;
        } else if (this.currentChannel) {
            // Eğer kanal varsa ama pause datası yoksa (belki ilk start)
            this.load(this.currentChannel, { startTime: this.startTime || 0 });
        }
    }

    stop() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        super.stop();
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
