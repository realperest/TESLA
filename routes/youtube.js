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

// venv'deki yt-dlp önce kontrol edilir
const YT_DLP = (() => {
  const p = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { require('fs').accessSync(p); return p; } catch { return 'yt-dlp'; }
})();

// Invidious failover (trending için)
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://inv.thepixora.com',
  'https://invidious.privacydev.net',
  'https://invidious.flokinet.to',
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
const fs = require('fs');
const COOKIES_FILE = path.join(__dirname, '..', 'youtube-cookies.txt');

function ytDlpCookieFetch(url, maxItems = 30) {
  // Önce cookies.txt dosyasını dene, yoksa browser cookie dene
  const hasCookieFile = fs.existsSync(COOKIES_FILE);
  const cookieArgs = hasCookieFile
    ? ['--cookies', COOKIES_FILE]
    : ['--cookies-from-browser', 'chrome'];

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
            'COOKIE_ERROR: Chrome cookie\'lerine erişilemedi. ' +
            'Chrome\'daki "Get cookies.txt LOCALLY" eklentisiyle YouTube cookie\'lerini ' +
            `"youtube-cookies.txt" olarak şuraya kaydedin: ${path.join(__dirname, '..')}`
          ));
        }
        return reject(new Error(msg));
      }
      const results = [];
      for (const line of stdout.trim().split('\n')) {
        try {
          const v = JSON.parse(line);
          if (!v.id || !v.duration) continue;
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
    tr: 'turkce',
    en: 'english',
    de: 'deutsch',
    fr: 'francais',
    es: 'espanol',
    it: 'italiano',
    pt: 'portugues',
    nl: 'nederlands',
    ru: 'russian',
    ar: 'arabic',
  }[l] || '';
  const queryText = langHint ? `${q} ${langHint}` : String(q);

  execFile(YT_DLP, [
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
  // Önce Invidious dene
  const inv = await invFetch('/trending?type=default&region=TR');
  if (inv && Array.isArray(inv) && inv.length > 0) {
    return res.json(
      inv
        .filter(v => !v.liveNow && v.lengthSeconds > 0)
        .map(v => ({
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

  // Invidious çalışmıyorsa yt-dlp ile popüler arama
  const query = 'ytsearch20:Türkiye gündem 2025';
  execFile(YT_DLP, [
    query, '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
  ], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.json([]);
    const results = [];
    for (const line of stdout.trim().split('\n')) {
      try {
        const v = JSON.parse(line);
        if (!v.id || !v.duration) continue; // süresiz = canlı yayın
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

module.exports = router;
