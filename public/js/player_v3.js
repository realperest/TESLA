'use strict';

/**
 * TeslaPlayer V3 (JSMpeg + Stall Watchdog)
 * Amaç: Akış takılırsa kullanıcı müdahalesi olmadan aynı videoyu kaldığı yerden yeniden başlatmak.
 */
class TeslaPlayerV3 extends TeslaPlayer {
  constructor(canvasId, opts = {}) {
    super(canvasId, opts);
    this._watchdogTimer = null;
    this._lastObservedTime = 0;
    this._lastProgressAt = 0;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 8;
    this._isRecovering = false;
  }

  async load(channel, opts = {}) {
    this._clearWatchdog();
    this._reconnectAttempts = 0;
    this._isRecovering = false;
    const ok = await super.load(channel, opts);
    if (ok) this._startWatchdog();
    return ok;
  }

  stop() {
    this._clearWatchdog();
    this._isRecovering = false;
    this._reconnectAttempts = 0;
    super.stop();
  }

  _startWatchdog() {
    this._lastObservedTime = 0;
    this._lastProgressAt = Date.now();

    this._watchdogTimer = setInterval(() => {
      if (!this.mpegPlayer || !this.currentChannel) return;

      const current = Number(this.mpegPlayer.currentTime || 0);
      if (current > this._lastObservedTime + 0.15) {
        this._lastObservedTime = current;
        this._lastProgressAt = Date.now();
        return;
      }

      const staleForMs = Date.now() - this._lastProgressAt;
      if (staleForMs < 3500) return;
      this._recoverFromStall();
    }, 1000);
  }

  _clearWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  async _recoverFromStall() {
    if (this._isRecovering || !this.currentChannel) return;
    if (this._reconnectAttempts >= this._maxReconnectAttempts) return;

    this._isRecovering = true;
    this._reconnectAttempts += 1;

    const resumeAt = Math.max(
      0,
      (this.startTime || 0) + Number(this.mpegPlayer?.currentTime || 0)
    );

    try {
      await super.load(this.currentChannel, { startTime: resumeAt });
      this._lastObservedTime = Number(this.mpegPlayer?.currentTime || 0);
      this._lastProgressAt = Date.now();
    } catch (err) {
      console.warn('[PlayerV3] Recover fail:', err?.message || err);
    } finally {
      this._isRecovering = false;
    }
  }

  getDiagnostics() {
    return {
      reconnectAttempts: this._reconnectAttempts,
      recovering: this._isRecovering,
      currentTime: Number(this.mpegPlayer?.currentTime || 0)
    };
  }
}

window.TeslaPlayerV3 = TeslaPlayerV3;
