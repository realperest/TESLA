const database = require('../database');
const path = require('path');

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

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function ipLock(req, res, next) {
  if (!req.user) return next();

  const db = database.db;
  const currentIP = getIP(req);
  const { id: userId, locked_ip } = req.user;
  const allowed = parseAllowedIps(locked_ip);

  // İlk giriş: IP'yi kaydet
  if (allowed.length === 0) {
    db.prepare(`UPDATE users SET locked_ip = ?, ip_locked_at = datetime('now') WHERE id = ?`).run(currentIP, userId);
    req.user.locked_ip = currentIP;
    return next();
  }

  // IP zaten izinliyse geç
  if (allowed.includes(currentIP)) {
    return next();
  }

  // IP limiti dolmadıysa yeni IP'yi ekle
  if (allowed.length < MAX_ALLOWED_IPS) {
    const merged = formatAllowedIps([...allowed, currentIP]);
    db.prepare(`UPDATE users SET locked_ip = ? WHERE id = ?`).run(merged, userId);
    req.user.locked_ip = merged;
    return next();
  }

  // IP kilitli
  console.warn(`[ipLock] IP mismatch for user ${req.user.email}: current=${currentIP}, allowed=${locked_ip}`);
  
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({
      error: 'ip_locked',
      message: 'Bu hesap başka bir cihazdan/konumdan kullanılıyor.',
    });
  }

  return res.status(403).sendFile(path.join(__dirname, '..', 'public', 'ip_blocked.html'));
}

module.exports = { ipLock };
