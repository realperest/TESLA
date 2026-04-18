require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { WebSocketServer } = require('ws');

const { materializeCookiesFromB64 } = require('./lib/ytDlpCookies');
materializeCookiesFromB64();

const { initDB } = require('./database');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const proxyRoutes = require('./routes/proxy');
const youtubeRoutes = require('./routes/youtube');
const { authenticate, verifyForWs } = require('./middleware/authenticate');
const { ipLock } = require('./middleware/ipLock');
const { startChannelUpdater } = require('./services/channelUpdater');
const { handleStreamConnection } = require('./routes/stream');

const app = express();
app.set('trust proxy', 1); // Reverse proxy arkasında gerçek IP için

/**
 * BASE_URL kanonik domain ise, *.up.railway.app vb. adreslerde adres çubuğunda kalmamak için
 * aynı yolu kanonik siteye 301 yönlendirir. Yerel geliştirme (localhost) etkilenmez.
 * İsteğe bağlı: ALLOWED_HOSTS=www.acilsusam.net (BASE_URL hostname'i dışında izin verilen hostlar)
 */
app.use((req, res, next) => {
  const raw = process.env.BASE_URL;
  if (!raw || typeof raw !== 'string') return next();
  let canonical;
  try {
    canonical = new URL(raw.trim());
  } catch {
    return next();
  }
  const canonicalHost = canonical.hostname.toLowerCase();
  const hostRaw = (req.get('host') || '').split(':')[0].toLowerCase();
  if (!hostRaw || hostRaw === 'localhost' || hostRaw === '127.0.0.1') return next();
  const allowed = new Set([canonicalHost]);
  if (process.env.ALLOWED_HOSTS) {
    process.env.ALLOWED_HOSTS.split(/[\s,]+/).forEach((h) => {
      const t = h.trim().toLowerCase();
      if (t) allowed.add(t);
    });
  }
  if (allowed.has(hostRaw)) return next();
  const target = new URL(req.originalUrl || '/', canonical.origin);
  return res.redirect(301, target.toString());
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// manage.html — statik klasörden değil, /manage ile aynı koruma (iframe dışı linkler için)
app.get('/manage.html', authenticate, ipLock, (req, res) => {
  res.redirect(302, '/manage');
});

// ── Statik dosyalar (login.html vs. herkese açık) ──────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth rotaları (Google OAuth) ────────────────────────────────────────────
app.use('/auth', authRoutes);

// ── API rotaları (authenticate + ipLock middleware içinde) ──────────────────
app.use('/api', apiRoutes);
app.use('/proxy', proxyRoutes);
app.use('/api/youtube', youtubeRoutes);

// ── Korumalı HTML sayfaları ─────────────────────────────────────────────────
app.get('/', authenticate, ipLock, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// Theater Mode: youtube.com/redirect?q=https://senin-domain.com/theater
app.get('/theater', authenticate, ipLock, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/manage', authenticate, ipLock, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manage.html'));
});

// ── Hata sayfaları ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Başlat ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  startChannelUpdater();

  // HTTP server — WebSocket upgrade için express yerine http.createServer kullanılıyor
  const server = http.createServer(app);

  // WebSocket server (noServer=true → upgrade event'ini manuel yönetiyoruz)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL('http://x' + (req.url || '')).pathname;
    if (pathname !== '/stream/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Cookie üzerinden session doğrula
    verifyForWs(req, (err, user) => {
      if (err || !user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      req.user = user;
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleStreamConnection(ws, req);
      });
    });
  });

  server.listen(PORT, () => {
    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    console.log('\n========================================');
    console.log(`  Açıl Susam çalışıyor`);
    console.log(`  Adres   : ${base}`);
    console.log(`  Stream  : wss://host/stream/ws?url=<encoded>`);
    console.log(`  Theater : youtube.com/redirect?q=${base}/theater`);
    console.log('========================================\n');
  });
}).catch(err => {
  console.error('Veritabani baslatma hatasi:', err);
  process.exit(1);
});
