/**
 * app.js - TobeTube Core Logic (V5/V8 Final)
 */

const API = {
  async get(path) {
    const r = await fetch(`/api${path}`);
    if (r.status === 401) { location.href = '/login.html'; throw new Error('401'); }
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('401'); }
    return r.json();
  },
  async del(path) {
    const r = await fetch(`/api${path}`, { method: 'DELETE' });
    return r.json();
  },
};

let player;
let ytPlayerV5;
let ytPlayerV8;
let channels = [];
let allChannels = [];
let tvCategoryFilter = 'all';
let tvSearchTerm = '';
let iptvPlayer;
let allIptvChannels = [];
let iptvChannels = [];
let iptvSearchTerm = '';
let _iptvOverlayTimer = null;
let resolvedVideo = null;
let _ytResolving = false;
let _ytLastVideoId = '';
let _ytMainFeedMode = 'trending';
let _ytInputMode = 'search';
let _activeSection = 'home';
let _membershipInterestTags = [];
let _interestTagsFetchedAt = 0;
let _userLanguage = 'tr';
let _tvOverlayTimer = null;
const TV_OVERLAY_HIDE_MS = 3500;
let _ytSeekingDrag = false;
const _resumeOnSectionReturn = Object.create(null);
const _resumeOnVisibilityReturn = Object.create(null);

const YT_PROFILE_KEYWORDS_KEY = 'yt-profile-keywords';
const YT_SEARCH_HISTORY_KEY = 'yt-search-history';

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

function updateYtVariantBadge() {
  const badge = document.getElementById('yt-version-badge');
  if (!badge) return;
  const activeYt = getYtPlayerBySection(_activeSection);
  const base = getYtVariantLabel(_activeSection);
  badge.textContent = base;
}

function init() {
  console.log('[App] Initializing (V5/V8 Clean Mode)...');
  
  // Oynatıcıları Oluştur
  window.ytPlayerV5 = new TeslaPlayerV5('yt-canvas-v5', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.ytPlayerV8 = new TeslaPlayerV8('yt-canvas-v8', { spinnerId: 'yt-spinner' });
  
  ytPlayerV5 = window.ytPlayerV5;
  ytPlayerV8 = window.ytPlayerV8;

  const unlock = () => {
    if (window.ytPlayerV8) window.ytPlayerV8.unlockAudio();
    if (window.ytPlayerV5) window.ytPlayerV5.unlockAudio();
  };
  document.addEventListener('touchstart', unlock, { once: true });
}
