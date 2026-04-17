const database = require('../database');

function ipLock(req, res, next) {
  if (!req.user) return next();

  const db = database.db;
  const currentIP = getIP(req);
  const { id: userId, locked_ip } = req.user;

  if (!locked_ip) {
    db.prepare(`UPDATE users SET locked_ip = ?, ip_locked_at = datetime('now') WHERE id = ?`).run(currentIP, userId);
    req.user.locked_ip = currentIP;
    return next();
  }

  if (locked_ip !== currentIP) {
    db.prepare(`INSERT INTO ip_change_log (user_id, old_ip, new_ip) VALUES (?, ?, ?)`).run(userId, locked_ip, currentIP);

    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({
        error: 'ip_locked',
        message: 'Bu hesap başka bir cihazdan/konumdan kullanılıyor.',
      });
    }

    return res.status(403).sendFile('ip_blocked.html', { root: 'public' });
  }

  next();
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

module.exports = { ipLock };
