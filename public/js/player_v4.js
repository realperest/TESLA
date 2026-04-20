'use strict';

/**
 * TeslaPlayer V4 (Audio+Canvas Variant)
 * Amaç: V1 tabanlı ama farklı buffer profiliyle alternatif Tesla davranışı test etmek.
 */
class TeslaPlayerV4 extends TeslaPlayer {
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
      }
    });

    // Tesla tarayıcılarında suspend olabilen AudioContext'i canlı tut
    this._audioRetry = setInterval(() => {
      const audio = this.mpegPlayer?.audioOut;
      if (audio?.context?.state === 'suspended') audio.context.resume();
    }, 2000);

    this._dummyTimer = setInterval(() => {
      if (!this.mpegPlayer) return;
      const abs = (this.mpegPlayer.currentTime || 0) + (this.startTime || 0);
      this._dummyVideo.currentTime = abs;
      const dur = channel.duration || 3600;
      Object.defineProperty(this._dummyVideo, 'duration', { value: dur, configurable: true });
    }, 120);
  }

  getDiagnostics() {
    return {
      audioEnabled: true,
      currentTime: Number(this.mpegPlayer?.currentTime || 0)
    };
  }
}

window.TeslaPlayerV4 = TeslaPlayerV4;
