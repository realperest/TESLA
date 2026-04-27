/**
 * YouTube tarama
 * GET /api/youtube/search?q=sorgu  — yt-dlp ytsearch (güvenilir)
 * GET /api/youtube/trending         — Invidious API (failover, opsiyonel)
 */

const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { authenticate } = require('../middleware/authenticate');
const { ipLock } = require('../middleware/ipLock');

const router = express.Router();
router.use(authenticate, ipLock);

const { getYoutubeCookieArgs, DEFAULT_COOKIE_PATH } = require('../lib/ytDlpCookies');

// venv'deki yt-dlp önce kontrol edilir
const YT_DLP = (() => {
  const p = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { require('fs').accessSync(p); return p; } catch { return 'yt-dlp'; }
})();

// Invidious failover (trending için)
const INVIDIOUS = [
  'https://invidious.ducks.party',
  'https://invidious.io.lol',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
];

async function invFetch(path) {
  for (const base of INVIDIOUS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${base}/api/v1${path}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith('[') || text.startsWith('{')) return JSON.parse(text);
      }
    } catch {}
  }
  return null;
}

// ── Cookie ile YouTube feed/playlist al ──────────────────────
function cookieArgsForFeed() {
  const fromFile = getYoutubeCookieArgs();
  if (fromFile.length) return fromFile;
  if (process.platform === 'win32') {
    return ['--cookies-from-browser', 'chrome'];
  }
  return [];
}

function isLiveContent(v) {
  if (!v) return true;
  // yt-dlp flagleri
  if (v.is_live === true || v.live_status === 'is_live' || v.live_status === 'was_live') return true;
  // Süre kontrolü (canlı yayınların genellikle süresi yoktur veya 0'dır)
  if (!v.duration || v.duration <= 0) return true;
  // Başlık kontrolü (garantiye almak için)
  const title = String(v.title || '').toLowerCase();
  if (title.includes('canlı yayın') || title.includes('live stream') || title.includes('canlı izle')) return true;
  return false;
}

function ytDlpCookieFetch(url, maxItems = 30) {
  const cookieArgs = cookieArgsForFeed();

  return new Promise((resolve, reject) => {
    execFile(YT_DLP, [
      url,
      '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
      ...cookieArgs,
      '--playlist-items', `1:${maxItems}`,
    ], { timeout: 40000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const msg = err.message || '';
        if (msg.includes('Could not copy') || msg.includes('cookie')) {
          return reject(new Error(
            'COOKIE_ERROR: YouTube cookies gerekli. Chrome eklentisiyle export edin veya ' +
            `sunucuda YOUTUBE_COOKIES_FILE / ${DEFAULT_COOKIE_PATH} dosyasina kaydedin.`
          ));
        }
        return reject(new Error(msg));
      }
      const results = [];
      for (const line of stdout.trim().split('\n')) {
        try {
          const v = JSON.parse(line);
          if (!v.id) continue;
          if (isLiveContent(v)) continue; // Canlı yayın filtresi

          results.push({
            videoId: v.id,
            title: v.title || '',
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: Math.round(v.duration || 0),
            views: v.view_count || 0,
            channel: v.channel || v.uploader || '',
            publishedText: '',
          });
        } catch {}
      }
      resolve(results);
    });
  });
}

router.get('/history', async (req, res) => {
  try { res.json(await ytDlpCookieFetch('https://www.youtube.com/feed/history')); }
  catch (err) { console.error('[YT/history]', err.message); res.json({ error: err.message }); }
});

router.get('/watchlater', async (req, res) => {
  try { res.json(await ytDlpCookieFetch('https://www.youtube.com/playlist?list=WL')); }
  catch (err) { console.error('[YT/watchlater]', err.message); res.json({ error: err.message }); }
});

router.get('/liked', async (req, res) => {
  try { res.json(await ytDlpCookieFetch('https://www.youtube.com/playlist?list=LL')); }
  catch (err) { console.error('[YT/liked]', err.message); res.json({ error: err.message }); }
});

// ── Arama — yt-dlp ytsearch ───────────────────────────────────
router.get('/search', (req, res) => {
  const { q, n = 20, lang = 'tr' } = req.query;
  if (!q) return res.status(400).json({ error: 'q gerekli' });

  const count = Math.min(parseInt(n) || 20, 50);
  const l = String(lang || 'tr').toLowerCase();
  const langHint = {
    tr: 'turkce', en: 'english', de: 'deutsch', fr: 'francais', es: 'espanol', it: 'italiano', pt: 'portugues', nl: 'nederlands', ru: 'russian', ar: 'arabic',
  }[l] || '';
  const queryText = langHint ? `${q} ${langHint}` : String(q);

  execFile(YT_DLP, [
    ...getYoutubeCookieArgs(),
    `ytsearch${count}:${queryText}`,
    '--dump-json',
    '--flat-playlist',
    '--no-download',
    '--no-warnings',
  ], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(502).json({ error: 'Arama başarısız: ' + err.message });

    const results = [];
    for (const line of stdout.trim().split('\n')) {
      try {
        const v = JSON.parse(line);
        if (!v.id) continue;
        if (isLiveContent(v)) continue; // Canlı yayın filtresi

        results.push({
          videoId: v.id,
          title: v.title || '',
          thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          duration: Math.round(v.duration || 0),
          views: v.view_count || 0,
          channel: v.channel || v.uploader || '',
          publishedText: '',
        });
      } catch {}
    }
    res.json(results);
  });
});

// ── Trending — önce Invidious, olmazsa yt-dlp ile popüler arama ────────────
router.get('/trending', async (req, res) => {
  try {
    // 1. Yol: YouTube Ana Sayfası (Home Feed - Çerezler varsa kişiselleştirilmiş gelir)
    try {
      const results = await ytDlpCookieFetch('https://www.youtube.com/');
      if (results && results.length > 5) return res.json(results);
    } catch (e) {
      console.warn('[YT/home] yt-dlp home feed failed:', e.message);
    }

    // 2. Yol: YouTube Trending Sayfası (Genel Trendler)
    try {
      const results = await ytDlpCookieFetch('https://www.youtube.com/feed/trending');
      if (results && results.length > 0) return res.json(results);
    } catch (e) {
      console.warn('[YT/trending] yt-dlp feed/trending failed:', e.message);
    }

    // 3. Yol: Invidious (Çerezsiz Fallback)
    const inv = await invFetch('/trending?type=default&region=TR');
    if (inv && Array.isArray(inv) && inv.length > 0) {
      return res.json(
        inv.filter(v => !v.liveNow && v.lengthSeconds > 0).map(v => ({
          videoId: v.videoId,
          title: v.title || '',
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          duration: v.lengthSeconds || 0,
          views: v.viewCount || 0,
          channel: v.author || '',
          publishedText: v.publishedText || '',
        }))
      );
    }

    // 4. Yol: YouTube Arama (Son Çare)
    const query = 'ytsearch25:Türkiye trend videolar';
    execFile(YT_DLP, [
      ...getYoutubeCookieArgs(),
      query, '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
    ], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return res.json([]);
      const results = [];
      for (const line of stdout.trim().split('\n')) {
        try {
          const v = JSON.parse(line);
          if (!v.id) continue;
          if (isLiveContent(v)) continue;

          results.push({
            videoId: v.id,
            title: v.title || '',
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: Math.round(v.duration || 0),
            views: v.view_count || 0,
            channel: v.channel || v.uploader || '',
            publishedText: '',
          });
        } catch {}
      }
      res.json(results);
    });
  } catch (err) {
    console.error('[YT/trending] Fatal:', err.message);
    res.json([]);
  }
});

module.exports = router;
