const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const database = require('../database');

const router = express.Router();
const COOKIE_NAME = process.env.COOKIE_NAME || 'tesla_tv_session';
const SESSION_DAYS = 30;

// ──────────────────────────────────────────────
// 1. Google OAuth başlatma
// ──────────────────────────────────────────────
router.get('/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ──────────────────────────────────────────────
// 2. Google OAuth callback
// ──────────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login.html?error=google_denied');

  try {
    const db = database.db;

    // Kodu access_token ile değiştir
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token alınamadı');

    // Google kullanıcı bilgilerini al
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.sub) throw new Error('Profil alınamadı');

    // Kullanıcıyı DB'de bul veya oluştur
    const user = findOrCreateUser(db, profile);

    if (!user.is_active) {
      return res.redirect('/login.html?error=account_suspended');
    }

    // Membership kontrolü
    const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(user.membership_id);
    if (!membership || membership.status !== 'active') {
      return res.redirect('/login.html?error=membership_inactive');
    }

    // Kullanıcının mevcut aktif oturumlarını kapat
    db.prepare(`UPDATE sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1`).run(user.id);

    // Yeni oturum oluştur
    const jti = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const ip = getIP(req);

    db.prepare(`
      INSERT INTO sessions (user_id, token, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, jti, ip, req.headers['user-agent'] || '', expiresAt.toISOString());

    // JWT oluştur (sadece jti içerir — gerçek veri DB'de)
    const token = jwt.sign({ jti }, process.env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });

    res.redirect('/');
  } catch (err) {
    console.error('[AUTH] Google callback hatası:', err.message);
    res.redirect('/login.html?error=server_error');
  }
});

// ──────────────────────────────────────────────
// 3. Çıkış
// ──────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const { jti } = jwt.verify(token, process.env.JWT_SECRET);
      database.db.prepare(`UPDATE sessions SET is_active = 0 WHERE token = ?`).run(jti);
    } catch {}
  }
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login.html');
});

// ──────────────────────────────────────────────
// Yardımcılar
// ──────────────────────────────────────────────

function findOrCreateUser(db, profile) {
  // Mevcut kullanıcı varsa güncelle
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.sub);
  if (existing) {
    db.prepare(`UPDATE users SET name = ?, avatar = ? WHERE id = ?`).run(
      profile.name, profile.picture, existing.id
    );
    return { ...existing, name: profile.name, avatar: profile.picture };
  }

  // Davet var mı? (e-posta ile eşleştir)
  const invite = db.prepare(
    `SELECT * FROM invites WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).get(profile.email);

  let membershipId, role;

  if (invite) {
    // Davetli: mevcut membership'e ekle
    const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(invite.membership_id);
    const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE membership_id = ?').get(invite.membership_id).cnt;

    if (membership && membership.status === 'active' && userCount < membership.max_users) {
      membershipId = invite.membership_id;
      role = 'member';
      // Daveti kullanıldı olarak işaretle
      db.prepare('UPDATE invites SET used = 1 WHERE id = ?').run(invite.id);
    }
  }

  if (!membershipId) {
    // Davet yoksa ya da geçersizse — kendi üyeliğini oluştur
    const membershipResult = db.prepare(
      `INSERT INTO memberships (name, plan, max_users) VALUES (?, 'basic', 3)`
    ).run(profile.name || profile.email);
    membershipId = membershipResult.lastInsertRowid;
    role = 'owner';
  }

  const userResult = db.prepare(`
    INSERT INTO users (membership_id, google_id, email, name, avatar, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(membershipId, profile.sub, profile.email, profile.name, profile.picture, role);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userResult.lastInsertRowid);
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

module.exports = router;
