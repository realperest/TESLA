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
let _ytMainFeedMode = 'smart';
let _ytInputMode = 'search';
let _activeSection = 'home';
let _membershipInterestTags = [];
let _interestTagsFetchedAt = 0;
let _userLanguage = 'tr';
let _tvOverlayTimer = null;
const TV_OVERLAY_HIDE_MS = 3500;

const YT_PROFILE_KEYWORDS_KEY = 'yt-profile-keywords';
const YT_SEARCH_HISTORY_KEY = 'yt-search-history';

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
  console.log('[App] v260419.0038 initializing...');
  const unlock = () => {
    if (window.player) window.player.unlockAudio();
    if (window.ytPlayer) window.ytPlayer.unlockAudio();
    if (window.iptvPlayer) window.iptvPlayer.unlockAudio();
  };
  document.addEventListener('touchstart', unlock);
  document.addEventListener('mousedown', unlock);

  window.player = new TeslaPlayer('video-canvas');
  window.ytPlayer = new TeslaPlayer('yt-canvas', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });
  window.iptvPlayer = new TeslaPlayer('iptv-video-canvas', {
    spinnerId: 'iptv-spinner',
    containerId: 'iptv-player-area',
    emptyStateId: 'iptv-empty-state',
  });

  player = window.player;
  ytPlayer = window.ytPlayer;
  iptvPlayer = window.iptvPlayer;

  // Ekrana tıklayınca duraklat/devam et özelliği
  [
    { id: 'video-canvas', toggle: () => typeof togglePlay === 'function' && togglePlay() },
    { id: 'yt-canvas', toggle: () => typeof toggleYtPlay === 'function' && toggleYtPlay() },
    { id: 'iptv-video-canvas', toggle: () => typeof toggleIptvPlay === 'function' && toggleIptvPlay() }
  ].forEach(item => {
    const el = document.getElementById(item.id);
    if (el) el.addEventListener('click', () => item.toggle());
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

  // Akıllı Sekme Yönetimi: Sekme gizlendiğinde durdur, açıldığında en güncel yerden devam et
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (typeof player !== 'undefined' && player.isPlaying) { window._lastChannel = player.currentChannel; player.stop(); }
      if (typeof ytPlayer !== 'undefined' && ytPlayer.isPlaying) { window._lastYtChannel = ytPlayer.currentChannel; ytPlayer.stop(); }
      if (typeof iptvPlayer !== 'undefined' && iptvPlayer.isPlaying) { window._lastIptvChannel = iptvPlayer.currentChannel; iptvPlayer.stop(); }
    } else if (document.visibilityState === 'visible') {
      if (window._lastChannel) { player.load(window._lastChannel); window._lastChannel = null; }
      if (window._lastYtChannel) { ytPlayer.load(window._lastYtChannel); window._lastYtChannel = null; }
      if (window._lastIptvChannel) { iptvPlayer.load(window._lastIptvChannel); window._lastIptvChannel = null; }
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
    if (!ytPlayer) return;
    const hasActiveSource = ytPlayer.hasActiveSource;
    if (hasActiveSource) {
      toggleYtPlay();
      return;
    }
    if (resolvedVideo) {
      await playResolved();
    }
  });

  setYtInputMode('search');
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
  if (_activeSection === 'youtube' && _ytCurrentView === 'player') show = true;
  else if (_activeSection === 'iptv' && iptvPlayer && iptvPlayer.hasActiveSource) {
    show = true;
  }
  else if (_activeSection === 'tv' && player && player.hasActiveSource) {
    show = true;
  }
  btn.style.display = show ? 'flex' : 'none';
}

function dockSectionBack() {
  if (_activeSection === 'youtube' && _ytCurrentView === 'player') {
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
  updateDockBackButton();
}

function ytGoSectionHome() {
  ytError('');
  try { ytPlayer.stop({ suppressErrorsMs: 1200 }); } catch {}
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

  const ok = await ytPlayer.load({
    url: streamUrl,
    name: data.title || (typeof AppI18n !== 'undefined' ? AppI18n.t('ytVideoTitle') : 'Video'),
    isHls: data.isHls,
    ytUrl: data.videoId ? `https://www.youtube.com/watch?v=${data.videoId}` : null,
  });
  if (!ok) {
    ytError(typeof AppI18n !== 'undefined' ? AppI18n.t('ytStreamFail') : 'Stream alınamadı.');
    return;
  }
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

function setYtInputMode(mode) {
  const nextMode = mode === 'link' ? 'link' : 'search';
  const changed = _ytInputMode !== nextMode;
  _ytInputMode = nextMode;
  const searchBtn = document.getElementById('yt-input-search');
  const linkBtn = document.getElementById('yt-input-link');
  const input = document.getElementById('yt-main-input');
  const searchAction = document.getElementById('yt-action-search');
  const linkAction = document.getElementById('yt-action-link');
  if (searchBtn && linkBtn) {
    searchBtn.classList.toggle('active', _ytInputMode === 'search');
    linkBtn.classList.toggle('active', _ytInputMode === 'link');
  }
  if (input) {
    if (changed) input.value = '';
    if (typeof AppI18n !== 'undefined') {
      input.placeholder = _ytInputMode === 'search'
        ? AppI18n.t('ytPhSearch')
        : AppI18n.t('ytPhLink');
    } else {
      input.placeholder = _ytInputMode === 'search'
        ? 'Buraya aramak istediğiniz kelimeleri yazın...'
        : 'Buraya açmak istediğiniz videonun linkini yapıştırın...';
    }
    input.focus();
  }
  if (searchAction) searchAction.style.display = _ytInputMode === 'search' ? '' : 'none';
  if (linkAction) linkAction.style.display = _ytInputMode === 'link' ? '' : 'none';
}

function ytSubmitMainInput() {
  const input = document.getElementById('yt-main-input');
  const val = String(input?.value || '').trim();
  if (_ytInputMode === 'link') {
    resolveUrl(val);
    return;
  }
  ytSearch(val);
}

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

async function ytLoadTrending() {
  ytShowView('main');
  const smartBtn = document.getElementById('yt-mode-smart');
  const historyBtn = document.getElementById('yt-mode-history');
  if (smartBtn && historyBtn) {
    smartBtn.classList.toggle('active', _ytMainFeedMode === 'smart');
    historyBtn.classList.toggle('active', _ytMainFeedMode === 'history');
  }

  if (_ytMainFeedMode === 'history') {
    ytLoading(true, typeof AppI18n !== 'undefined' ? AppI18n.t('ytHistoryLoading') : 'Geçmiş videolar hazırlanıyor...');
    ytError('');
    const history = ytGetHistory();
    ytLoading(false);
    if (history.length) {
      renderMainGrid(history);
      return;
    }
    const hEmpty = typeof AppI18n !== 'undefined' ? AppI18n.t('ytHistoryEmpty') : 'Henüz izleme geçmişi bulunamadı';
    document.getElementById('yt-main-grid').innerHTML = `
      <div class="yt-grid-empty">
        <div class="icon" style="font-size:44px;opacity:0.35">•</div>
        <div>${esc(hEmpty)}</div>
      </div>`;
    return;
  }

  ytLoading(true, typeof AppI18n !== 'undefined' ? AppI18n.t('ytSmartLoading') : 'Sana uygun videolar hazırlanıyor...');
  ytError('');

  try {
    let queries = [];
    try {
      const profile = await API.get('/profile/interests');
      _membershipInterestTags = Array.isArray(profile?.terms)
        ? profile.terms.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      _userLanguage = String(profile?.language || _userLanguage || 'tr').toLowerCase();
      _interestTagsFetchedAt = Date.now();
      applyPlayerLocale();
      queries = _membershipInterestTags.slice(0, 6);
    } catch {}

    if (!queries.length) {
      queries = buildInterestTerms().slice(0, 6);
    }

    if (queries.length) {
      const responses = await Promise.all(
        queries.map(q => fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&n=16&lang=${encodeURIComponent(_userLanguage)}`))
      );
      const payloads = await Promise.all(responses.map(r => r.ok ? r.json() : []));
      const personalized = diversifyVideosByQuery(payloads, queries, '').slice(0, 40);
      if (personalized.length) {
        ytLoading(false);
        renderMainGrid(personalized);
        return;
      }
    }

    // İlgi temelli sonuç gelmezse trend'e düş.
    const r = await fetch('/api/youtube/trending');
    const data = await r.json();
    ytLoading(false);
    if (Array.isArray(data) && data.length) {
      renderMainGrid(data);
    } else {
      const hint = typeof AppI18n !== 'undefined' ? AppI18n.t('ytHintSearchYoutube') : 'YouTube\'da bir şeyler ara';
      document.getElementById('yt-main-grid').innerHTML = `
        <div class="yt-grid-empty">
          <div class="icon" style="font-size:48px;opacity:0.3">▶️</div>
          <div>${esc(hint)}</div>
        </div>`;
    }
  } catch {
    ytLoading(false);
    const hint = typeof AppI18n !== 'undefined' ? AppI18n.t('ytHintStartSearch') : 'Aramaya başla';
    document.getElementById('yt-main-grid').innerHTML = `
      <div class="yt-grid-empty"><div class="icon">🔍</div><div>${esc(hint)}</div></div>`;
  }
}

function setYtFeedMode(mode) {
  _ytMainFeedMode = mode === 'history' ? 'history' : 'smart';
  ytLoadTrending();
}


function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
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

// SVG ikonları
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

async function toggleYtPlay() {
  const hasActiveSource = ytPlayer.hasActiveSource;
  if (!hasActiveSource && resolvedVideo) {
    await playResolved();
    return;
  }
  ytPlayer.togglePlay();
  const btn = document.getElementById('yt-btn-play');
  btn.innerHTML = ytPlayer.paused ? YC_ICONS.play : YC_ICONS.pause;
}

function toggleYtMute() {
  const m = ytPlayer.toggleMute();
  document.getElementById('yt-btn-mute').innerHTML = m ? YC_ICONS.mute : YC_ICONS.vol;
  document.getElementById('yt-volume').value = m ? 0 : (ytPlayer.video.volume * 100);
}

function ytSetVolume(val) {
  ytPlayer.setVolume(val / 100);
  const muted = val == 0;
  ytPlayer.video.muted = muted;
  document.getElementById('yt-btn-mute').innerHTML = muted ? YC_ICONS.mute : YC_ICONS.vol;
}

function ytSeek(e) {
  const wrap = document.getElementById('yt-progress-wrap');
  const rect = wrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (ytPlayer && ytPlayer.video.duration) {
    const seconds = pct * ytPlayer.video.duration;
    ytPlayer.seekTo(seconds);
  }
}

function toggleYtFullscreen() {
  const el = document.getElementById('yt-player-area');
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

// Progress güncelleme döngüsü
let _ytProgressRaf;
function _startYtProgress() {
  cancelAnimationFrame(_ytProgressRaf);
  const video = ytPlayer.video;
  const fill   = document.getElementById('yt-progress-fill');
  const buf    = document.getElementById('yt-progress-buf');
  const thumb  = document.getElementById('yt-progress-thumb');
  const time   = document.getElementById('yt-time');

  function tick() {
    if (!video.duration) { _ytProgressRaf = requestAnimationFrame(tick); return; }
    const pct = (video.currentTime / video.duration) * 100;
    fill.style.width  = pct + '%';
    thumb.style.left  = pct + '%';

    // Buffer
    if (video.buffered.length > 0) {
      const bufPct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
      buf.style.width = bufPct + '%';
    }

    time.textContent = fmtDuration(Math.floor(video.currentTime)) + ' / ' + fmtDuration(Math.floor(video.duration));
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
    try {
      player.video.pause();
      player.isPlaying = false;
    } catch (e) {
      console.warn('[TV] duraklatma', e.message);
    }
    hideTvOverlay();
    const btn = document.getElementById('btn-play');
    if (btn) btn.innerHTML = TV_ICONS.play;
  }

  if (_activeSection === 'iptv' && nextSection !== 'iptv' && iptvPlayer) {
    try {
      iptvPlayer.video.pause();
      iptvPlayer.isPlaying = false;
    } catch (e) {
      console.warn('[IPTV] duraklatma', e.message);
    }
    hideIptvOverlay();
    const ib = document.getElementById('iptv-btn-play');
    if (ib) ib.innerHTML = TV_ICONS.play;
  }

  // YouTube sekmesinden çıkınca stream'i düşürme: sadece duraklat (geri dönüşte tek tuşla devam etsin)
  if (_activeSection === 'youtube' && nextSection !== 'youtube' && ytPlayer) {
    try {
      ytPlayer.video.pause();
      ytPlayer.isPlaying = false;
    } catch (e) {
      console.warn('[YouTube] duraklatma', e.message);
    }
    try { cancelAnimationFrame(_ytProgressRaf); } catch (e2) {
      console.warn('[YouTube] raf', e2.message);
    }
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }
}

function dockNav(section) {
  if (_activeSection === section && section === 'youtube') {
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
  const target = document.getElementById('section-' + section);
  if (target) {
    target.classList.add('active');
    target.style.opacity = '0';
    requestAnimationFrame(() => { target.style.opacity = '1'; });
  }
  _activeSection = section;

  // YouTube sekmesine ilk girişte trending yükle
  if (section === 'youtube' && !_ytTrendingLoaded) {
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
}

function initVersionBadge() {
  const badge = document.getElementById('app-version-badge');
  if (!badge) return;
  const currentVersion = badge.dataset.version;
  const viewedKey = 'viewed-version-' + currentVersion;
  
  if (!localStorage.getItem(viewedKey)) {
    badge.style.color = '#22c55e'; // Green
    badge.style.fontWeight = 'bold';
    localStorage.setItem(viewedKey, 'true');
  } else {
    badge.style.color = '#888'; // Normal (White/Gray)
    badge.style.fontWeight = 'bold';
  }
}

document.addEventListener('DOMContentLoaded', init);
