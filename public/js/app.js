/**
 * TobeTube — Ana uygulama
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
let iptvPlayer;

let _activeSection = 'home';
let _userLanguage = 'tr';

const _resumeOnSectionReturn = Object.create(null);
const _resumeOnVisibilityReturn = Object.create(null);

function isYoutubeSection(section) {
  return section === 'youtube_1' || section === 'youtube_5';
}

let allChannels = [];
let tvCategoryFilter = 'all';
let tvSearchTerm = '';

let allIptvChannels = [];
let iptvSearchTerm = '';
let _iptvOverlayTimer = null;
let _tvOverlayTimer = null;
const OVERLAY_HIDE_MS = 3500;

const TV_ICONS = {
  play:  `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#fff"/></svg>`,
  vol:   `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/></svg>`,
  mute:  `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="#fff"/></svg>`,
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function getAppVersion() {
  const badge = document.getElementById('app-version-badge');
  if (badge && badge.dataset && badge.dataset.version) return String(badge.dataset.version);
  return 'unknown';
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

function getActivePlayer() {
  if (isYoutubeSection(_activeSection)) return null;
  if (_activeSection === 'tv') return player;
  if (_activeSection === 'iptv') return iptvPlayer;
  return null;
}

function toggleActivePlayerPlay() {
  if (_activeSection === 'tv' && player) togglePlay();
  else if (_activeSection === 'iptv' && iptvPlayer) toggleIptvPlay();
}

function updateDockBackButton() {
  const btn = document.getElementById('dock-section-back');
  if (!btn) return;
  const show =
    (_activeSection === 'tv' && player && player.hasActiveSource) ||
    (_activeSection === 'iptv' && iptvPlayer && iptvPlayer.hasActiveSource) ||
    (isYoutubeSection(_activeSection) && typeof window.ytTechPauseAll === 'function');
  btn.style.display = show ? 'flex' : 'none';
}

function stopInactiveSectionPlayback(nextSection) {
  if (isYoutubeSection(_activeSection) && !isYoutubeSection(nextSection)) {
    try { if (typeof window.ytTechPauseAll === 'function') window.ytTechPauseAll(); } catch {}
  }

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
}

window.dockNav = function dockNav(section) {
  if (_activeSection === section && section === 'tv') {
    tvGoSectionHome();
    return;
  }
  if (_activeSection === section && section === 'iptv') {
    iptvGoSectionHome();
    return;
  }
  if (_activeSection === section && isYoutubeSection(section)) {
    // aynı teknik seçiliyken tekrar tıklama: sadece UI'yı güncelle
    try {
      if (section === 'youtube_1' && typeof window.ytTechSetActive === 'function') window.ytTechSetActive(1);
      if (section === 'youtube_5' && typeof window.ytTechSetActive === 'function') window.ytTechSetActive(5);
    } catch {}
    updateDockBackButton();
    return;
  }

  stopInactiveSectionPlayback(section);

  document.querySelectorAll('.dock-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === section);
  });

  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  const targetId = isYoutubeSection(section) ? 'section-youtube' : ('section-' + section);
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.add('active');
    target.style.opacity = '0';
    requestAnimationFrame(() => { target.style.opacity = '1'; });
  }

  _activeSection = section;

  if (section === 'tv') resumePlayerIfNeeded('tv', player);
  if (section === 'iptv') resumePlayerIfNeeded('iptv', iptvPlayer);
  if (section === 'iptv') loadIptvChannels();
  if (section === 'navigation') {
    navEnsureEmbedConfig().then(() => { navUpdatePlaceholderMessage(); });
  }
  if (section === 'youtube_1') {
    try { if (typeof window.ytTechSetActive === 'function') window.ytTechSetActive(1); } catch {}
  }
  if (section === 'youtube_5') {
    try { if (typeof window.ytTechSetActive === 'function') window.ytTechSetActive(5); } catch {}
  }

  updateDockBackButton();
  if (typeof applyKeyboardLockToInputs === 'function') applyKeyboardLockToInputs();
};

window.dockSectionBack = function dockSectionBack() {
  if (_activeSection === 'iptv' && iptvPlayer && iptvPlayer.hasActiveSource) {
    iptvGoSectionHome();
    return;
  }
  if (_activeSection === 'tv' && player && player.hasActiveSource) {
    tvGoSectionHome();
    return;
  }
  if (isYoutubeSection(_activeSection)) {
    try {
      if (typeof window.ytTechBackToGrid === 'function') window.ytTechBackToGrid();
      else if (typeof window.ytTechPauseAll === 'function') window.ytTechPauseAll();
    } catch {}
  }
};

function renderUser(user) {
  const avatar = document.getElementById('user-avatar');
  const name = document.getElementById('user-name');
  const menuName = document.getElementById('user-menu-name');
  const menuSub = document.getElementById('user-menu-sub');

  if (avatar && user && user.avatar) { avatar.src = user.avatar; avatar.style.display = 'block'; }
  if (name) name.textContent = (user && (user.name || user.email)) ? (user.name || user.email) : '...';
  if (menuName) {
    menuName.textContent = (user && (user.name || user.email))
      ? (user.name || user.email)
      : (typeof AppI18n !== 'undefined' ? AppI18n.t('menuUserDefault') : 'Kullanıcı');
  }
  if (menuSub) {
    menuSub.textContent = (user && user.email)
      ? user.email
      : (typeof AppI18n !== 'undefined' ? AppI18n.t('menuSessionOpen') : 'Oturum açık');
  }
}

window.toggleUserMenu = function toggleUserMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.classList.toggle('open');
};

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

window.openAccountSettings = function openAccountSettings() {
  closeUserMenu();
  window.dockNav('settings');
};

window.openGoogleAccountChooser = function openGoogleAccountChooser() {
  closeUserMenu();
  window.open('/auth/google', '_blank', 'noopener,noreferrer,width=560,height=740');
};

window.switchAccount = function switchAccount() {
  closeUserMenu();
  const popup = window.open('/auth/google', '_blank', 'noopener,noreferrer,width=560,height=740');
  if (!popup) {
    alert(typeof AppI18n !== 'undefined' ? AppI18n.t('alertPopupBlocked') : 'Yeni hesap penceresi açılamadı. Tarayıcı açılır pencereyi engelliyor olabilir.');
    return;
  }
  alert(typeof AppI18n !== 'undefined' ? AppI18n.t('alertSwitchUser') : 'Yeni kullanıcı girişini açtık. Giriş tamamlandıktan sonra bu sayfayı yenileyebilirsiniz.');
};

window.logout = async function logout() {
  const ok = window.confirm(typeof AppI18n !== 'undefined' ? AppI18n.t('confirmLogout') : 'Hesaptan çıkmak istediğinize emin misiniz?');
  if (!ok) return;
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
};

function catEmoji(cat) {
  return { haber: '📺', spor: '⚽', müzik: '🎵', muzik: '🎵', belgesel: '🌍', eğlence: '🎬', cocuk: '🧒', ulusal: '🛰️' }[cat] || '📡';
}

function renderChannels(list) {
  const container = document.getElementById('channel-list');
  if (!container) return;
  container.innerHTML = '';

  if (!list.length) {
    const t1 = typeof AppI18n !== 'undefined' ? AppI18n.t('channelsNoneTitle') : 'Kanal yok.';
    const t2 = typeof AppI18n !== 'undefined' ? AppI18n.t('channelsNoneBody') : 'Kanal ekleme ve düzenleme için Ayarlar menüsündeki TV bölümünü kullanın.';
    container.innerHTML = `<div style="padding:20px;color:#555;font-size:13px;text-align:center">${esc(t1)}<br>${esc(t2)}</div>`;
    return;
  }

  const cats = {};
  list.forEach(ch => { (cats[ch.category || 'genel'] = cats[ch.category || 'genel'] || []).push(ch); });

  Object.entries(cats).forEach(([cat, items]) => {
    const hdr = document.createElement('div');
    hdr.className = 'sidebar-section';
    hdr.textContent = String(cat).toUpperCase();
    container.appendChild(hdr);

    items.forEach(ch => {
      const el = document.createElement('div');
      el.className = 'channel-item tv-channel-item';
      el.dataset.id = String(ch.id);
      el.innerHTML = `
        <div class="channel-logo">
          ${ch.logo ? `<img src="${esc(ch.logo)}" alt="" onerror="this.style.display='none'">` : catEmoji(ch.category)}
        </div>
        <div style="flex:1;overflow:hidden">
          <div class="channel-name">${esc(ch.name)}</div>
          <div class="channel-cat">${esc(ch.category || 'genel')}</div>
        </div>
        <button onclick="deleteChannel(event,${Number(ch.id)})" style="
          background:none;border:none;color:#333;cursor:pointer;
          font-size:16px;padding:4px 6px;border-radius:6px;
          opacity:0;transition:opacity 0.15s;
        " class="del-btn">✕</button>
      `;
      el.addEventListener('mouseenter', () => { const b = el.querySelector('.del-btn'); if (b) b.style.opacity = '1'; });
      el.addEventListener('mouseleave', () => { const b = el.querySelector('.del-btn'); if (b) b.style.opacity = '0'; });
      el.addEventListener('click', () => playChannel(ch));
      container.appendChild(el);
    });
  });
}

window.setTvCategory = function setTvCategory(cat) {
  tvCategoryFilter = cat || 'all';
  applyTvFilters();
};

function applyTvFilters() {
  const filtered = allChannels.filter(ch => {
    const cat = String(ch.category || '').toLowerCase();
    const name = String(ch.name || '').toLowerCase();
    const matchesCat = tvCategoryFilter === 'all' || cat === tvCategoryFilter;
    const matchesSearch = !tvSearchTerm || name.includes(tvSearchTerm) || cat.includes(tvSearchTerm);
    return matchesCat && matchesSearch;
  });
  renderChannels(filtered);
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
  const t = document.getElementById('now-playing-title');
  const s = document.getElementById('now-playing-sub');
  if (t) t.textContent = title || '—';
  if (s) s.textContent = sub || '';
}

async function playChannel(ch) {
  document.querySelectorAll('#channel-list .channel-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === String(ch.id))
  );
  setNowPlaying(ch.name, ch.category || '');

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const candidates = getChannelCandidates(ch);
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
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
  if (!overlay) return;
  overlay.classList.add('visible');
  if (_tvOverlayTimer) clearTimeout(_tvOverlayTimer);
  _tvOverlayTimer = setTimeout(() => {
    overlay.classList.remove('visible');
  }, OVERLAY_HIDE_MS);
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

function tvGoSectionHome() {
  hideTvOverlay();
  try { player.stop({ suppressErrorsMs: 800 }); } catch {}
  document.querySelectorAll('#channel-list .channel-item').forEach((el) => el.classList.remove('active'));
  setNowPlaying('—', '');
  tvEnsureEmptyState();
  updateDockBackButton();
}

window.togglePlay = function togglePlay() {
  player.togglePlay();
  const btn = document.getElementById('btn-play');
  if (btn) btn.innerHTML = player.paused ? TV_ICONS.play : TV_ICONS.pause;
};

window.toggleMute = function toggleMute() {
  const m = player.toggleMute();
  const btn = document.getElementById('btn-mute');
  if (btn) btn.innerHTML = m ? TV_ICONS.mute : TV_ICONS.vol;
  const slider = document.getElementById('tv-volume');
  if (slider) slider.value = m ? 0 : Math.round(player.video.volume * 100);
};

window.setTvVolume = function setTvVolume(val) {
  player.setVolume(val / 100);
  const muted = Number(val) === 0;
  player.video.muted = muted;
  const btn = document.getElementById('btn-mute');
  if (btn) btn.innerHTML = muted ? TV_ICONS.mute : TV_ICONS.vol;
};

window.toggleFullscreen = function toggleFullscreen() {
  const el = document.getElementById('player-area');
  if (!el) return;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
};

function showIptvOverlay() {
  const overlay = document.getElementById('iptv-player-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  if (_iptvOverlayTimer) clearTimeout(_iptvOverlayTimer);
  _iptvOverlayTimer = setTimeout(() => {
    overlay.classList.remove('visible');
    _iptvOverlayTimer = null;
  }, OVERLAY_HIDE_MS);
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
  el.innerHTML = `<p class="iptv-empty-msg">${esc(msg)}</p>`;
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

window.toggleIptvPlay = function toggleIptvPlay() {
  iptvPlayer.togglePlay();
  const btn = document.getElementById('iptv-btn-play');
  if (btn) btn.innerHTML = iptvPlayer.paused ? TV_ICONS.play : TV_ICONS.pause;
};

window.toggleIptvMute = function toggleIptvMute() {
  const m = iptvPlayer.toggleMute();
  const btn = document.getElementById('iptv-btn-mute');
  if (btn) btn.innerHTML = m ? TV_ICONS.mute : TV_ICONS.vol;
};

window.setIptvVolume = function setIptvVolume(val) {
  iptvPlayer.setVolume(val / 100);
  const muted = Number(val) === 0;
  iptvPlayer.video.muted = muted;
  const btn = document.getElementById('iptv-btn-mute');
  if (btn) btn.innerHTML = muted ? TV_ICONS.mute : TV_ICONS.vol;
};

window.toggleIptvFullscreen = function toggleIptvFullscreen() {
  const el = document.getElementById('iptv-player-area');
  if (!el) return;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
};

window.deleteChannel = async function deleteChannel(e, id) {
  e.stopPropagation();
  await API.del(`/channels/${id}`);
  allChannels = await API.get('/channels');
  applyTvFilters();
};

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

window.navUseCurrentLocation = function navUseCurrentLocation() {
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
};

function navTravelModeForMapsUrl(mode) {
  const m = String(mode || 'driving').toLowerCase();
  if (m === 'walking') return 'walking';
  if (m === 'bicycling') return 'bicycling';
  if (m === 'transit') return 'transit';
  return 'driving';
}

window.navOpenInGoogleMapsTab = function navOpenInGoogleMapsTab() {
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
};

window.navApplyRoute = function navApplyRoute() {
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
};

function applyPlayerLocale() {
  if (typeof AppI18n === 'undefined') return;
  AppI18n.setLanguage(_userLanguage);
  AppI18n.applyStatic(document);
  AppI18n.applyTvCategorySelect();
  AppI18n.applyNavModeSelect();
  if (typeof navUpdatePlaceholderMessage === 'function') navUpdatePlaceholderMessage();
}

function initVersionBadge() {
  const badge = document.getElementById('app-version-badge');
  const newestItem = document.querySelector('.app-version-item.newest b');
  if (!badge || !newestItem) return;
  const currentVersion = badge.dataset.version;
  const viewedKey = 'viewed-version-' + currentVersion;
  if (!localStorage.getItem(viewedKey)) {
    localStorage.setItem(viewedKey, 'true');
  }
}

async function init() {
  console.log(`[App] v${getAppVersion()} initializing...`);

  const unlock = () => {
    if (window.player) window.player.unlockAudio();
    if (window.iptvPlayer) window.iptvPlayer.unlockAudio();
  };
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('mousedown', unlock, { once: true });

  setInterval(() => {
    const activeP = getActivePlayer();
    if (activeP && activeP.mpegPlayer && activeP.mpegPlayer.source && activeP.mpegPlayer.source.socket) {
      const ws = activeP.mpegPlayer.source.socket;
      if (ws.readyState === 1) ws.send(new Uint8Array([0x00]));
    }
  }, 10000);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const target = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isTypingTarget = (target === 'input' || target === 'textarea');
      if (!isTypingTarget) {
        e.preventDefault();
        toggleActivePlayerPlay();
      }
    }
  });

  window.player = new TeslaPlayer('video-canvas');
  window.iptvPlayer = new TeslaPlayer('iptv-video-canvas', {
    spinnerId: 'iptv-spinner',
    containerId: 'iptv-player-area',
    emptyStateId: 'iptv-empty-state',
  });

  player = window.player;
  iptvPlayer = window.iptvPlayer;

  try {
    const [meData, chData] = await Promise.all([API.get('/me'), API.get('/channels')]);
    renderUser(meData.user);
    _userLanguage = String(meData.user?.preferred_language || 'tr').toLowerCase();
    allChannels = Array.isArray(chData) ? chData : [];
    renderChannels(allChannels);
    applyPlayerLocale();
    initVersionBadge();
  } catch (e) {
    console.warn('[App] init failed:', e.message);
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseForVisibility('tv', player);
      pauseForVisibility('iptv', iptvPlayer);
    } else if (document.visibilityState === 'visible') {
      resumeFromVisibilityIfNeeded('tv', player);
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeUserMenu();
    }
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    if (!menu) return;
    if (!menu.contains(e.target)) closeUserMenu();
  });

  if (typeof initKeyboardManager === 'function') initKeyboardManager();
  updateDockBackButton();
}

document.addEventListener('DOMContentLoaded', init);

