/**
 * Açıl Susam — Ana uygulama
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
let ytPlayer;
let ytPlayerV2;
let ytPlayerV3;
let ytPlayerV4;
let ytPlayerV5;
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
  return section === 'youtube' || section === 'youtube_v1' || section === 'youtube_v2' || section === 'youtube_v3' || section === 'youtube_v4' || section === 'youtube_v5';
}

function getYtPlayerBySection(section = _activeSection) {
  if (section === 'youtube_v5') return ytPlayerV5;
  if (section === 'youtube_v4') return ytPlayerV4;
  if (section === 'youtube_v3') return ytPlayerV3;
  if (section === 'youtube_v2') return ytPlayerV2;
  if (section === 'youtube_v1') return ytPlayer; // Eski V1 motoruna erişim
  return ytPlayerV4; // Ana YouTube varsayılan olarak V4 motorunu kullanır
}

function getYtVariantLabel(section = _activeSection) {
  if (section === 'youtube_v5') return 'YT V5';
  if (section === 'youtube_v4') return 'YT V4';
  if (section === 'youtube_v3') return 'YT V3';
  if (section === 'youtube_v2') return 'YT V2';
  if (section === 'youtube_v1') return 'YT V1';
  return 'YT V4';
}

function updateYtVariantBadge() {
  const badge = document.getElementById('yt-version-badge');
  if (!badge) return;
  const activeYt = getYtPlayerBySection(_activeSection);
  const base = getYtVariantLabel(_activeSection);
  const diag = (activeYt && typeof activeYt.getDiagnostics === 'function') ? activeYt.getDiagnostics() : null;
  const reconnectInfo = (diag && typeof diag.reconnectAttempts === 'number') ? ` | rc:${diag.reconnectAttempts}` : '';
  const recoveringInfo = (diag && diag.recovering) ? ' | rec' : '';
  badge.textContent = `${base}${reconnectInfo}${recoveringInfo}`;
}

function getAppVersion() {
  const badge = document.getElementById('app-version-badge');
  if (badge && badge.dataset && badge.dataset.version) return String(badge.dataset.version);
  return 'unknown';
}

function pauseYtSectionPlayer(section) {
  const p = getYtPlayerBySection(section);
  if (!p) return;
  if (!p.paused && typeof p.togglePlay === 'function') {
    p.togglePlay();
  }
}

function pausePlayerAndRemember(key, playerObj) {
  if (!playerObj || typeof playerObj.paused === 'undefined') return;
  if (!playerObj.paused && typeof playerObj.togglePlay === 'function') {
    _resumeOnSectionReturn[key] = true;
    playerObj.togglePlay();
    return;
  }
  _resumeOnSectionReturn[key] = false;
}

function resumePlayerIfNeeded(key, playerObj) {
  if (!_resumeOnSectionReturn[key]) return;
  if (!playerObj || typeof playerObj.togglePlay !== 'function') return;
  if (playerObj.paused) playerObj.togglePlay();
  _resumeOnSectionReturn[key] = false;
}

function pauseForVisibility(key, playerObj) {
  if (!playerObj || typeof playerObj.paused === 'undefined') return;
  if (!playerObj.paused && typeof playerObj.togglePlay === 'function') {
    _resumeOnVisibilityReturn[key] = true;
    playerObj.togglePlay();
  } else {
    _resumeOnVisibilityReturn[key] = false;
  }
}

function resumeFromVisibilityIfNeeded(key, playerObj) {
  if (!_resumeOnVisibilityReturn[key]) return;
  if (playerObj && playerObj.paused && typeof playerObj.togglePlay === 'function') {
    playerObj.togglePlay();
  }
  _resumeOnVisibilityReturn[key] = false;
}

async function ytSeek(e) {
  if (e) e.stopPropagation();
  
  const activeYt = getYtPlayerBySection(_activeSection);
  if (!activeYt || !activeYt.currentChannel) return;

  const wrap = document.getElementById('yt-progress-wrap');
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, offsetX / rect.width));
  const dur = activeYt.currentChannel.duration || 0;
  const targetAbs = pct * dur;

  // Görsel olarak anında güncelle
  const fill = document.getElementById('yt-progress-fill');
  const thumb = document.getElementById('yt-progress-thumb');
  if (fill) fill.style.width = (pct * 100) + '%';
  if (thumb) thumb.style.left = (pct * 100) + '%';

  // Debounce: Çok hızlı tıklamaları engelle
  if (_ytSeekTimer) clearTimeout(_ytSeekTimer);
  _ytSeekTimer = setTimeout(async () => {
    ytLoading(true, 'Kaydırılıyor...');
    try {
      await activeYt.seek(targetAbs);
    } catch (err) {
      ytError('Kaydırma yapılamadı.');
    } finally {
      ytLoading(false);
    }
  }, 300);
}

function setupYtSeekGestures() {
  const wrap = document.getElementById('yt-progress-wrap');
  if (!wrap) return;

  const applySeekFromClientX = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const activeYt = getYtPlayerBySection(_activeSection);
    if (!activeYt || !activeYt.video || !activeYt.video.duration) return;
    const seconds = pct * activeYt.video.duration;
    activeYt.seekTo(seconds);
  };

  wrap.addEventListener('pointerdown', (e) => {
    _ytSeekingDrag = true;
    applySeekFromClientX(e.clientX);
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!_ytSeekingDrag) return;
    applySeekFromClientX(e.clientX);
  });

  const stopDrag = () => { _ytSeekingDrag = false; };
  wrap.addEventListener('pointerup', stopDrag);
  wrap.addEventListener('pointercancel', stopDrag);
  wrap.addEventListener('lostpointercapture', stopDrag);

  wrap.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches.length) return;
    _ytSeekingDrag = true;
    applySeekFromClientX(e.touches[0].clientX);
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (!_ytSeekingDrag || !e.touches || !e.touches.length) return;
    applySeekFromClientX(e.touches[0].clientX);
  }, { passive: true });

  wrap.addEventListener('touchend', stopDrag, { passive: true });
  wrap.addEventListener('touchcancel', stopDrag, { passive: true });
}

function applyPlayerLocale() {
  if (typeof AppI18n === 'undefined') return;
  AppI18n.setLanguage(_userLanguage);
  AppI18n.applyStatic(document);
  AppI18n.applyYtModeButtons();
  AppI18n.applyTvCategorySelect();
  AppI18n.applyNavModeSelect();
  if (typeof setYtInputMode === 'function') setYtInputMode(_ytInputMode);
  if (typeof navUpdatePlaceholderMessage === 'function') navUpdatePlaceholderMessage();
}

function focusPlaybackSurface() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    try { active.blur(); } catch {}
  }
  const ytArea = document.getElementById('yt-player-area');
  if (ytArea) {
    if (!ytArea.hasAttribute('tabindex')) ytArea.setAttribute('tabindex', '-1');
    try { ytArea.focus({ preventScroll: true }); } catch {}
  }
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data && e.data.type === 'acil-susam-locale' && e.data.language) {
    _userLanguage = String(e.data.language).toLowerCase();
    applyPlayerLocale();
    if (typeof loadIptvChannels === 'function' && _activeSection === 'iptv') loadIptvChannels();
  }
});

function showTvOverlay() {
  const overlay = document.getElementById('player-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  if (_tvOverlayTimer) clearTimeout(_tvOverlayTimer);
  _tvOverlayTimer = setTimeout(() => {
    overlay.classList.remove('visible');
  }, TV_OVERLAY_HIDE_MS);
}

function hideTvOverlay() {
  const overlay = document.getElementById('player-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  if (_tvOverlayTimer) {
    clearTimeout(_tvOverlayTimer);
    _tvOverlayTimer = null;
  }
}

// ─────────────────────────────────────────────
// Başlatma
// ─────────────────────────────────────────────

async function init() {
  console.log(`[App] v${getAppVersion()} initializing...`);
  const unlock = () => {
    if (window.player) window.player.unlockAudio();
    if (window.ytPlayer) window.ytPlayer.unlockAudio();
    if (window.ytPlayerV3) window.ytPlayerV3.unlockAudio();
    if (window.ytPlayerV4) window.ytPlayerV4.unlockAudio();
    if (window.iptvPlayer) window.iptvPlayer.unlockAudio();
  };
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('mousedown', unlock, { once: true });

  // Global Heartbeat (Zorunlu Kalp Atışı): Binary 0x00 formatı (JSMpeg uyumlu)
  setInterval(() => {
    const activeP = getActivePlayer();
    if (activeP && activeP.mpegPlayer && activeP.mpegPlayer.source && activeP.mpegPlayer.source.socket) {
      const ws = activeP.mpegPlayer.source.socket;
      if (ws.readyState === 1) ws.send(new Uint8Array([0x00]));
    }
  }, 10000);

  // Sinyal Kalite İzleyici (Gerçek Zamanlı Gecikme Ölçümü)
  const _ytUpdateSignal = async () => {
    const el = document.getElementById('yt-signal-indicator');
    const txt = document.getElementById('sig-text');
    if (!el) return;

    let level = 'bad';
    let type = '...';

    try {
      const start = Date.now();
      // Sunucuya minik bir ping atıp süreyi ölçüyoruz
      const resp = await fetch('/proxy/ping', { method: 'HEAD', cache: 'no-store' });
      const rtt = Date.now() - start;

      if (navigator.connection) {
        type = ''; // 4G metni kaldırıldı, sadece çubuklar kalacak
      } else {
        type = ''; // LTE/3G metinleri kaldırıldı
      }

      if (rtt < 150) level = 'perfect';
      else if (rtt < 350) level = 'good';
      else if (rtt < 700) level = 'okay';
      else level = 'bad';

      // Eğer sunucu hata verirse (500 vb) sinyali düşür
      if (!resp.ok) level = 'bad';
    } catch (err) {
      level = 'bad';
      type = 'KOPUK';
    }

    if (txt) txt.textContent = type;
    el.className = ''; 
    el.classList.add(level);
  };

  setInterval(_ytUpdateSignal, 5000);
  _ytUpdateSignal();

  // Global Klavye Kısa Yolu: SPACE
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      // Eğer kullanıcı arama kutusu gibi bir girişte değilse videoyu duraklat/başlat
      const target = e.target.tagName.toLowerCase();
      const isTypingTarget = (target === 'input' || target === 'textarea');
      const shouldForcePlaybackHotkey = isTypingTarget && isYoutubeSection(_activeSection) && _ytCurrentView === 'player';
      if (!isTypingTarget || shouldForcePlaybackHotkey) {
        e.preventDefault();
        if (shouldForcePlaybackHotkey) focusPlaybackSurface();
        toggleActivePlayerPlay();
      }
    }
  });

  window.player = new TeslaPlayer('video-canvas');
  window.ytPlayer = new TeslaPlayer('yt-canvas', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.ytPlayerV2 = new TeslaPlayerV2('yt-canvas-v2', { spinnerId: 'yt-spinner' });
  window.ytPlayerV3 = new TeslaPlayerV3('yt-canvas-v3', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.ytPlayerV4 = new TeslaPlayerV4('yt-canvas-v4', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.ytPlayerV5 = new TeslaPlayerV5('yt-canvas-v5', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.iptvPlayer = new TeslaPlayer('iptv-video-canvas', {
    spinnerId: 'iptv-spinner',
    containerId: 'iptv-player-area',
    emptyStateId: 'iptv-empty-state',
  });

  player = window.player;
  ytPlayer = window.ytPlayer;
  ytPlayerV2 = window.ytPlayerV2;
  ytPlayerV3 = window.ytPlayerV3;
  ytPlayerV4 = window.ytPlayerV4;
  ytPlayerV5 = window.ytPlayerV5;
  iptvPlayer = window.iptvPlayer;

  // Ekrana tıklayınca duraklat/devam et özelliği + Görsel Bildirim
  [
    { id: 'section-tv', canvasId: 'video-canvas', toggle: () => typeof togglePlay === 'function' && togglePlay() },
    { id: 'section-youtube', canvasId: 'yt-canvas', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'section-youtube', canvasId: 'yt-canvas-v2', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'section-youtube', canvasId: 'yt-canvas-v3', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'section-youtube', canvasId: 'yt-canvas-v4', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'section-youtube', canvasId: 'yt-canvas-v5', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'section-iptv', canvasId: 'iptv-video-canvas', toggle: () => typeof toggleIptvPlay === 'function' && toggleIptvPlay() }
  ].forEach(item => {
    const canvas = document.getElementById(item.canvasId);
    if (canvas) {
        canvas.addEventListener('click', (e) => {
            e.stopPropagation();
            item.toggle();
            showMediaStatusFeedback(item.id);
        });
    }
  });

  try {
    const [meData, chData] = await Promise.all([API.get('/me'), API.get('/channels')]);
    renderUser(meData.user);
    _membershipInterestTags = String(meData.membership?.interest_tags || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    _userLanguage = String(meData.user?.preferred_language || 'tr').toLowerCase();
    _interestTagsFetchedAt = Date.now();
    allChannels = Array.isArray(chData) ? chData : [];
    channels = [...allChannels];
    renderChannels(channels);
    updateDockBackButton();
    applyPlayerLocale();
    initVersionBadge();
  } catch {
    return;
  }

  // Akıllı Sekme Yönetimi: Sekme gizlenince pause, görünür olunca kaldığı yerden devam
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseForVisibility('tv', player);
      pauseForVisibility('youtube', ytPlayer);
      pauseForVisibility('youtube_v2', ytPlayerV2);
      pauseForVisibility('youtube_v3', ytPlayerV3);
      pauseForVisibility('youtube_v4', ytPlayerV4);
      pauseForVisibility('youtube_v5', ytPlayerV5);
      pauseForVisibility('iptv', iptvPlayer);
    } else if (document.visibilityState === 'visible') {
      resumeFromVisibilityIfNeeded('tv', player);
      resumeFromVisibilityIfNeeded('youtube', ytPlayer);
      resumeFromVisibilityIfNeeded('youtube_v2', ytPlayerV2);
      resumeFromVisibilityIfNeeded('youtube_v3', ytPlayerV3);
      resumeFromVisibilityIfNeeded('youtube_v4', ytPlayerV4);
      resumeFromVisibilityIfNeeded('youtube_v5', ytPlayerV5);
      resumeFromVisibilityIfNeeded('iptv', iptvPlayer);
    }
  });

  const tvSearch = document.getElementById('tv-search-input');
  if (tvSearch) {
    tvSearch.addEventListener('input', (e) => {
      tvSearchTerm = String(e.target.value || '').trim().toLowerCase();
      applyTvFilters();
    });
  }

  const iptvSearch = document.getElementById('iptv-search-input');
  if (iptvSearch) {
    iptvSearch.addEventListener('input', (e) => {
      iptvSearchTerm = String(e.target.value || '').trim().toLowerCase();
      iptvApplyFilters();
    });
  }

  const iptvPlayerArea = document.getElementById('iptv-player-area');
  if (iptvPlayerArea) {
    iptvPlayerArea.addEventListener('click', () => showIptvOverlay());
    iptvPlayerArea.addEventListener('touchstart', () => showIptvOverlay(), { passive: true });
  }

  // Theater Mode ipucu
  const hint = document.getElementById('theater-hint');
  if (hint) hint.textContent = location.origin + '/theater';

  // TV overlay: tıkla/dokun -> göster, birkaç saniye sonra gizle
  const overlay = document.getElementById('player-overlay');
  const playerArea = document.getElementById('player-area');
  if (playerArea) {
    playerArea.addEventListener('click', () => showTvOverlay());
    playerArea.addEventListener('touchstart', () => showTvOverlay(), { passive: true });
  }
  if (overlay) {
    overlay.addEventListener('click', () => showTvOverlay());
    overlay.addEventListener('input', () => showTvOverlay());
    overlay.addEventListener('touchstart', () => showTvOverlay(), { passive: true });
  }

  // ESC ile modalı kapat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddModal();
      closeUserMenu();
    }
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    if (!menu) return;
    if (!menu.contains(e.target)) closeUserMenu();
  });

  // YouTube player alanına tıklama = play/pause (kontrol butonları hariç)
  document.getElementById('yt-player-area').addEventListener('click', async (e) => {
    const controls = document.getElementById('yt-controls');
    if (controls && controls.contains(e.target)) return;
    const activeYt = getYtPlayerBySection(_activeSection);
    if (!activeYt) return;
    focusPlaybackSurface();
    const hasActiveSource = !!activeYt.hasActiveSource;
    const hasPendingResume = !!activeYt.hasPendingResume;
    if (!hasActiveSource && !hasPendingResume && resolvedVideo) {
      await playResolved();
      focusPlaybackSurface();
      return;
    }
    await toggleYtPlay();
  });

  setupYtSeekGestures();
  if (typeof initKeyboardManager === 'function') initKeyboardManager();
}

// ─────────────────────────────────────────────
// Kullanıcı
// ─────────────────────────────────────────────

function renderUser(user) {
  const avatar = document.getElementById('user-avatar');
  const name = document.getElementById('user-name');
  const menuName = document.getElementById('user-menu-name');
  const menuSub = document.getElementById('user-menu-sub');
  if (avatar && user.avatar) { avatar.src = user.avatar; avatar.style.display = 'block'; }
  if (name) name.textContent = user.name || user.email;
  if (menuName) {
    menuName.textContent = user.name || user.email || (typeof AppI18n !== 'undefined' ? AppI18n.t('menuUserDefault') : 'Kullanıcı');
  }
  if (menuSub) {
    menuSub.textContent = user.email || (typeof AppI18n !== 'undefined' ? AppI18n.t('menuSessionOpen') : 'Oturum açık');
  }
}

async function logout() {
  const ok = window.confirm(typeof AppI18n !== 'undefined' ? AppI18n.t('confirmLogout') : 'Hesaptan çıkmak istediğinize emin misiniz?');
  if (!ok) return;
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}

async function switchAccount() {
  closeUserMenu();
  const popup = window.open('/auth/google', '_blank', 'noopener,noreferrer,width=560,height=740');
  if (!popup) {
    alert(typeof AppI18n !== 'undefined' ? AppI18n.t('alertPopupBlocked') : 'Yeni hesap penceresi açılamadı. Tarayıcı açılır pencereyi engelliyor olabilir.');
    return;
  }
  alert(typeof AppI18n !== 'undefined' ? AppI18n.t('alertSwitchUser') : 'Yeni kullanıcı girişini açtık. Giriş tamamlandıktan sonra bu sayfayı yenileyebilirsiniz.');
}

function openGoogleAccountChooser() {
  closeUserMenu();
  window.open('/auth/google', '_blank', 'noopener,noreferrer,width=560,height=740');
}

function openAccountSettings() {
  closeUserMenu();
  dockNav('settings');
}

function toggleUserMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.classList.toggle('open');
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

// ─────────────────────────────────────────────
// Kanallar
// ─────────────────────────────────────────────

function renderChannels(list) {
  const container = document.getElementById('channel-list');
  container.innerHTML = '';

  if (!list.length) {
    const t1 = typeof AppI18n !== 'undefined' ? AppI18n.t('channelsNoneTitle') : 'Kanal yok.';
    const t2 = typeof AppI18n !== 'undefined' ? AppI18n.t('channelsNoneBody') : 'Kanal ekleme ve düzenleme için Ayarlar menüsündeki TV bölümünü kullanın.';
    container.innerHTML = `<div style="padding:20px;color:#555;font-size:13px;text-align:center">${esc(t1)}<br>${esc(t2)}</div>`;
    return;
  }

  // Kategoriye göre grupla
  const cats = {};
  list.forEach(ch => { (cats[ch.category || 'genel'] = cats[ch.category || 'genel'] || []).push(ch); });

  Object.entries(cats).forEach(([cat, items]) => {
    const hdr = document.createElement('div');
    hdr.className = 'sidebar-section';
    hdr.textContent = cat.toUpperCase();
    container.appendChild(hdr);

    items.forEach(ch => {
      const el = document.createElement('div');
      el.className = 'channel-item tv-channel-item';
      el.dataset.id = ch.id;
      el.innerHTML = `
        <div class="channel-logo">
          ${ch.logo ? `<img src="${esc(ch.logo)}" alt="" onerror="this.style.display='none'">` : catEmoji(ch.category)}
        </div>
        <div style="flex:1;overflow:hidden">
          <div class="channel-name">${esc(ch.name)}</div>
          <div class="channel-cat">${esc(ch.category || 'genel')}</div>
        </div>
        <button onclick="deleteChannel(event,${ch.id})" style="
          background:none;border:none;color:#333;cursor:pointer;
          font-size:16px;padding:4px 6px;border-radius:6px;
          opacity:0;transition:opacity 0.15s;
        " class="del-btn">✕</button>
      `;
      el.addEventListener('mouseenter', () => el.querySelector('.del-btn').style.opacity = '1');
      el.addEventListener('mouseleave', () => el.querySelector('.del-btn').style.opacity = '0');
      el.addEventListener('click', () => playChannel(ch));
      container.appendChild(el);
    });
  });
}

function catEmoji(cat) {
  return { haber: '📺', spor: '⚽', müzik: '🎵', muzik: '🎵', belgesel: '🌍', eğlence: '🎬', cocuk: '🧒', ulusal: '🛰️' }[cat] || '📡';
}

function setTvCategory(cat) {
  tvCategoryFilter = cat || 'all';
  applyTvFilters();
}

function applyTvFilters() {
  const filtered = allChannels.filter(ch => {
    const cat = String(ch.category || '').toLowerCase();
    const name = String(ch.name || '').toLowerCase();
    const matchesCat = tvCategoryFilter === 'all' || cat === tvCategoryFilter;
    const matchesSearch = !tvSearchTerm || name.includes(tvSearchTerm) || cat.includes(tvSearchTerm);
    return matchesCat && matchesSearch;
  });
  channels = filtered;
  renderChannels(filtered);
}

// ─────────────────────────────────────────────
// Oynatma
// ─────────────────────────────────────────────

async function playChannel(ch) {
  document.querySelectorAll('#channel-list .channel-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === String(ch.id))
  );
  setNowPlaying(ch.name, ch.category || '');

  // Hide empty state
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const candidates = getChannelCandidates(ch);
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      // Use direct URL, TeslaPlayer will handle the WebSocket conversion
      await player.load({ url: cand.url, name: ch.name }, { silentError: !isLast, throwOnError: true });
      showTvOverlay();
      updateDockBackButton();
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastErr) {
    console.warn('[TV] Playback failed:', ch.name, lastErr.message);
    if (player && typeof player._showError === 'function') {
      player._showError({ name: ch.name }, lastErr.message);
    }
  }
  updateDockBackButton();
}

function showTvOverlay() {
  const overlay = document.getElementById('player-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    setTimeout(() => overlay.classList.remove('visible'), 3000);
  }
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
}

function hideTvOverlay() {
  const overlay = document.getElementById('player-overlay');
  if (overlay) overlay.classList.remove('visible');
}

function tvEnsureEmptyState() {
  const area = document.getElementById('player-area');
  if (!area || document.getElementById('empty-state')) return;
  const el = document.createElement('div');
  el.id = 'empty-state';
  const h2 = typeof AppI18n !== 'undefined' ? AppI18n.t('tvEmptyTitle') : 'Canlı TV';
  const p = typeof AppI18n !== 'undefined' ? AppI18n.t('tvEmptySubtitle') : 'Sağ listeden kanal seçin';
  el.innerHTML = `
    <div class="big-icon">📺</div>
    <h2>${esc(h2)}</h2>
    <p>${esc(p)}</p>
  `;
  const spinner = document.getElementById('spinner');
  if (spinner) area.insertBefore(el, spinner);
  else area.appendChild(el);
}

function updateDockBackButton() {
  const btn = document.getElementById('dock-section-back');
  if (!btn) return;
  let show = false;
  if (isYoutubeSection(_activeSection) && _ytCurrentView === 'player') show = true;
  else if (_activeSection === 'iptv' && iptvPlayer && iptvPlayer.hasActiveSource) {
    show = true;
  }
  else if (_activeSection === 'tv' && player && player.hasActiveSource) {
    show = true;
  }
  btn.style.display = show ? 'flex' : 'none';
}

function dockSectionBack() {
  if (isYoutubeSection(_activeSection) && _ytCurrentView === 'player') {
    ytGoSectionHome();
    return;
  }
  if (_activeSection === 'iptv' && iptvPlayer && iptvPlayer.hasActiveSource) {
    iptvGoSectionHome();
    return;
  }
  if (_activeSection === 'tv' && player && player.hasActiveSource) {
    tvGoSectionHome();
  }
}

function tvGoSectionHome() {
  hideTvOverlay();
  try { player.stop({ suppressErrorsMs: 800 }); } catch {}
  document.querySelectorAll('#channel-list .channel-item').forEach((el) => el.classList.remove('active'));
  setNowPlaying('—', '');
  tvEnsureEmptyState();
  updateDockBackButton();
}

function showIptvOverlay() {
  const overlay = document.getElementById('iptv-player-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  if (_iptvOverlayTimer) clearTimeout(_iptvOverlayTimer);
  _iptvOverlayTimer = setTimeout(() => {
    overlay.classList.remove('visible');
    _iptvOverlayTimer = null;
  }, TV_OVERLAY_HIDE_MS);
}

function hideIptvOverlay() {
  const overlay = document.getElementById('iptv-player-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  if (_iptvOverlayTimer) {
    clearTimeout(_iptvOverlayTimer);
    _iptvOverlayTimer = null;
  }
}

function iptvEnsureEmptyState() {
  const area = document.getElementById('iptv-player-area');
  if (!area || document.getElementById('iptv-empty-state')) return;
  const el = document.createElement('div');
  el.id = 'iptv-empty-state';
  const msg = typeof AppI18n !== 'undefined' ? AppI18n.t('iptvEmptyMsg') : 'KURULUMU AYARLAR MENÜSÜNDEN IPTV BÖLÜMÜNDEN YAPMANIZ GEREKİYOR.';
  el.innerHTML = `
    <p class="iptv-empty-msg">${esc(msg)}</p>
  `;
  const spinner = document.getElementById('iptv-spinner');
  if (spinner) area.insertBefore(el, spinner);
  else area.appendChild(el);
}

function iptvApplyFilters() {
  const filtered = allIptvChannels.filter((ch) => {
    const name = String(ch.name || '').toLowerCase();
    const cat = String(ch.category || '').toLowerCase();
    const q = iptvSearchTerm;
    return !q || name.includes(q) || cat.includes(q);
  });
  iptvChannels = filtered;
  renderIptvChannels(filtered);
}

function renderIptvChannels(list) {
  const container = document.getElementById('iptv-channel-list');
  if (!container) return;
  container.innerHTML = '';

  if (!list.length) {
    const msg = typeof AppI18n !== 'undefined' ? AppI18n.t('iptvEmptyMsg') : 'KURULUMU AYARLAR MENÜSÜNDEN IPTV BÖLÜMÜNDEN YAPMANIZ GEREKİYOR.';
    container.innerHTML = `<div class="iptv-list-empty">${esc(msg)}</div>`;
    return;
  }

  const cats = {};
  list.forEach((ch) => {
    const c = ch.category || 'genel';
    (cats[c] = cats[c] || []).push(ch);
  });

  Object.entries(cats).forEach(([cat, items]) => {
    const hdr = document.createElement('div');
    hdr.className = 'sidebar-section';
    hdr.textContent = String(cat).toUpperCase();
    container.appendChild(hdr);

    items.forEach((ch) => {
      const el = document.createElement('div');
      el.className = 'iptv-channel-item';
      el.dataset.iptvId = String(ch.id);
      el.innerHTML = `
        <div class="channel-logo">
          ${ch.logo ? `<img src="${esc(ch.logo)}" alt="" onerror="this.style.display='none'">` : catEmoji(cat)}
        </div>
        <div style="flex:1;overflow:hidden">
          <div class="channel-name">${esc(ch.name)}</div>
          <div class="channel-cat">${esc(ch.source || '')} · ${esc(cat)}</div>
        </div>
      `;
      el.addEventListener('click', () => playIptvChannel(ch));
      container.appendChild(el);
    });
  });
}

function buildIptvPlayUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return u;
  if (u.includes('/proxy/hls')) return u;
  if (u.includes('.m3u8') || u.includes('.smil') || /\.m3u8(\?|$)/i.test(u)) {
    return `/proxy/hls?url=${encodeURIComponent(u)}`;
  }
  return u;
}

async function loadIptvChannels() {
  const container = document.getElementById('iptv-channel-list');
  try {
    const list = await API.get('/iptv/channels');
    allIptvChannels = Array.isArray(list) ? list : [];
    iptvApplyFilters();
  } catch (e) {
    console.error('[IPTV] Liste yüklenemedi:', e.message);
    if (container) {
      const t = typeof AppI18n !== 'undefined' ? AppI18n.t('iptvListEmpty') : 'Liste alınamadı.';
      container.innerHTML = `<div style="padding:20px;color:#888;font-size:13px;text-align:center">${esc(t)}</div>`;
    }
  }
}

async function playIptvChannel(ch) {
  document.querySelectorAll('.iptv-channel-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.iptvId === String(ch.id))
  );
  const subEl = document.getElementById('iptv-now-playing-sub');
  const titleEl = document.getElementById('iptv-now-playing-title');
  if (titleEl) titleEl.textContent = ch.name || '—';
  if (subEl) subEl.textContent = [ch.category, ch.source].filter(Boolean).join(' · ');

  const raw = ch.url;
  const url = buildIptvPlayUrl(raw);
  const isHls = !!(raw && (raw.includes('.m3u8') || raw.includes('.smil') || url.includes('proxy/hls')));

  try {
    await iptvPlayer.load(
      { url, name: ch.name, isHls },
      { silentError: false, throwOnError: true }
    );
    showIptvOverlay();
    updateDockBackButton();
  } catch (err) {
    console.warn('[IPTV] Oynatma hatası:', ch.name, err.message);
    if (typeof iptvPlayer._showError === 'function') {
      const userMsg = typeof iptvPlayer._toUserError === 'function'
        ? iptvPlayer._toUserError(err.message || '', ch)
        : 'Yayın açılamadı. Kaynak veya bağlantıyı kontrol edin.';
      iptvPlayer._showError(userMsg);
    }
  }
  updateDockBackButton();
}

function iptvGoSectionHome() {
  hideIptvOverlay();
  try { iptvPlayer.stop({ suppressErrorsMs: 800 }); } catch (e) {
    console.warn('[IPTV] stop:', e.message);
  }
  document.querySelectorAll('.iptv-channel-item').forEach((el) => el.classList.remove('active'));
  const t = document.getElementById('iptv-now-playing-title');
  const s = document.getElementById('iptv-now-playing-sub');
  if (t) t.textContent = '—';
  if (s) s.textContent = '';
  iptvEnsureEmptyState();
  updateDockBackButton();
}

function toggleIptvPlay() {
  iptvPlayer.togglePlay();
  const btn = document.getElementById('iptv-btn-play');
  if (btn) btn.innerHTML = iptvPlayer.paused ? TV_ICONS.play : TV_ICONS.pause;
}

function toggleIptvMute() {
  const m = iptvPlayer.toggleMute();
  document.getElementById('iptv-btn-mute').innerHTML = m ? TV_ICONS.mute : TV_ICONS.vol;
}

function setIptvVolume(val) {
  iptvPlayer.setVolume(val / 100);
  const muted = Number(val) === 0;
  iptvPlayer.video.muted = muted;
  document.getElementById('iptv-btn-mute').innerHTML = muted ? TV_ICONS.mute : TV_ICONS.vol;
}

function toggleIptvFullscreen() {
  const el = document.getElementById('iptv-player-area');
  if (!el) return;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

function getChannelCandidates(ch) {
  const sameName = allChannels
    .filter(x => String(x.name || '').trim().toLowerCase() === String(ch.name || '').trim().toLowerCase())
    .filter(x => x.url)
    .sort((a, b) => (Number(a.sort_order) || 9999) - (Number(b.sort_order) || 9999));

  const out = [];
  const seen = new Set();
  [ch, ...sameName].forEach(item => {
    const key = String(item.url || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function setNowPlaying(title, sub) {
  document.getElementById('now-playing-title').textContent = title;
  document.getElementById('now-playing-sub').textContent = sub;
}

// Oynat / Duraklat
function togglePlay() {
  player.togglePlay();
  document.getElementById('btn-play').innerHTML = player.paused ? TV_ICONS.play : TV_ICONS.pause;
}

function toggleMute() {
  const m = player.toggleMute();
  document.getElementById('btn-mute').innerHTML = m ? TV_ICONS.mute : TV_ICONS.vol;
  const slider = document.getElementById('tv-volume');
  if (slider) slider.value = m ? 0 : Math.round(player.video.volume * 100);
}

function setTvVolume(val) {
  player.setVolume(val / 100);
  const muted = Number(val) === 0;
  player.video.muted = muted;
  document.getElementById('btn-mute').innerHTML = muted ? TV_ICONS.mute : TV_ICONS.vol;
}

function toggleFullscreen() {
  const el = document.getElementById('player-area');
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

// ─────────────────────────────────────────────────────────────
// YouTube
// VIEW 1 (#yt-view-main):  arama / trending / geçmiş grid
// VIEW 2 (#yt-view-player): canvas oynatıcı + ilgili sidebar
// ─────────────────────────────────────────────────────────────

// Hangi view aktif
let _ytCurrentView = 'main'; // 'main' | 'player'

function ytShowView(view) {
  _ytCurrentView = view;
  document.getElementById('yt-view-main').style.display   = view === 'main'   ? '' : 'none';
  document.getElementById('yt-view-player').style.display = view === 'player' ? '' : 'none';
  updateYtVariantBadge();
  updateDockBackButton();
}

function ytGoSectionHome() {
  ytError('');
  try { ytPlayer.stop({ suppressErrorsMs: 1200 }); } catch {}
  try { ytPlayerV2.stop({ suppressErrorsMs: 1200 }); } catch {}
  try { ytPlayerV3.stop({ suppressErrorsMs: 1200 }); } catch {}
  try { ytPlayerV4.stop({ suppressErrorsMs: 1200 }); } catch {}
  try { cancelAnimationFrame(_ytProgressRaf); } catch {}
  resolvedVideo = null;
  ytLoading(false);
  ytShowView('main');
  ytLoadTrending();
}

function ytBackToMain() {
  ytGoSectionHome();
}

// ── VIEW 1: Ana grid (arama / trending) ───────────────────
let _ytMainVideos = [];

function renderMainGrid(videos) {
  _ytMainVideos = videos;
  const grid = document.getElementById('yt-main-grid');
  if (!videos.length) {
    const t = typeof AppI18n !== 'undefined' ? AppI18n.t('ytNoResults') : 'Sonuç bulunamadı';
    grid.innerHTML = `<div class="yt-grid-empty"><div class="icon">🔍</div><div>${esc(t)}</div></div>`;
    return;
  }
  grid.innerHTML = videos.map((v, i) => `
    <div class="yt-card" onclick="ytPlayVideo(${i})">
      <div class="yt-card-thumb">
        <img src="${esc(v.thumbnail)}" alt="" loading="lazy" onerror="this.style.opacity='0'">
        ${v.duration ? `<span class="yt-card-duration">${fmtDuration(v.duration)}</span>` : ''}
      </div>
      <div class="yt-card-info">
        <div class="yt-card-title">${esc(v.title || '')}</div>
        <div class="yt-card-meta">${esc(v.channel || '')}${v.views ? ' • ' + fmtViews(v.views) : ''}</div>
      </div>
    </div>
  `).join('');
}

// ── VIEW 2: Sidebar (ilgili videolar) ─────────────────────
let _ytSidebarVideos = [];

function renderSidebarGrid(videos) {
  _ytSidebarVideos = videos;
  const grid = document.getElementById('yt-sidebar-grid');
  if (!videos.length) {
    const t = typeof AppI18n !== 'undefined' ? AppI18n.t('ytNoRelated') : 'İlgili video bulunamadı';
    grid.innerHTML = `<div class="yt-grid-empty" style="padding:30px 10px"><div>${esc(t)}</div></div>`;
    return;
  }
  grid.innerHTML = videos.map((v, i) => `
    <div class="yt-card ${v.isNowPlaying ? 'playing' : ''}" onclick="ytPlaySidebar(${i})">
      <div class="yt-card-thumb">
        <img src="${esc(v.thumbnail)}" alt="" loading="lazy" onerror="this.style.opacity='0'">
        ${v.duration ? `<span class="yt-card-duration">${fmtDuration(v.duration)}</span>` : ''}
      </div>
      <div class="yt-card-info">
        <div class="yt-card-title">${esc(v.title || '')}</div>
        <div class="yt-card-meta">${esc(v.channel || '')}${v.views ? ' • ' + fmtViews(v.views) : ''}</div>
      </div>
    </div>
  `).join('');
}

// ── Oynatma ───────────────────────────────────────────────
async function ytPlayVideo(idx) {
  const v = _ytMainVideos[idx];
  if (!v) return;
  await _ytResolveAndPlay(v);
}

async function ytPlaySidebar(idx) {
  const v = _ytSidebarVideos[idx];
  if (!v) return;
  await _ytResolveAndPlay(v);
}

async function _ytResolveAndPlay(v) {
  if (_ytResolving) return;
  _ytResolving = true;

  // Player view'e geç, spinner göster
  ytShowView('player');
  document.getElementById('yt-now-playing-title').textContent = v.title || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytLoadingTitle') : 'Yükleniyor...');
  document.getElementById('yt-btn-play').innerHTML = YC_ICONS.pause;
  document.getElementById('yt-btn-mute').innerHTML = YC_ICONS.vol;
  document.getElementById('yt-spinner').classList.add('active');
  ytError('');

  try {
    ytAddToHistory(v);
    _ytLastVideoId = String(v.videoId || '').trim();
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok) { ytError(data.message || data.error); return; }
    if (!data.videoId && _ytLastVideoId) data.videoId = _ytLastVideoId;
    await ytStartPlay(data);
  } catch {
    ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytStreamFail') : 'Stream alınamadı.');
  } finally {
    document.getElementById('yt-spinner').classList.remove('active');
    _ytResolving = false;
  }
}

async function ytStartPlay(data) {
  resolvedVideo = data;
  _ytLastVideoId = String(data?.videoId || _ytLastVideoId || '').trim();
  document.getElementById('yt-now-playing-title').textContent = data.title || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytVideoTitle') : 'Video');
  document.getElementById('yt-btn-play').innerHTML = YC_ICONS.pause;
  document.getElementById('yt-btn-mute').innerHTML = YC_ICONS.vol;

  const streamUrl = data.isHls
    ? `/proxy/hls?url=${encodeURIComponent(data.streamUrl)}`
    : data.streamUrl;

  const activeP = getYtPlayerBySection(_activeSection);
  const ok = await activeP.load({
    url: streamUrl,
    name: data.title || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytVideoTitle') : 'Video'),
    isHls: data.isHls,
    duration: data.duration || 0,
    ytUrl: data.videoId ? `https://www.youtube.com/watch?v=${data.videoId}` : null,
  });
  if (!ok) {
    ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytStreamFail') : 'Stream alınamadı.');
    return;
  }
  focusPlaybackSurface();
  _startYtProgress();
  _ytFetchSidebar(data);
}

async function _ytFetchSidebar(data) {
  if (!data) return;
  try {
    const now = Date.now();
    if (!_membershipInterestTags.length || (now - _interestTagsFetchedAt) > 15000) {
      try {
        const profile = await API.get('/profile/interests');
        _membershipInterestTags = Array.isArray(profile?.terms)
          ? profile.terms.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12)
          : [];
        _userLanguage = String(profile?.language || _userLanguage || 'tr').toLowerCase();
        _interestTagsFetchedAt = now;
        applyPlayerLocale();
      } catch {}
    }

    const queries = (_membershipInterestTags.length ? _membershipInterestTags : buildInterestTerms())
      .slice(0, 5)
      .map(tag => tag.trim())
      .filter(Boolean);

    if (!queries.length) {
      renderSidebarGrid([]);
      return;
    }

    const responses = await Promise.all(
      queries.map(q => fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&n=12&lang=${encodeURIComponent(_userLanguage)}`))
    );
    const payloads = await Promise.all(responses.map(r => r.json()));
    const merged = [];
    const seen = new Set();
    payloads.forEach(list => {
      if (!Array.isArray(list)) return;
      list.forEach(v => {
        if (!v || !v.videoId || seen.has(v.videoId)) return;
        seen.add(v.videoId);
        merged.push(v);
      });
    });

    const diversified = diversifyVideosByQuery(payloads, queries, data.videoId).slice(0, 40);
    const filtered = diversified.length
      ? diversified
      : merged.filter(v => v.videoId !== data.videoId).slice(0, 40);
    if (!filtered.length) {
      renderSidebarGrid([]);
      return;
    }
    renderSidebarGrid(filtered.map(v => Object.assign({}, v, { isNowPlaying: false })));
  } catch {}
}

function diversifyVideosByQuery(payloads, queries, excludeVideoId) {
  const buckets = payloads.map((list, idx) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(v => v && v.videoId && v.videoId !== excludeVideoId)
      .map(v => Object.assign({}, v, { _sourceQuery: queries[idx] || '' }));
  });

  const seen = new Set();
  const out = [];
  let hasItems = true;
  while (hasItems && out.length < 60) {
    hasItems = false;
    for (const bucket of buckets) {
      while (bucket.length) {
        const next = bucket.shift();
        if (!next || seen.has(next.videoId)) continue;
        seen.add(next.videoId);
        out.push(next);
        hasItems = true;
        break;
      }
    }
  }
  return out;
}

// ── Arama ─────────────────────────────────────────────────
async function ytSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  rememberSearchTerm(q);
  try { await API.post('/profile/search', { query: q }); } catch {}
  ytShowView('main');
  ytLoading(true, typeof AppI18n !== 'undefined' ? AppI18n.t('ytSearching') : 'Aranıyor...');
  ytError('');
  try {
    const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(_userLanguage)}`);
    const data = await r.json();
    ytLoading(false);
    if (!r.ok || data.error) {
      ytError(data.error || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytSearchFailApi') : 'Arama başarısız.'));
      return;
    }
    if (!Array.isArray(data)) {
      ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytInvalidResponse') : 'Geçersiz yanıt.');
      return;
    }
    renderMainGrid(data);
  } catch {
    ytLoading(false);
    ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytSearchFail') : 'Arama başarısız.');
  }
}

async function ytSubmitMainInput() {
  const input = document.getElementById('yt-main-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;

  // Link tespiti kaldırıldı. Her giriş doğrudan arama terimi sayılıyor.
  console.log('[YouTube] Searching for:', val);
  ytSearch(val);
  
  // Aramadan sonra klavyeyi tekrar kilitle
  input.readOnly = true;
  const kbBtn = document.querySelector('.yt-kb-btn');
  if (kbBtn) kbBtn.classList.remove('active');
}

function ytStartVoiceSearch() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    ytError('Tarayıcınız sesli aramayı desteklemiyor.');
    return;
  }
  
  const rec = new Recognition();
  rec.lang = 'tr-TR';
  const micBtn = document.getElementById('yt-action-mic');
  
  if (micBtn) {
    micBtn.style.color = '#ff0000';
    micBtn.innerHTML = '🔴'; // Kayıt simgesi
  }
  
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const input = document.getElementById('yt-main-input');
    if (input) {
      input.value = text;
      ytSubmitMainInput();
    }
  };
  
  rec.onend = () => {
    if (micBtn) {
      micBtn.style.color = '';
      micBtn.innerHTML = '🎙️';
    }
  };
  
  rec.onerror = () => {
    if (micBtn) {
      micBtn.style.color = '';
      micBtn.innerHTML = '🎙️';
    }
    ytError('Ses anlaşılamadı.');
  };
  
  rec.start();
}

function unlockYtKeyboard() {
  const input = document.getElementById('yt-main-input');
  const btn = document.querySelector('.yt-kb-btn');
  if (!input) return;
  
  // Eğer zaten aktifse kapat (blur yap)
  if (!input.readOnly && document.activeElement === input) {
    input.blur();
    return;
  }
  
  input.readOnly = false;
  input.focus();
  if (btn) btn.classList.add('active');
  
  // Blur olunca tekrar kilitle
  const onBlur = () => {
    input.readOnly = true;
    if (btn) btn.classList.remove('active');
    input.removeEventListener('blur', onBlur);
  };
  input.addEventListener('blur', onBlur);
}

function ytExtractId(url) {
  if (!url) return null;
  let id = '';
  if (url.includes('v=')) id = url.split('v=')[1].split('&')[0];
  else if (url.includes('be/')) id = url.split('be/')[1].split('?')[0];
  else if (url.includes('embed/')) id = url.split('embed/')[1].split('?')[0];
  return id || null;
}

// setYtInputMode ve eski ytSubmitMainInput kaldırıldı. Akıllı algılama artık yukarıdaki async ytSubmitMainInput içinde.


async function resolveUrl(rawUrl) {
  const url = String(rawUrl || document.getElementById('yt-main-input')?.value || '').trim();
  if (!url) return;
  if (url.includes('.m3u8') || url.endsWith('.mp4')) {
    ytShowView('player');
    await ytStartPlay({ streamUrl: url, title: url, isHls: url.includes('.m3u8') });
    return;
  }
  ytLoading(true);
  try {
    const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    ytLoading(false);
    if (!r.ok) { ytError(data.message || data.error); return; }
    ytShowView('player');
    await ytStartPlay(data);
  } catch {
    ytLoading(false);
    ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytConnectFail') : 'Sunucuya bağlanılamadı.');
  }
}

// ── Son izlenenler & geçmiş ───────────────────────────────
function ytAddToHistory(v) {
  const hist = JSON.parse(localStorage.getItem('yt-history') || '[]');
  const filtered = hist.filter(x => x.videoId !== v.videoId);
  filtered.unshift(v);
  localStorage.setItem('yt-history', JSON.stringify(filtered.slice(0, 30)));
  updateProfileKeywordsFromVideo(v);
  try {
    API.post('/profile/watch', {
      videoId: v.videoId || '',
      title: v.title || '',
      channel: v.channel || '',
    });
  } catch {}
}

function ytGetHistory() {
  return JSON.parse(localStorage.getItem('yt-history') || '[]');
}

function rememberSearchTerm(q) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return;
  const list = JSON.parse(localStorage.getItem(YT_SEARCH_HISTORY_KEY) || '[]')
    .filter(x => x !== term);
  list.unshift(term);
  localStorage.setItem(YT_SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
}

function updateProfileKeywordsFromVideo(v) {
  const base = [
    ...(v?.title ? extractKeywords(v.title) : []),
    ...(v?.channel ? extractKeywords(v.channel) : []),
  ];
  if (!base.length) return;
  const current = JSON.parse(localStorage.getItem(YT_PROFILE_KEYWORDS_KEY) || '[]');
  const merged = [...new Set([...base, ...current])].slice(0, 30);
  localStorage.setItem(YT_PROFILE_KEYWORDS_KEY, JSON.stringify(merged));
}

function buildInterestTerms() {
  const fromTags = _membershipInterestTags.map(s => s.toLowerCase()).filter(Boolean);
  const fromSearch = JSON.parse(localStorage.getItem(YT_SEARCH_HISTORY_KEY) || '[]')
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  const fromProfile = JSON.parse(localStorage.getItem(YT_PROFILE_KEYWORDS_KEY) || '[]')
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

  const merged = [...new Set([...fromTags, ...fromSearch, ...fromProfile])];
  return merged.slice(0, 8);
}

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\sğüşıöç]/gi, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.length >= 3)
    .filter(s => ![
      've', 'ile', 'için', 'this', 'that', 'the', 'bir', 'çok', 'daha', 'how', 'what',
      'video', 'official', 'hd', '4k', 'new', 'live', 'music', 'song'
    ].includes(s))
    .slice(0, 6);
}

async function setYtFeedMode(mode) {
  _ytMainFeedMode = mode;
  await ytLoadTrending();
}

async function ytLoadTrending() {
  ytShowView('main');
  
  // Aktif buton görselini güncelle
  document.querySelectorAll('.yt-mode-btn').forEach(btn => {
    const btnMode = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
    btn.classList.toggle('active', btnMode === _ytMainFeedMode);
  });

  ytError('');

  // ── GEÇMİŞ MODU ──
  if (_ytMainFeedMode === 'history') {
    ytLoading(true, typeof AppI18n !== 'undefined' ? AppI18n.t('ytHistoryLoading') : 'Geçmiş videolar hazırlanıyor...');
    const history = ytGetHistory();
    ytLoading(false);
    if (history.length) {
      renderMainGrid(history);
      return;
    }
    const hEmpty = typeof AppI18n !== 'undefined' ? AppI18n.t('ytHistoryEmpty') : 'Henüz izleme geçmişi bulunamadı';
    document.getElementById('yt-main-grid').innerHTML = `<div class="yt-grid-empty"><div>${esc(hEmpty)}</div></div>`;
    return;
  }

  // ── TRENDLER MODU (Akıllı Hibrit) ──
  if (_ytMainFeedMode === 'trending') {
    ytLoading(true, 'Trendler hazırlanıyor...');
    try {
      let queries = [];
      try {
        const profile = await API.get('/profile/interests');
        _membershipInterestTags = Array.isArray(profile?.terms)
          ? profile.terms.map(s => String(s || '').trim()).filter(Boolean).slice(0, 8)
          : [];
        _userLanguage = String(profile?.language || _userLanguage || 'tr').toLowerCase();
        _interestTagsFetchedAt = Date.now();
        applyPlayerLocale();
        queries = _membershipInterestTags;
      } catch {}

      if (!queries.length) {
        queries = buildInterestTerms().slice(0, 5);
      }

      // Eğer ilgi alanı/geçmiş varsa, bunlarla arama yapıp karıştır
      if (queries.length) {
        const responses = await Promise.all(
          queries.map(q => fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&n=12&lang=${encodeURIComponent(_userLanguage)}`))
        );
        const payloads = await Promise.all(responses.map(r => r.ok ? r.json() : []));
        const personalized = diversifyVideosByQuery(payloads, queries, '').slice(0, 40);
        
        if (personalized.length > 5) {
          ytLoading(false);
          renderMainGrid(personalized);
          return;
        }
      }

      // İlgi alanı yoksa veya az sonuç geldiyse genel trendlere düş
      const r = await fetch('/api/youtube/trending');
      const data = await r.json();
      ytLoading(false);
      if (Array.isArray(data) && data.length) {
        renderMainGrid(data);
      } else {
        ytError('Trend videolar şu an alınamıyor.');
      }
    } catch {
      ytLoading(false);
      ytError('Bağlantı hatası.');
    }
    return;
  }

  // ── KATEGORİ MODLARI (Arama tabanlı) ──
  const categoryQueries = {
    news: 'Haberler',
    tech: 'Teknoloji',
    automotive: 'Otomobil'
  };

  const query = categoryQueries[_ytMainFeedMode];
  if (query) {
    ytLoading(true, `${query} kategorisi yükleniyor...`);
    try {
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(_userLanguage)}`);
      const data = await r.json();
      ytLoading(false);
      if (Array.isArray(data)) {
        renderMainGrid(data);
      } else {
        ytError('İçerik bulunamadı.');
      }
    } catch {
      ytLoading(false);
      ytError('Arama hatası.');
    }
    return;
  }

  // Default fallback (hiçbiri değilse trendlere dön)
  _ytMainFeedMode = 'trending';
  ytLoadTrending();
}


function fmtDuration(secs) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const whole = Math.floor(n);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2,'0')}:${s}` : `${m}:${s}`;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

function ytLoading(on, msg) {
  const el = document.getElementById('yt-loading');
  const def = typeof AppI18n !== 'undefined' ? AppI18n.t('ytLoading') : 'Yükleniyor...';
  el.textContent = msg || def;
  el.classList.toggle('show', on);
}

function ytError(msg) {
  const el = document.getElementById('yt-error');
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

async function playResolved() {
  // Geçiş sonrası eski streamUrl bayat olabildiği için mümkünse videoId'den tekrar çöz.
  const vid = String(resolvedVideo?.videoId || _ytLastVideoId || '').trim();
  if (vid) {
    try {
      ytLoading(true, typeof AppI18n !== 'undefined' ? AppI18n.t('ytReprepareVideo') : 'Video tekrar hazırlanıyor...');
      const url = `https://www.youtube.com/watch?v=${vid}`;
      const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
      const data = await r.json();
      ytLoading(false);
      if (!r.ok) {
        ytError(data.message || data.error || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytStreamFail') : 'Stream alınamadı.'));
        return;
      }
      if (!data.videoId) data.videoId = vid;
      await ytStartPlay(data);
      return;
    } catch {
      ytLoading(false);
      ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytRestartFailVideo') : 'Video tekrar başlatılamadı.');
      return;
    }
  }
  if (!resolvedVideo) return;
  await ytStartPlay(resolvedVideo);
}

// SVG ikonları (Official YouTube Style)
const YC_ICONS = {
  play:  `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#fff"/></svg>`,
  vol:   `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/></svg>`,
  mute:  `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="#fff"/></svg>`,
};

const TV_ICONS = {
  play:  `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#fff"/></svg>`,
  vol:   `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/></svg>`,
  mute:  `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="#fff"/></svg>`,
};

let _ytToggleCooldown = false;
async function toggleYtPlay(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  
  if (_ytToggleCooldown) return;
  _ytToggleCooldown = true;
  setTimeout(() => { _ytToggleCooldown = false; }, 300);

  const activeYt = getYtPlayerBySection(_activeSection);
  if (!activeYt) return;
  
  const hasActiveSource = !!activeYt.hasActiveSource;
  const hasPendingResume = !!activeYt.hasPendingResume;
  
  if (!hasActiveSource && !hasPendingResume && resolvedVideo) {
    await playResolved();
    return;
  }
  
  activeYt.togglePlay();
  
  // UI Güncelleme
  const btn = document.getElementById('yt-btn-play');
  const area = document.getElementById('yt-player-area');
  const isPlaying = activeYt.isPlaying;
  
  if (btn) btn.innerHTML = isPlaying ? YC_ICONS.pause : YC_ICONS.play;
  if (area) area.classList.toggle('yt-paused', !isPlaying);
}

function toggleYtMute() {
  const activeYt = getYtPlayerBySection(_activeSection);
  if (!activeYt) return;
  const m = activeYt.toggleMute();
  document.getElementById('yt-btn-mute').innerHTML = m ? YC_ICONS.mute : YC_ICONS.vol;
  const v = Number(activeYt.video?.volume || 0);
  document.getElementById('yt-volume').value = m ? 0 : (v * 100);
}

function ytSetVolume(val) {
  const activeYt = getYtPlayerBySection(_activeSection);
  if (!activeYt) return;
  activeYt.setVolume(val / 100);
  const muted = val == 0;
  if (activeYt.video) activeYt.video.muted = muted;
  document.getElementById('yt-btn-mute').innerHTML = muted ? YC_ICONS.mute : YC_ICONS.vol;
}

function toggleYtFullscreen(e) {
  if (e) e.stopPropagation();
  const activeYt = getYtPlayerBySection(_activeSection);
  if (activeYt) activeYt.toggleFullscreen();
}

// Progress güncelleme döngüsü
let _ytProgressRaf;
function _startYtProgress() {
  cancelAnimationFrame(_ytProgressRaf);
  // Aktif oynatıcıyı seç
  const activeP = getYtPlayerBySection(_activeSection);
  const pObj = activeP.video || activeP; // V2'de player'ın kendisi getter'lara sahip
  const fill   = document.getElementById('yt-progress-fill');
  const buf    = document.getElementById('yt-progress-buf');
  const thumb  = document.getElementById('yt-progress-thumb');
  const time   = document.getElementById('yt-time');

  function tick() {
    const dur = Number(pObj.duration || 0);
    const cur = Number(pObj.currentTime || 0);
    if (!Number.isFinite(dur) || dur <= 0) {
      time.textContent = '0:00 / 0:00';
      _ytProgressRaf = requestAnimationFrame(tick);
      return;
    }
    const safeCur = Number.isFinite(cur) && cur >= 0 ? cur : 0;
    const pct = (safeCur / dur) * 100;
    fill.style.width  = pct + '%';
    thumb.style.left  = pct + '%';

    // Buffer (V2 modunda audio buffered kullanılır, pObj.video v1'de kalsın)
    if (activeP && typeof activeP.getBufferedEnd === 'function') {
      const be = activeP.getBufferedEnd();
      const bufPct = (be / dur) * 100;
      buf.style.width = Math.max(pct, Math.min(100, bufPct)) + '%';
    } else if (pObj && pObj.buffered && pObj.buffered.length > 0) {
      const bufPct = (pObj.buffered.end(pObj.buffered.length - 1) / dur) * 100;
      buf.style.width = bufPct + '%';
    }

    time.textContent = fmtDuration(safeCur) + ' / ' + fmtDuration(dur);
    updateYtVariantBadge();
    _ytProgressRaf = requestAnimationFrame(tick);
  }
  tick();
}

// ─────────────────────────────────────────────
// Kanal CRUD
// ─────────────────────────────────────────────

function openAddModal() {
  dockNav('settings');
}

function closeAddModal() {
  const modal = document.getElementById('add-modal');
  const form = document.getElementById('add-form');
  if (!modal) return;
  modal.classList.remove('open');
  if (form) form.reset();
}

async function submitChannel(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await API.post('/channels', {
      name: form.chName.value.trim(),
      url: form.chUrl.value.trim(),
      category: form.chCat.value,
      logo: form.chLogo.value.trim() || null,
    });
    allChannels = await API.get('/channels');
    applyTvFilters();
    closeAddModal();
  } catch {}
}

async function deleteChannel(e, id) {
  e.stopPropagation();
  await API.del(`/channels/${id}`);
  allChannels = await API.get('/channels');
  applyTvFilters();
}

// ─────────────────────────────────────────────
// Yardımcı
// ─────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ─────────────────────────────────────────────
// Navigasyon (Google Maps Embed API — directions)
// ─────────────────────────────────────────────

let _navEmbedKey = '';
let _navEmbedConfigLoaded = false;

async function navEnsureEmbedConfig() {
  if (_navEmbedConfigLoaded) return;
  try {
    const data = await API.get('/maps/embed-config');
    _navEmbedKey = String(data.key || '').trim();
  } catch (e) {
    console.warn('[Nav] embed config', e.message);
    _navEmbedKey = '';
  }
  _navEmbedConfigLoaded = true;
}

function navUpdatePlaceholderMessage() {
  const ph = document.getElementById('nav-placeholder');
  if (!ph || typeof AppI18n === 'undefined') return;
  const t = (k) => AppI18n.t(k);
  if (_navEmbedKey) {
    ph.innerHTML = '<h2>' + esc(t('navPlaceholderTitle')) + '</h2><p>' + esc(t('navPlaceholderP')) + '</p>';
  } else {
    ph.innerHTML = '<h2>' + esc(t('navPlaceholderKeyTitle')) + '</h2><p>' + esc(t('navPlaceholderKeyP')) + '</p>';
  }
}

function navUseCurrentLocation() {
  if (!navigator.geolocation) {
    window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertNoBrowserGeo') : 'Tarayıcı konum desteği vermiyor.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const o = document.getElementById('nav-origin');
      if (o) {
        o.value = `${pos.coords.latitude},${pos.coords.longitude}`;
      }
    },
    (err) => {
      console.warn('[Nav] geolocation', err);
      window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertGeoFail') : 'Konum alınamadı. İzin ve HTTPS (veya localhost) ayarlarını kontrol edin.');
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
  );
}

function navTravelModeForMapsUrl(mode) {
  const m = String(mode || 'driving').toLowerCase();
  if (m === 'walking') return 'walking';
  if (m === 'bicycling') return 'bicycling';
  if (m === 'transit') return 'transit';
  return 'driving';
}

function navOpenInGoogleMapsTab() {
  const destEl = document.getElementById('nav-destination');
  const originEl = document.getElementById('nav-origin');
  const modeEl = document.getElementById('nav-mode');
  const dest = String(destEl?.value || '').trim();
  const origin = String(originEl?.value || '').trim();
  const travelmode = navTravelModeForMapsUrl(modeEl?.value);
  if (!dest) {
    window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertDest') : 'Nereye alanını doldurun.');
    return;
  }
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', dest);
  if (origin) u.searchParams.set('origin', origin);
  u.searchParams.set('travelmode', travelmode);
  window.open(u.toString(), '_blank', 'noopener,noreferrer');
}

function navApplyRoute() {
  const originEl = document.getElementById('nav-origin');
  const destEl = document.getElementById('nav-destination');
  const modeEl = document.getElementById('nav-mode');
  const frame = document.getElementById('nav-map-frame');
  const ph = document.getElementById('nav-placeholder');
  const origin = String(originEl?.value || '').trim();
  const dest = String(destEl?.value || '').trim();
  const mode = String(modeEl?.value || 'driving');

  if (!dest) {
    window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertDest') : 'Nereye alanını doldurun.');
    return;
  }
  if (!origin) {
    window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertOrigin') : 'Nereden alanını doldurun veya Konumum ile koordinat yazdırın.');
    return;
  }
  if (!_navEmbedKey) {
    window.alert(typeof AppI18n !== 'undefined' ? AppI18n.t('navAlertNoKey') : 'Gömülü harita için GOOGLE_MAPS_EMBED_API_KEY gerekli. Tam navigasyon için Haritalarda aç düğmesini kullanın.');
    return;
  }

  const lang = String(_userLanguage || 'tr').toLowerCase();
  const url =
    'https://www.google.com/maps/embed/v1/directions?' +
    new URLSearchParams({
      key: _navEmbedKey,
      origin,
      destination: dest,
      mode,
      language: lang.length === 2 ? lang : 'tr',
      region: lang === 'tr' ? 'tr' : lang,
    }).toString();

  if (frame) {
    frame.src = url;
    frame.style.display = 'block';
  }
  if (ph) ph.style.display = 'none';
}

// ─────────────────────────────────────────────
// Dock navigasyon
// ─────────────────────────────────────────────

let _ytTrendingLoaded = false;

function stopInactiveSectionPlayback(nextSection) {
  // TV sekmesinden çıkınca stream'i düşürme: sadece duraklat (geri dönüşte tek tuşla devam etsin)
  if (_activeSection === 'tv' && nextSection !== 'tv' && player) {
    try { pausePlayerAndRemember('tv', player); } catch (e) { console.warn('[TV] duraklatma', e.message); }
    hideTvOverlay();
    const btn = document.getElementById('btn-play');
    if (btn) btn.innerHTML = TV_ICONS.play;
  }

  if (_activeSection === 'iptv' && nextSection !== 'iptv' && iptvPlayer) {
    try { pausePlayerAndRemember('iptv', iptvPlayer); } catch (e) { console.warn('[IPTV] duraklatma', e.message); }
    hideIptvOverlay();
    const ib = document.getElementById('iptv-btn-play');
    if (ib) ib.innerHTML = TV_ICONS.play;
  }

  if (_activeSection === 'youtube_v1' && nextSection !== 'youtube_v1' && ytPlayer) {
    try { pausePlayerAndRemember('youtube_v1', ytPlayer); } catch (e) { console.warn('[YouTubeV1] duraklatma', e.message); }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) { console.warn('[YouTubeV1] raf', e2.message); }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }

  if (_activeSection === 'youtube' && nextSection !== 'youtube' && ytPlayerV4) {
    try { pausePlayerAndRemember('youtube', ytPlayerV4); } catch (e) { console.warn('[YouTube] duraklatma', e.message); }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) { console.warn('[YouTube] raf', e2.message); }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }

  if (_activeSection === 'youtube_v2' && nextSection !== 'youtube_v2' && ytPlayerV2) {
    try { pausePlayerAndRemember('youtube_v2', ytPlayerV2); } catch (e) { console.warn('[YouTubeV2] duraklatma', e.message); }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) { console.warn('[YouTubeV2] raf', e2.message); }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }

  if (_activeSection === 'youtube_v3' && nextSection !== 'youtube_v3' && ytPlayerV3) {
    try { pausePlayerAndRemember('youtube_v3', ytPlayerV3); } catch (e) { console.warn('[YouTubeV3] duraklatma', e.message); }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) { console.warn('[YouTubeV3] raf', e2.message); }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }

  if (_activeSection === 'youtube_v4' && nextSection !== 'youtube_v4' && ytPlayerV4) {
    try { pausePlayerAndRemember('youtube_v4', ytPlayerV4); } catch (e) { console.warn('[YouTubeV4] duraklatma', e.message); }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) { console.warn('[YouTubeV4] raf', e2.message); }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }
}

function dockNav(section) {
  if (_activeSection === section && isYoutubeSection(section)) {
    ytGoSectionHome();
    return;
  }
  if (_activeSection === section && section === 'tv') {
    tvGoSectionHome();
    return;
  }
  if (_activeSection === section && section === 'iptv') {
    iptvGoSectionHome();
    return;
  }

  stopInactiveSectionPlayback(section);

  document.querySelectorAll('.dock-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === section);
  });

  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  
  // youtube varyantları aynı section içinde açılır
  const targetId = isYoutubeSection(section) ? 'section-youtube' : 'section-' + section;
  const target = document.getElementById(targetId);
  
  // Canvas Toggle
  const c1 = document.getElementById('yt-canvas');
  const c2 = document.getElementById('yt-canvas-v2');
  const c3 = document.getElementById('yt-canvas-v3');
  const c4 = document.getElementById('yt-canvas-v4');
  const c5 = document.getElementById('yt-canvas-v5');
  if (c1 && c2 && c3 && c4 && c5) {
    c1.style.display = (section === 'youtube_v1') ? '' : 'none';
    c2.style.display = (section === 'youtube_v2') ? '' : 'none';
    c3.style.display = (section === 'youtube_v3') ? '' : 'none';
    c4.style.display = (section === 'youtube' || section === 'youtube_v4') ? '' : 'none';
    c5.style.display = (section === 'youtube_v5') ? '' : 'none';
  }

  if (target) {
    target.classList.add('active');
    target.style.opacity = '0';
    requestAnimationFrame(() => { target.style.opacity = '1'; });
  }
  _activeSection = section;
  updateYtVariantBadge();

  // Bölüme geri dönünce kaldığı yerden otomatik devam et
  if (section === 'tv') resumePlayerIfNeeded('tv', player);
  if (section === 'iptv') resumePlayerIfNeeded('iptv', iptvPlayer);
  if (section === 'youtube') resumePlayerIfNeeded('youtube', ytPlayerV4);
  if (section === 'youtube_v1') resumePlayerIfNeeded('youtube_v1', ytPlayer);
  if (section === 'youtube_v2') resumePlayerIfNeeded('youtube_v2', ytPlayerV2);
  if (section === 'youtube_v3') resumePlayerIfNeeded('youtube_v3', ytPlayerV3);
  if (section === 'youtube_v4') resumePlayerIfNeeded('youtube_v4', ytPlayerV4);

  // YouTube sekmesine ilk girişte trending yükle
  if (isYoutubeSection(section) && !_ytTrendingLoaded) {
    _ytTrendingLoaded = true;
    ytLoadTrending();
  }

  if (section === 'iptv') {
    loadIptvChannels();
  }

  if (section === 'navigation') {
    navEnsureEmbedConfig().then(() => {
      navUpdatePlaceholderMessage();
    });
  }

  updateDockBackButton();
  if (typeof applyKeyboardLockToInputs === 'function') applyKeyboardLockToInputs();
}

function initVersionBadge() {
  const badge = document.getElementById('app-version-badge');
  const newestItem = document.querySelector('.app-version-item.newest b');
  if (!badge || !newestItem) return;

  const currentVersion = badge.dataset.version;
  const viewedKey = 'viewed-version-' + currentVersion;
  
  if (!localStorage.getItem(viewedKey)) {
    // newestItem.style.color = '#22c55e'; // Green
    localStorage.setItem(viewedKey, 'true');
  } else {
    // newestItem.style.color = '#aaa'; // Standard Bold
  }
}

function toggleActivePlayerPlay() {
  if (_activeSection === 'tv' && window.player) togglePlay();
  else if (isYoutubeSection(_activeSection) && getYtPlayerBySection(_activeSection)) toggleYtPlay();
  else if (_activeSection === 'iptv' && window.iptvPlayer) toggleIptvPlay();
  const feedbackSectionId = isYoutubeSection(_activeSection) ? 'section-youtube' : ('section-' + _activeSection);
  showMediaStatusFeedback(feedbackSectionId);
}

function showMediaStatusFeedback(sectionId) {
  return; // Tesla: Hayalet ikonlar engellendi
  const container = document.getElementById(sectionId);
  if (!container) return;
  
  // Eski ikonu temizle
  const old = container.querySelector('.media-feedback-flash');
  if (old) old.remove();
  
  const icon = document.createElement('div');
  icon.className = 'media-feedback-flash';
  
  const p = getActivePlayer();
  const isPaused = p ? p.paused : false;
  
  icon.innerHTML = isPaused 
    ? `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#fff"/></svg>` // Pause icon (showing it IS paused)
    : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>`; // Play icon

  container.appendChild(icon);
  setTimeout(() => icon.classList.add('fade-out'), 10);
  setTimeout(() => icon.remove(), 800);
}

function getActivePlayer() {
  if (_activeSection === 'tv') return window.player;
  if (isYoutubeSection(_activeSection)) return getYtPlayerBySection(_activeSection);
  if (_activeSection === 'iptv') return window.iptvPlayer;
  return null;
}

document.addEventListener('DOMContentLoaded', init);

// ─────────────────────────────────────────────
// Klavye Yardımcısı (Tesla Klavyeyi Kilitle/Aç)
// ─────────────────────────────────────────────
let _kbLockEnabled = localStorage.getItem('kb-lock-enabled') === 'true';

function toggleKeyboardLock() {
  _kbLockEnabled = !_kbLockEnabled;
  localStorage.setItem('kb-lock-enabled', _kbLockEnabled);
  updateKeyboardLockUI();
  applyKeyboardLockToInputs();
}

function updateKeyboardLockUI() {
  const label = document.getElementById('kb-lock-label');
  if (!label) return;
  label.textContent = _kbLockEnabled ? 'Klavye: Korumalı' : 'Klavye: Otomatik';
  const card = label.closest('.home-card');
  if (card) {
    card.style.borderColor = _kbLockEnabled ? 'var(--accent)' : 'var(--border)';
    card.style.background = _kbLockEnabled ? 'rgba(232, 33, 39, 0.1)' : 'var(--surface2)';
  }
}

function applyKeyboardLockToInputs() {
  const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="url"]');
  inputs.forEach(input => {
    // Zaten sarılmışsa sadece durum güncelle
    if (_kbLockEnabled) {
      if (!input.dataset.kbWrapped) {
        wrapInputWithKbTrigger(input);
      }
      input.readOnly = true;
      const trigger = input.parentElement.querySelector('.kb-trigger-btn');
      if (trigger) trigger.style.display = 'flex';
    } else {
      input.readOnly = false;
      const trigger = (input.parentElement && input.parentElement.classList.contains('kb-input-wrapper')) 
          ? input.parentElement.querySelector('.kb-trigger-btn') : null;
      if (trigger) trigger.style.display = 'none';
    }
  });
}

function wrapInputWithKbTrigger(input) {
  // Bazı inputlar zaten sarılmış olabilir veya sarılmamalıdır
  if (input.dataset.kbWrapped || input.closest('.kb-input-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'kb-input-wrapper';
  
  // Input'un flex değerini koru
  const style = window.getComputedStyle(input);
  if (style.flex !== '0 1 auto') wrapper.style.flex = style.flex;
  if (style.width.includes('%')) wrapper.style.width = style.width;

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  
  const trigger = document.createElement('div');
  trigger.className = 'kb-trigger-btn';
  trigger.innerHTML = '⌨️';
  trigger.onclick = (e) => {
    e.stopPropagation();
    input.readOnly = false;
    input.focus();
    trigger.classList.add('active');
  };
  
  input.addEventListener('blur', () => {
    if (_kbLockEnabled) input.readOnly = true;
    trigger.classList.remove('active');
  });
  
  input.dataset.kbWrapped = 'true';
  wrapper.appendChild(trigger);
}

function initKeyboardManager() {
  updateKeyboardLockUI();
  applyKeyboardLockToInputs();
  
  // Dinamik olarak eklenen inputları yakalamak için periyodik kontrol (Tesla tarayıcı uyumluluğu için)
  setInterval(applyKeyboardLockToInputs, 2000);
}
