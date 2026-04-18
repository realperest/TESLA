const database = require('../database');

/** Aynı kullanıcı en fazla bu kadar farklı IP ile oturum açabilir (| ile saklanır). */
const MAX_ALLOWED_IPS = 3;

function parseAllowedIps(lockedIp) {
  if (!lockedIp || !String(lockedIp).trim()) return [];
  const s = String(lockedIp).trim();
  if (s.includes('|')) {
    return [...new Set(s.split('|').map((x) => x.trim()).filter(Boolean))];
  }
  return [s];
}

function formatAllowedIps(ips) {
  return [...new Set(ips)].slice(0, MAX_ALLOWED_IPS).join('|');
}

function ipLock(req, res, next) {
  if (!req.user) return next();

  const db = database.db;
  const currentIP = getIP(req);
  const { id: userId, locked_ip } = req.user;
  const allowed = parseAllowedIps(locked_ip);

  if (allowed.length === 0) {
    db.prepare(`UPDATE users SET locked_ip = ?, ip_locked_at = datetime('now') WHERE id = ?`).run(currentIP, userId);
    req.user.locked_ip = currentIP;
    return next();
  }

  if (allowed.includes(currentIP)) {
    return next();
  }

  if (allowed.length < MAX_ALLOWED_IPS) {
    const merged = formatAllowedIps([...allowed, currentIP]);
    db.prepare(`UPDATE users SET locked_ip = ? WHERE id = ?`).run(merged, userId);
    req.user.locked_ip = merged;
    return next();
  }

  db.prepare(`INSERT INTO ip_change_log (user_id, old_ip, new_ip) VALUES (?, ?, ?)`).run(userId, locked_ip, currentIP);

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({
      error: 'ip_locked',
      message: 'Bu hesap başka bir cihazdan/konumdan kullanılıyor.',
    });
  }

  return res.status(403).sendFile('ip_blocked.html', { root: 'public' });
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

module.exports = { ipLock };
