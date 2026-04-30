/**
 * YouTube Teknik Menüsü (1 ve 5)
 * - /proxy/resolve ile streamUrl alır
 * - MP4 ise /proxy/mp4 üzerinden besler
 * - Teknik 1: canvas
 * - Teknik 5: img (mjpeg benzeri)
 */

(function () {
  const state = {
    activeTech: 1, // 1 | 5
    activeUrl: '',
    duration: 0,
    hasLoaded: false,
    view: 'grid', // 'grid' | 'player'
    lastResults: [],
    currentVideoId: '',
    currentVideoTitle: '',
    currentVideoChannel: '',
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(msg) {
    const el = $('yt-tech-status');
    if (!el) return;
    el.textContent = String(msg || '');
  }

  function fmt(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return '0:00';
    const whole = Math.floor(n);
    const m = Math.floor(whole / 60);
    const s = String(whole % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function setDuration(d) {
    state.duration = Number(d) || 0;
    const durEl = $('yt-tech-duration');
    if (durEl) durEl.textContent = fmt(state.duration);
  }

  function setTime(cur) {
    const timeEl = $('yt-tech-time');
    if (timeEl) timeEl.textContent = fmt(cur);
  }

  function setProgressUi(pct) {
    const fill = $('yt-tech-progress-fill');
    const thumb = $('yt-tech-progress-thumb');
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (fill) fill.style.width = `${p}%`;
    if (thumb) thumb.style.left = `${p}%`;
  }

  function getActiveModule() {
    return state.activeTech === 5 ? window.YtTech5 : window.YtTech1;
  }

  function showView(view) {
    state.view = view === 'player' ? 'player' : 'grid';
    const gridView = $('yt-tech-grid-view');
    const playerView = $('yt-tech-player-view');
    const controls = $('yt-tech-controls');
    if (gridView) gridView.style.display = state.view === 'grid' ? '' : 'none';
    if (playerView) playerView.style.display = state.view === 'player' ? '' : 'none';
    if (controls) controls.style.display = state.view === 'player' ? '' : 'none';
  }

  function isUrlOrId(q) {
    const raw = String(q || '').trim();
    if (!raw) return false;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return true;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return true;
    if (/(?:v=|be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/.test(raw)) return true;
    return false;
  }

  function ensureInit() {
    if (ensureInit._done) return;
    ensureInit._done = true;

    const volEl = $('yt-tech-vol');
    const progressWrapEl = $('yt-tech-progress');

    if (window.YtTech1) {
      window.YtTech1.init({
        canvas: $('yt-tech1-canvas'),
        volumeEl: volEl,
        progressWrapEl,
      });
    }

    if (window.YtTech5) {
      window.YtTech5.init({
        img: $('yt-tech5-img'),
        volumeEl: volEl,
        progressWrapEl,
      });
    }

    if (progressWrapEl) {
      progressWrapEl.addEventListener('click', (e) => {
        if (!state.duration) return;
        const rect = progressWrapEl.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const t = ratio * state.duration;
        ytTechSeek(t);
      });
    }

    const input = $('yt-tech-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ytTechSubmit();
        }
      });
    }
  }

  function setActiveTech(n) {
    const tech = Number(n) === 5 ? 5 : 1;
    state.activeTech = tech;
    const s1 = $('yt-tech-surface-1');
    const s5 = $('yt-tech-surface-5');
    if (s1) s1.style.display = tech === 1 ? '' : 'none';
    if (s5) s5.style.display = tech === 5 ? '' : 'none';
    setStatus(state.hasLoaded ? `Teknik ${tech} hazır.` : `Teknik ${tech} seçildi.`);
  }

  function fmtDuration(secs) {
    const n = Number(secs);
    if (!Number.isFinite(n) || n <= 0) return '';
    const whole = Math.floor(n);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = String(whole % 60).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s}`;
    return `${m}:${s}`;
  }

  function renderGrid(list) {
    const grid = $('yt-tech-grid');
    if (!grid) return;
    const videos = Array.isArray(list) ? list : [];
    state.lastResults = videos;
    if (!videos.length) {
      grid.innerHTML = `<div style="color:rgba(255,255,255,0.7);padding:10px;font-size:13px">Sonuç bulunamadı.</div>`;
      return;
    }

    grid.innerHTML = videos.map((v, idx) => {
      const title = String(v.title || '');
      const thumb = String(v.thumbnail || '');
      const channel = String(v.channel || '');
      const dur = v.duration ? fmtDuration(v.duration) : '';
      const vid = String(v.videoId || v.video_id || v.id || '');
      return `
        <div class="yt-tech-card" data-idx="${idx}" data-vid="${vid}">
          <div class="yt-tech-card-thumb">
            <img src="${thumb.replace(/"/g, '&quot;')}" alt="" loading="lazy">
            ${dur ? `<div class="yt-tech-card-dur">${dur}</div>` : ''}
          </div>
          <div class="yt-tech-card-body">
            <div class="yt-tech-card-title">${title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="yt-tech-card-meta">${channel.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.yt-tech-card').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          const vid = String(el.getAttribute('data-vid') || '').trim();
          if (!vid) return;
          setStatus(`Hazırlanıyor: ${vid}`);
          const input = $('yt-tech-input');
          if (input) input.value = `https://www.youtube.com/watch?v=${vid}`;
          const idx = Number(el.getAttribute('data-idx') || 0);
          const v = state.lastResults[idx] || {};
          await loadFromInput({
            autoplay: true,
            context: {
              videoId: vid,
              title: String(v.title || ''),
              channel: String(v.channel || ''),
            },
          });
        } catch (e) {
          setStatus(e && e.message ? e.message : 'Video açılamadı');
        }
      });
    });
  }

  function renderRelated(list) {
    const root = $('yt-tech-related-list');
    if (!root) return;
    const videos = Array.isArray(list) ? list : [];
    const filtered = videos.filter(v => {
      const id = String(v.videoId || v.video_id || v.id || '').trim();
      if (!id) return false;
      if (state.currentVideoId && id === state.currentVideoId) return false;
      return true;
    }).slice(0, 30);

    if (!filtered.length) {
      root.innerHTML = `<div style="color:rgba(255,255,255,0.7);padding:8px;font-size:12px">İlgili video bulunamadı.</div>`;
      return;
    }

    root.innerHTML = filtered.map((v) => {
      const vid = String(v.videoId || v.video_id || v.id || '').trim();
      const title = String(v.title || '');
      const channel = String(v.channel || '');
      const thumb = String(v.thumbnail || '');
      const dur = v.duration ? fmtDuration(v.duration) : '';
      return `
        <div class="yt-tech-related-item" data-vid="${vid}">
          <div class="yt-tech-related-thumb">
            <img src="${thumb.replace(/"/g, '&quot;')}" alt="" loading="lazy">
            ${dur ? `<div class="yt-tech-card-dur">${dur}</div>` : ''}
          </div>
          <div class="yt-tech-related-body">
            <div class="yt-tech-related-title">${title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="yt-tech-related-meta">${channel.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          </div>
        </div>
      `;
    }).join('');

    root.querySelectorAll('.yt-tech-related-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const vid = String(el.getAttribute('data-vid') || '').trim();
        if (!vid) return;
        const input = $('yt-tech-input');
        if (input) input.value = `https://www.youtube.com/watch?v=${vid}`;
        await loadFromInput({ autoplay: true, context: { videoId: vid } });
      });
    });
  }

  async function fetchRelatedForContext(ctx) {
    const baseTitle = String(ctx?.title || state.currentVideoTitle || '').trim();
    const baseChannel = String(ctx?.channel || state.currentVideoChannel || '').trim();
    const q = baseChannel || baseTitle;
    const root = $('yt-tech-related-list');
    if (root) root.innerHTML = `<div style="color:rgba(255,255,255,0.7);padding:8px;font-size:12px">Yükleniyor...</div>`;
    if (!q) {
      renderRelated([]);
      return;
    }
    try {
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&n=24&lang=tr`);
      const data = await r.json().catch(() => []);
      if (!r.ok) throw new Error((data && data.error) ? data.error : 'related_failed');
      if (!Array.isArray(data)) throw new Error('invalid_response');
      renderRelated(data);
    } catch (e) {
      renderRelated([]);
    }
  }

  async function searchVideos(q) {
    const query = String(q || '').trim();
    if (!query) return;
    setStatus('Aranıyor...');
    showView('grid');
    try {
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&n=30&lang=tr`);
      const data = await r.json().catch(() => []);
      if (!r.ok) throw new Error((data && data.error) ? data.error : 'search_failed');
      if (!Array.isArray(data)) throw new Error('invalid_response');
      renderGrid(data);
      setStatus(`Sonuç: ${data.length}`);
    } catch (e) {
      renderGrid([]);
      setStatus(e.message || 'Arama hatası');
    }
  }

  async function resolveYoutubeToMp4Proxy(urlOrId) {
    const raw = String(urlOrId || '').trim();
    if (!raw) throw new Error('empty_input');

    const isUrl = raw.startsWith('http://') || raw.startsWith('https://');
    const vidMatch = raw.match(/(?:v=|be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    const videoId = vidMatch ? vidMatch[1] : (/^[a-zA-Z0-9_-]{11}$/.test(raw) ? raw : '');
    const url = isUrl ? raw : (videoId ? `https://www.youtube.com/watch?v=${videoId}` : raw);

    const r = await fetch(`/proxy/resolve?url=${encodeURIComponent(url)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || 'resolve_failed');

    if (data.isHls) {
      throw new Error('Bu teknikler HLS ile çalışmıyor. MP4 gereklidir.');
    }

    const streamUrl = String(data.streamUrl || '').trim();
    if (!streamUrl) throw new Error('stream_url_missing');

    // CORS/Range için kendi proxy'miz
    const mp4ProxyUrl = `/proxy/mp4?url=${encodeURIComponent(streamUrl)}`;
    return { mp4ProxyUrl, meta: data };
  }

  async function loadFromInput(options = {}) {
    ensureInit();
    const input = $('yt-tech-input');
    const q = String(input ? input.value : '').trim();
    if (!q) return;

    setStatus('Çözülüyor...');
    state.hasLoaded = false;
    setProgressUi(0);
    setTime(0);
    setDuration(0);
    showView('player');

    // reset both
    try { window.YtTech1 && window.YtTech1.reset(); } catch {}
    try { window.YtTech5 && window.YtTech5.reset(); } catch {}

    const ctx = options && options.context ? options.context : null;
    state.currentVideoId = String(ctx?.videoId || '').trim();
    state.currentVideoTitle = String(ctx?.title || '').trim();
    state.currentVideoChannel = String(ctx?.channel || '').trim();

    const { mp4ProxyUrl, meta } = await resolveYoutubeToMp4Proxy(q);
    state.activeUrl = mp4ProxyUrl;
    setStatus('Yükleniyor...');

    const onMeta = ({ duration }) => {
      setDuration(duration || meta.duration || 0);
      state.hasLoaded = true;
      setStatus(`Hazır: ${String(meta.title || 'Video')}`);
    };

    const mod1 = window.YtTech1;
    const mod5 = window.YtTech5;
    if (!mod1 || !mod5) throw new Error('tech_modules_missing');

    // İki tekniğe de aynı kaynağı yükle; aktif olan oynatılır
    await Promise.all([
      mod1.loadMp4(mp4ProxyUrl, { onMeta }),
      mod5.loadMp4(mp4ProxyUrl, { onMeta }),
    ]);

    fetchRelatedForContext(ctx).catch(() => {});

    if (options.autoplay) {
      setStatus(`Başlatılıyor (Teknik ${state.activeTech})...`);
      // İlk tetik (yükleme bittiği anda)
      play();
      // Bazı cihazlarda ilk mp4box/decoder hazırlık anında tetik kaçabiliyor; kısa bir tekrar garanti eder.
      setTimeout(() => { try { play(); } catch {} }, 250);
    }
  }

  function play() {
    ensureInit();
    const mod = getActiveModule();
    if (!mod) return;
    mod.play();
    setStatus(`Teknik ${state.activeTech} oynatılıyor.`);
  }

  function pause() {
    ensureInit();
    const mod = getActiveModule();
    if (!mod) return;
    mod.pause();
    setStatus(`Teknik ${state.activeTech} duraklatıldı.`);
  }

  function reset() {
    ensureInit();
    try { window.YtTech1 && window.YtTech1.reset(); } catch {}
    try { window.YtTech5 && window.YtTech5.reset(); } catch {}
    state.activeUrl = '';
    state.duration = 0;
    state.hasLoaded = false;
    setProgressUi(0);
    setTime(0);
    setDuration(0);
    setStatus(`Teknik ${state.activeTech} sıfırlandı.`);
  }

  function seek(t) {
    ensureInit();
    const mod = getActiveModule();
    if (!mod) return;
    mod.seek(t);
  }

  function pauseAll() {
    try { window.YtTech1 && window.YtTech1.pause(); } catch {}
    try { window.YtTech5 && window.YtTech5.pause(); } catch {}
  }

  function submit() {
    ensureInit();
    const input = $('yt-tech-input');
    const q = String(input ? input.value : '').trim();
    if (!q) return;
    if (isUrlOrId(q)) {
      loadFromInput({ autoplay: true }).catch((e) => setStatus(e.message || 'Hata'));
      return;
    }
    searchVideos(q);
  }

  function backToGrid() {
    pauseAll();
    showView('grid');
    setStatus('Listeye dönüldü.');
  }

  // UI köprüsü (progress güncelleme)
  window.YtTechUi = {
    startProgress(startFn) {
      if (typeof startFn === 'function') startFn();
    },
    setProgress(pct, cur, dur) {
      setProgressUi(pct);
      setTime(cur);
      if (!state.duration && dur) setDuration(dur);
    },
  };

  // Global API (player.html onclick'leri için)
  window.ytTechSetActive = setActiveTech;
  window.ytTechLoadFromInput = () => loadFromInput({ autoplay: true }).catch((e) => setStatus(e.message || 'Hata'));
  window.ytTechSubmit = submit;
  window.ytTechPlay = play;
  window.ytTechPause = pause;
  window.ytTechReset = reset;
  window.ytTechSeek = seek;
  window.ytTechPauseAll = pauseAll;
  window.ytTechBackToGrid = backToGrid;

  document.addEventListener('DOMContentLoaded', () => {
    ensureInit();
    setActiveTech(1);
    showView('grid');
    renderGrid([]);
    renderRelated([]);
  });
})();

