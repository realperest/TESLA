'use strict';

/**
 * TeslaPlayer V4 (Zero-Flash Variant)
 * Amaç: Duraklatma ve Devam etme sırasında hiçbir beyaz/gri flaşlama olmaması.
 * Pause -> Canvas'ın görüntüsünü al ve arka plana koy.
 * Play -> Yayın gelene kadar Canvas'ı gizli tut, hazır olunca göster.
 */
class TeslaPlayerV4 extends TeslaPlayer {
    constructor(canvasId, opts = {}) {
        super(canvasId, opts);
        this._heartbeatTimer = null;
        this._spinnerDelayTimer = null;
    }

    async load(channel, opts = {}) {
        // Durdururken son kareyi arka plana sabitle (screenshot al)
        this.stop(true); 
        
        this.currentChannel = channel;
        this.startTime = opts.startTime || 0;
        this._pausedChannel = null;
        this._pausedAtAbs = 0;
        
        const isResume = this.startTime > 0;
        const spinner = document.getElementById(this.spinnerId);
        
        if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);

        if (isResume) {
            if (spinner) {
                spinner.classList.remove('active');
                spinner.style.background = 'transparent';
            }
            // Resume sırasında spinner'ı çok uzun süre beklet (10sn)
            this._spinnerDelayTimer = setTimeout(() => {
                if (!this.isPlaying && spinner) spinner.classList.add('active');
            }, 10000); 
        } else {
            if (spinner) {
                spinner.style.background = 'rgba(0,0,0,0.5)';
                spinner.classList.add('active');
            }
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

        // Canvas'ı gizleyelim (arka plandaki screenshot görünsün)
        if (t > 0) this.canvas.style.visibility = 'hidden';

        this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
            canvas: this.canvas,
            audio: true,
            video: true,
            autoplay: true,
            disableGl: true,
            preserveDrawingBuffer: true,
            audioBufferSize: 8 * 1024 * 1024,
            videoBufferSize: 20 * 1024 * 1024,
            maxAudioLag: 1.8,
            onPlay: () => {
                this.isPlaying = true;
                if (this._spinnerDelayTimer) clearTimeout(this._spinnerDelayTimer);
                
                // Yayın hazır! Canvas'ı göster ve arka plan resmini temizle
                this.canvas.style.visibility = 'visible';
                const container = document.getElementById(this.containerId);
                if (container) {
                    container.style.backgroundImage = 'none';
                }

                if (this.mpegPlayer.audioOut) this.mpegPlayer.volume = 1;
                
                const spinner = document.getElementById(this.spinnerId);
                if (spinner) {
                    spinner.classList.remove('active');
                    spinner.style.background = 'rgba(0,0,0,0.5)';
                }
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
            this.stop(true); // freeze frame + screenshot
            return;
        }

        if (this._pausedChannel && this._pausedAtAbs > 0) {
            this.load(this._pausedChannel, { startTime: this._pausedAtAbs });
        } else if (this.currentChannel) {
            this.load(this.currentChannel, { startTime: this.startTime || 0 });
        }
    }

    stop(keepFrame = false) {
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._spinnerDelayTimer) { clearTimeout(this._spinnerDelayTimer); this._spinnerDelayTimer = null; }
        if (this._audioRetry) { clearInterval(this._audioRetry); this._audioRetry = null; }
        if (this._dummyTimer) { clearInterval(this._dummyTimer); this._dummyTimer = null; }

        if (keepFrame && this.canvas) {
            try {
                // Ekran görüntüsü al ve container arka planına koy
                const dataUrl = this.canvas.toDataURL('image/jpeg', 0.8);
                const container = document.getElementById(this.containerId);
                if (container) {
                    container.style.backgroundImage = `url(${dataUrl})`;
                    container.style.backgroundSize = 'cover';
                    container.style.backgroundPosition = 'center';
                }
                this.canvas.style.visibility = 'hidden';
            } catch (e) {
                console.warn('[V4] Screenshot failed:', e);
            }
        }

        if (this.mpegPlayer) {
            this.mpegPlayer.destroy();
            this.mpegPlayer = null;
        }
        
        this.isPlaying = false;

        if (!keepFrame) {
            const container = document.getElementById(this.containerId);
            if (container) container.style.backgroundImage = 'none';
            this.canvas.style.visibility = 'visible';

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
