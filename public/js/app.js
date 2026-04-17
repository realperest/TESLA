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
let resolvedVideo = null;
let _ytResolving = false;

// ─────────────────────────────────────────────
// Başlatma
// ─────────────────────────────────────────────

async function init() {
  player   = new TeslaPlayer('video-canvas');
  ytPlayer = new TeslaPlayer('yt-canvas', { spinnerId: 'yt-spinner', containerId: 'yt-player-area' });

  try {
    const [meData, chData] = await Promise.all([API.get('/me'), API.get('/channels')]);
    renderUser(meData.user);
    channels = chData;
    renderChannels(channels);
  } catch {
    return;
  }

  // Theater Mode ipucu
  const hint = document.getElementById('theater-hint');
  if (hint) hint.textContent = location.origin + '/theater';

  // Overlay dokunma kontrolü
  const overlay = document.getElementById('player-overlay');
  const playerArea = document.getElementById('player-area');
  playerArea.addEventListener('click', (e) => {
    if (e.target === overlay || overlay.contains(e.target)) return;
    overlay.classList.toggle('visible');
    clearTimeout(window._overlayTimer);
    if (overlay.classList.contains('visible')) {
      window._overlayTimer = setTimeout(() => overlay.classList.remove('visible'), 5000);
    }
  });

  // ESC ile modalı kapat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAddModal(); }
  });

  // YouTube player alanına tıklama = play/pause (kontrol butonları hariç)
  document.getElementById('yt-player-area').addEventListener('click', (e) => {
    const controls = document.getElementById('yt-controls');
    if (controls && controls.contains(e.target)) return;
    if (ytPlayer && ytPlayer.video.src) toggleYtPlay();
  });
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

// ─────────────────────────────────────────────
// Kanallar
// ─────────────────────────────────────────────

function renderChannels(list) {
  const container = document.getElementById('channel-list');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = `<div style="padding:20px;color:#555;font-size:13px;text-align:center">
      Kanal yok.<br>Aşağıdan ekleyin.
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
  return { haber: '📺', spor: '⚽', müzik: '🎵', belgesel: '🌍', eğlence: '🎬' }[cat] || '📡';
}

// ─────────────────────────────────────────────
// Oynatma
// ─────────────────────────────────────────────

async function playChannel(ch) {
  document.querySelectorAll('.channel-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === String(ch.id))
  );
  setNowPlaying(ch.name, ch.category || '');
  const url = ch.url.includes('.m3u8')
    ? `/proxy/hls?url=${encodeURIComponent(ch.url)}`
    : ch.url;
  await player.load({ url, name: ch.name });
}

function setNowPlaying(title, sub) {
  document.getElementById('now-playing-title').textContent = title;
  document.getElementById('now-playing-sub').textContent = sub;
}

// Oynat / Duraklat
function togglePlay() {
  player.togglePlay();
  document.getElementById('btn-play').textContent = player.video.paused ? '▶' : '⏸';
}

function toggleMute() {
  const m = player.toggleMute();
  document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
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
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok) { ytError(data.message || data.error); return; }
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
  document.getElementById('yt-now-playing-title').textContent = data.title || 'Video';
  document.getElementById('yt-btn-play').innerHTML = YC_ICONS.pause;
  document.getElementById('yt-btn-mute').innerHTML = YC_ICONS.vol;

  const streamUrl = data.isHls
    ? `/proxy/hls?url=${encodeURIComponent(data.streamUrl)}`
    : data.streamUrl;

  await ytPlayer.load({ url: streamUrl, name: data.title || 'Video', isHls: data.isHls });
  _startYtProgress();
  _ytFetchSidebar(data);
}

async function _ytFetchSidebar(data) {
  if (!data || !data.title) return;
  let q = data.title.replace(/[\[\(\{].*?[\]\)\}]/g, '').replace(/[^\w\sğüşıöçĞÜŞİÖÇ]/gi, ' ').trim();
  if (data.channel) q = data.channel + ' ' + q;
  q = q.split(' ').filter(Boolean).slice(0, 6).join(' ');
  try {
    const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
    const results = await r.json();
    if (!Array.isArray(results)) return;
    // Şu an oynayanı üste işaretle
    const marked = results.map(v => Object.assign({}, v, { isNowPlaying: v.videoId === data.videoId }));
    renderSidebarGrid(marked);
  } catch {}
}

// ── Arama ─────────────────────────────────────────────────
async function ytSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  ytShowView('main');
  ytLoading(true, 'Aranıyor...');
  ytError('');
  try {
    const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
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

function toggleYtUrlBar() {
  const bar = document.getElementById('yt-url-bar');
  const visible = bar.style.display !== 'none';
  bar.style.display = visible ? 'none' : 'flex';
  if (!visible) document.getElementById('yt-url-input').focus();
}

async function resolveUrl() {
  const url = document.getElementById('yt-url-input').value.trim();
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
}

function ytGetHistory() {
  return JSON.parse(localStorage.getItem('yt-history') || '[]');
}

async function ytLoadTrending() {
  ytShowView('main');
  const history = ytGetHistory();
  if (history.length > 0) {
    renderMainGrid(history);
    return;
  }
  ytLoading(true, 'Trend videolar yükleniyor...');
  try {
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

function toggleYtPlay() {
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
  document.getElementById('add-modal').classList.add('open');
  setTimeout(() => document.getElementById('ch-name').focus(), 100);
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
  document.getElementById('add-form').reset();
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
    channels = await API.get('/channels');
    renderChannels(channels);
    closeAddModal();
  } catch {}
}

async function deleteChannel(e, id) {
  e.stopPropagation();
  await API.del(`/channels/${id}`);
  channels = await API.get('/channels');
  renderChannels(channels);
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

function dockNav(section) {
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

  // YouTube sekmesine ilk girişte trending yükle
  if (section === 'youtube' && !_ytTrendingLoaded) {
    _ytTrendingLoaded = true;
    ytLoadTrending();
  }
}

document.addEventListener('DOMContentLoaded', init);
