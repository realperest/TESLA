/**
 * Tesla TV — Ana uygulama
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
  player   = new TeslaPlayer('video-canvas');
  ytPlayer = new TeslaPlayer('yt-canvas', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });

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
  } catch {
    return;
  }

  const tvSearch = document.getElementById('tv-search-input');
  if (tvSearch) {
    tvSearch.addEventListener('input', (e) => {
      tvSearchTerm = String(e.target.value || '').trim().toLowerCase();
      applyTvFilters();
    });
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
    const hasActiveSource = !!ytPlayer.video.src || !!ytPlayer.hls;
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
  if (avatar && user.avatar) { avatar.src = user.avatar; avatar.style.display = 'block'; }
  if (name) name.textContent = user.name || user.email;
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}

async function switchAccount() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
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
    container.innerHTML = `<div style="padding:20px;color:#555;font-size:13px;text-align:center">
      Kanal yok.<br>Kanal ekleme ve düzenleme için Ayarlar > TV bölümünü kullanın.
    </div>`;
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
      el.className = 'channel-item';
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
  document.querySelectorAll('.channel-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === String(ch.id))
  );
  setNowPlaying(ch.name, ch.category || '');

  // Aynı kanalın alternatif URL'lerini sırayla dene.
  const candidates = getChannelCandidates(ch);
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      const url = cand.url.includes('.m3u8')
        ? `/proxy/hls?url=${encodeURIComponent(cand.url)}`
        : cand.url;
      await player.load({ url, name: ch.name }, { silentError: !isLast, throwOnError: true });
      showTvOverlay();
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastErr) {
    console.warn('[TV] Kanal fallback denemeleri başarısız:', ch.name, lastErr.message);
    if (typeof player._showError === 'function') {
      const userMsg = typeof player._toUserError === 'function'
        ? player._toUserError(lastErr.message || '', ch)
        : 'Yayın açılamadı. TV Ayarları bölümünde yayın kaynağını güncellemeyi deneyebilirsiniz.';
      player._showError(userMsg);
    }
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
  document.getElementById('btn-play').innerHTML = player.video.paused ? TV_ICONS.play : TV_ICONS.pause;
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
}

function ytBackToMain() {
  ytShowView('main');
}

// ── VIEW 1: Ana grid (arama / trending) ───────────────────
let _ytMainVideos = [];

function renderMainGrid(videos) {
  _ytMainVideos = videos;
  const grid = document.getElementById('yt-main-grid');
  if (!videos.length) {
    grid.innerHTML = `<div class="yt-grid-empty"><div class="icon">🔍</div><div>Sonuç bulunamadı</div></div>`;
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
    grid.innerHTML = `<div class="yt-grid-empty" style="padding:30px 10px"><div>İlgili video bulunamadı</div></div>`;
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
  document.getElementById('yt-now-playing-title').textContent = v.title || 'Yükleniyor...';
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
    ytError('Stream alınamadı.');
  } finally {
    document.getElementById('yt-spinner').classList.remove('active');
    _ytResolving = false;
  }
}

async function ytStartPlay(data) {
  resolvedVideo = data;
  _ytLastVideoId = String(data?.videoId || _ytLastVideoId || '').trim();
  document.getElementById('yt-now-playing-title').textContent = data.title || 'Video';
  document.getElementById('yt-btn-play').innerHTML = YC_ICONS.pause;
  document.getElementById('yt-btn-mute').innerHTML = YC_ICONS.vol;

  const streamUrl = data.isHls
    ? `/proxy/hls?url=${encodeURIComponent(data.streamUrl)}`
    : data.streamUrl;

  const ok = await ytPlayer.load({ url: streamUrl, name: data.title || 'Video', isHls: data.isHls });
  if (!ok) {
    ytError('Stream alınamadı.');
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
  ytLoading(true, 'Aranıyor...');
  ytError('');
  try {
    const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(_userLanguage)}`);
    const data = await r.json();
    ytLoading(false);
    if (!r.ok || data.error) { ytError(data.error || 'Arama başarısız.'); return; }
    if (!Array.isArray(data)) { ytError('Geçersiz yanıt.'); return; }
    renderMainGrid(data);
  } catch {
    ytLoading(false);
    ytError('Arama başarısız.');
  }
}

function setYtInputMode(mode) {
  _ytInputMode = mode === 'link' ? 'link' : 'search';
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
    input.placeholder = _ytInputMode === 'search'
      ? 'Buraya aramak istediğiniz kelimeleri yazın...'
      : 'Buraya açmak istediğiniz videonun linkini yapıştırın...';
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
    ytError('Sunucuya bağlanılamadı.');
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
    ytLoading(true, 'Geçmiş videolar hazırlanıyor...');
    ytError('');
    const history = ytGetHistory();
    ytLoading(false);
    if (history.length) {
      renderMainGrid(history);
      return;
    }
    document.getElementById('yt-main-grid').innerHTML = `
      <div class="yt-grid-empty">
        <div class="icon" style="font-size:44px;opacity:0.35">•</div>
        <div>Henüz izleme geçmişi bulunamadı</div>
      </div>`;
    return;
  }

  ytLoading(true, 'Sana uygun videolar hazırlanıyor...');
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
      document.getElementById('yt-main-grid').innerHTML = `
        <div class="yt-grid-empty">
          <div class="icon" style="font-size:48px;opacity:0.3">▶️</div>
          <div>YouTube'da bir şeyler ara</div>
        </div>`;
    }
  } catch {
    ytLoading(false);
    document.getElementById('yt-main-grid').innerHTML = `
      <div class="yt-grid-empty"><div class="icon">🔍</div><div>Aramaya başla</div></div>`;
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
  el.textContent = msg || 'Yükleniyor...';
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
      ytLoading(true, 'Video tekrar hazırlanıyor...');
      const url = `https://www.youtube.com/watch?v=${vid}`;
      const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
      const data = await r.json();
      ytLoading(false);
      if (!r.ok) {
        ytError(data.message || data.error || 'Stream alınamadı.');
        return;
      }
      if (!data.videoId) data.videoId = vid;
      await ytStartPlay(data);
      return;
    } catch {
      ytLoading(false);
      ytError('Video tekrar başlatılamadı.');
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
  const hasActiveSource = !!ytPlayer.video.src || !!ytPlayer.hls;
  if (!hasActiveSource && resolvedVideo) {
    await playResolved();
    return;
  }
  ytPlayer.togglePlay();
  const btn = document.getElementById('yt-btn-play');
  btn.innerHTML = ytPlayer.video.paused ? YC_ICONS.play : YC_ICONS.pause;
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
  if (ytPlayer.video.duration) {
    ytPlayer.video.currentTime = pct * ytPlayer.video.duration;
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
// Dock navigasyon
// ─────────────────────────────────────────────

let _ytTrendingLoaded = false;

function stopInactiveSectionPlayback(nextSection) {
  // TV sekmesinden çıkınca stream'i düşürme: sadece duraklat (geri dönüşte tek tuşla devam etsin)
  if (_activeSection === 'tv' && nextSection !== 'tv' && player) {
    try {
      player.video.pause();
      player.isPlaying = false;
    } catch {}
    hideTvOverlay();
    const btn = document.getElementById('btn-play');
    if (btn) btn.innerHTML = TV_ICONS.play;
  }

  // YouTube sekmesinden çıkınca stream'i düşürme: sadece duraklat (geri dönüşte tek tuşla devam etsin)
  if (_activeSection === 'youtube' && nextSection !== 'youtube' && ytPlayer) {
    try {
      ytPlayer.video.pause();
      ytPlayer.isPlaying = false;
    } catch {}
    try { cancelAnimationFrame(_ytProgressRaf); } catch {}
    const btn = document.getElementById('yt-btn-play');
    if (btn) btn.innerHTML = YC_ICONS.play;
  }
}

function dockNav(section) {
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
}

document.addEventListener('DOMContentLoaded', init);
