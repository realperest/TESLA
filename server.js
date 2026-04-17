require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initDB } = require('./database');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const proxyRoutes = require('./routes/proxy');
const youtubeRoutes = require('./routes/youtube');
const { authenticate } = require('./middleware/authenticate');
const { ipLock } = require('./middleware/ipLock');

const app = express();
app.set('trust proxy', 1); // Reverse proxy arkasında gerçek IP için

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

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
  app.listen(PORT, () => {
    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    console.log('\n========================================');
    console.log(`  Tesla TV calisiyor`);
    console.log(`  Adres : ${base}`);
    console.log(`  Theater : youtube.com/redirect?q=${base}/theater`);
    console.log('========================================\n');
  });
}).catch(err => {
  console.error('Veritabani baslatma hatasi:', err);
  process.exit(1);
});
