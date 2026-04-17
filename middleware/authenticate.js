const jwt = require('jsonwebtoken');
const database = require('../database');

const COOKIE_NAME = process.env.COOKIE_NAME || 'tesla_tv_session';

function authenticate(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return _redirect(req, res);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.clearCookie(COOKIE_NAME);
    return _redirect(req, res);
  }

  const db = database.db;

  const session = db.prepare(`
    SELECT s.*, u.id as uid, u.email, u.name, u.avatar, u.role, u.preferred_language,
           u.locked_ip, u.is_active, u.membership_id,
           m.status as membership_status, m.max_users
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN memberships m ON m.id = u.membership_id
    WHERE s.token = ? AND s.is_active = 1
  `).get(payload.jti);

  if (!session) {
    res.clearCookie(COOKIE_NAME);
    return _redirect(req, res);
  }

  // Oturum süresi kontrolü (JS tarafında)
  if (new Date(session.expires_at) < new Date()) {
    db.prepare(`UPDATE sessions SET is_active = 0 WHERE token = ?`).run(payload.jti);
    res.clearCookie(COOKIE_NAME);
    return _redirect(req, res);
  }

  if (!session.is_active) {
    return _error(req, res, 403, 'Hesabınız askıya alınmış.');
  }

  if (session.membership_status !== 'active') {
    return _error(req, res, 403, 'Üyelik paketiniz aktif değil.');
  }

  // last_seen güncelle
  db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE token = ?`).run(payload.jti);

  req.user = {
    id: session.uid,
    email: session.email,
    name: session.name,
    avatar: session.avatar,
    role: session.role,
    preferred_language: session.preferred_language || 'tr',
    membership_id: session.membership_id,
    locked_ip: session.locked_ip,
    sessionToken: payload.jti,
  };

  next();
}

function _redirect(req, res) {
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Oturum açılmamış' });
  return res.redirect('/login.html');
}

function _error(req, res, code, msg) {
  if (req.originalUrl.startsWith('/api/')) return res.status(code).json({ error: msg });
  return res.status(code).send(`<h2>${msg}</h2><a href="/login.html">Giriş Yap</a>`);
}

module.exports = { authenticate };
