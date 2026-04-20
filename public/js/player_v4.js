'use strict';

/**
 * TeslaPlayer V4 (Silent Canvas)
 * Amaç: Sesi kapalı, sadece video akışıyla farklı bir Tesla davranış profili test etmek.
 */
class TeslaPlayerV4 extends TeslaPlayer {
  _startJsmpeg(channel, t = 0) {
    const rawUrl = channel.ytUrl || channel.url;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/stream/ws?url=${encodeURIComponent(rawUrl)}&t=${t}`;

    if (this.mpegPlayer) this.mpegPlayer.destroy();

    this.mpegPlayer = new window.JSMpeg.Player(wsUrl, {
      canvas: this.canvas,
      audio: false,
      video: true,
      autoplay: true,
      disableGl: true,
      videoBufferSize: 6 * 1024 * 1024,
      onPlay: () => {
        this.isPlaying = true;
      }
    });

    this._dummyTimer = setInterval(() => {
      if (!this.mpegPlayer) return;
      const abs = (this.mpegPlayer.currentTime || 0) + (this.startTime || 0);
      this._dummyVideo.currentTime = abs;
      const dur = channel.duration || 3600;
      Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
    }, 120);
  }

  toggleMute() {
    return true;
  }

  setVolume() {
    return;
  }

  getDiagnostics() {
    return {
      silentMode: true,
      currentTime: Number(this.mpegPlayer?.currentTime || 0)
    };
  }
}

window.TeslaPlayerV4 = TeslaPlayerV4;
