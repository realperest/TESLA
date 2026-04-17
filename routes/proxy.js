/**
 * YouTube & genel video URL çözücü
 *
 * GET /proxy/resolve?url=<youtube_or_video_url>
 *   → { streamUrl, title, thumbnail, formats }
 *
 * Sistem'de yt-dlp kurulu olması gerekir:
 *   Windows: https://github.com/yt-dlp/yt-dlp/releases → yt-dlp.exe → PATH'e ekle
 *   Linux/Mac: pip install yt-dlp
 *
 * yt-dlp yoksa hata döner, IPTV kanalları etkilenmez.
 */

const express = require('express');
const { execFile } = require('child_process');
const http = require('http');
const https = require('https');
const { authenticate } = require('../middleware/authenticate');
const { ipLock } = require('../middleware/ipLock');

const router = express.Router();

// HLS stream proxy — auth gerektirmez (hls.js segment istekleri cookie göndermez)
router.get('/hls', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url gerekli' });

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch {
    return res.status(400).json({ error: 'geçersiz url' });
  }

  const lib = parsedUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': parsedUrl.origin + '/',
      'Origin': parsedUrl.origin,
    },
  };

  const proxyReq = lib.get(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || '';
    res.setHeader('Content-Type', ct || 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache');

    if (ct.includes('mpegurl') || url.includes('.m3u8')) {
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        const parsedBase = new URL(url);
        const basePath = parsedBase.origin + parsedBase.pathname.substring(0, parsedBase.pathname.lastIndexOf('/') + 1);
        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          let absUrl;
          if (trimmed.startsWith('http')) {
            absUrl = trimmed;
          } else if (trimmed.startsWith('/')) {
            absUrl = parsedBase.origin + trimmed;
          } else {
            absUrl = basePath + trimmed;
          }
          return `/proxy/hls?url=${encodeURIComponent(absUrl)}`;
        }).join('\n');
        res.send(rewritten);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('[HLS Proxy] hata:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'proxy hatası' });
  });

  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'zaman aşımı' });
  });
});

router.use(authenticate, ipLock);

// Önbellek: aynı URL için 30 dk içinde tekrar çözme
const cache = new Map(); // url → { data, expires }
const CACHE_TTL = 30 * 60 * 1000; // 30 dakika

router.get('/resolve', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parametresi gerekli' });

  // Önbellekten dön
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) {
    return res.json(cached.data);
  }

  try {
    const data = await resolveWithYtDlp(url);
    cache.set(url, { data, expires: Date.now() + CACHE_TTL });
    res.json(data);
  } catch (err) {
    console.error('[Proxy] yt-dlp hatası:', err.message);
    res.status(502).json({
      error: 'video_resolve_failed',
      message: err.message.includes('not found') || err.message.includes('not recognized')
        ? 'yt-dlp kurulu değil. Lütfen yt-dlp\'yi yükleyin: https://github.com/yt-dlp/yt-dlp'
        : 'Video çözümlenemedi: ' + err.message,
    });
  }
});

/**
 * yt-dlp ile en iyi video stream URL'sini al
 * Öncelik: HLS (m3u8) > mp4 (480p-720p)
 */
const path = require('path');
const YT_DLP = (() => {
  const venvExe = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { require('fs').accessSync(venvExe); return venvExe; } catch { return 'yt-dlp'; }
})();

function resolveWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    // JSON formatında tüm format bilgilerini al
    execFile(YT_DLP, [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      // Önce YouTube format 22 (720p ses+video birleşik), sonra 18 (360p), sonra generic best
      '-f', '22/18/best[height<=720][ext=mp4][vcodec!=none][acodec!=none][protocol!=m3u8][protocol!=m3u8_native]/best[ext=mp4][vcodec!=none][acodec!=none][protocol!=m3u8][protocol!=m3u8_native]/best[vcodec!=none][acodec!=none][protocol!=m3u8][protocol!=m3u8_native]/best',
      url,
    ], { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));

      let info;
      try {
        info = JSON.parse(stdout.trim().split('\n').pop());
      } catch {
        return reject(new Error('yt-dlp çıktısı ayrıştırılamadı'));
      }

      const streamUrl = info.url;
      if (!streamUrl) return reject(new Error('Stream URL alınamadı'));

      const isLive = !!(info.is_live || info.live_status === 'is_live');
      const isHls = isLive || streamUrl.includes('.m3u8') || info.protocol === 'm3u8_native';

      // Canlı yayın HLS → oynatma desteklenmiyor, net hata döndür
      if (isLive && isHls) {
        return reject(Object.assign(new Error('Canlı yayınlar şu an desteklenmiyor'), { code: 'LIVE_STREAM' }));
      }

      resolve({
        streamUrl,
        title: info.title || 'Video',
        thumbnail: info.thumbnail || null,
        duration: info.duration || null,
        isHls,
        isLive,
      });
    });
  });
}

module.exports = router;
