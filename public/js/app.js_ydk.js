'use strict';

/**
 * app.js - TobeTube Core Logic (V5/V8 Edition)
 * Sadeleştirilmiş ve stabilize edilmiş sürüm.
 */

let _activeSection = 'tv';
let _activeCategory = 'all';
let ytPlayerV5;
let ytPlayerV8;
let channels = [];
let allChannels = [];
let tvCategoryFilter = 'all';

function isYoutubeSection(section) {
  return section === 'youtube_v5' || section === 'youtube_v8';
}

function getYtPlayerBySection(section = _activeSection) {
  if (section === 'youtube_v8') return ytPlayerV8;
  if (section === 'youtube_v5') return ytPlayerV5;
  return ytPlayerV8;
}

function getYtVariantLabel(section = _activeSection) {
  if (section === 'youtube_v8') return 'YouTube';
  if (section === 'youtube_v5') return 'YouTube (V5)';
  return 'YouTube';
}

function init() {
  console.log('[App] Initializing (V5/V8 Only)...');
  
  // Oynatıcıları Oluştur
  window.ytPlayerV5 = new TeslaPlayerV5('yt-canvas-v5', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.ytPlayerV8 = new TeslaPlayerV8('yt-canvas-v8', { spinnerId: 'yt-spinner' });
  
  ytPlayerV5 = window.ytPlayerV5;
  ytPlayerV8 = window.ytPlayerV8;

  // Global Sync
  const unlock = () => {
    if (window.ytPlayerV8) window.ytPlayerV8.unlockAudio();
    if (window.iptvPlayer) window.iptvPlayer.unlockAudio();
  };
  document.addEventListener('touchstart', unlock, { once: true });
}

// ... Diğer UI ve veri yükleme mantığı ...
// (Burada mevcut app.js'in geri kalanını koruyorum ama YouTube mantığını sadeleştiriyorum)
