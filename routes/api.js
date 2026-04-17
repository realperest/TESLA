const express = require('express');
const database = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { ipLock } = require('../middleware/ipLock');

const router = express.Router();

router.use(authenticate, ipLock);

// ──────────────────────────────────────────────
// Kullanıcı & Membership
// ──────────────────────────────────────────────

router.get('/me', (req, res) => {
  const db = database.db;
  const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.user.membership_id);
  const users = db.prepare(
    'SELECT id, email, name, avatar, role, is_active, created_at FROM users WHERE membership_id = ?'
  ).all(req.user.membership_id);
  res.json({ user: req.user, membership, users });
});

router.post('/invite', (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi davet gönderebilir.' });
  }

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email gerekli.' });

  const db = database.db;
  const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.user.membership_id);
  const currentCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM users WHERE membership_id = ?'
  ).get(req.user.membership_id).cnt;

  if (currentCount >= membership.max_users) {
    return res.status(400).json({ error: `Paketiniz en fazla ${membership.max_users} kullanıcıya izin veriyor.` });
  }

  const existing = db.prepare(
    'SELECT * FROM invites WHERE email = ? AND membership_id = ?'
  ).get(email, req.user.membership_id);

  if (!existing) {
    db.prepare(
      'INSERT INTO invites (membership_id, email, invited_by) VALUES (?, ?, ?)'
    ).run(req.user.membership_id, email, req.user.id);
  }

  res.json({ success: true, message: `${email} davet edildi.` });
});

router.post('/reset-ip/:userId', (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi IP sıfırlayabilir.' });
  }

  const db = database.db;
  const targetUser = db.prepare(
    'SELECT * FROM users WHERE id = ? AND membership_id = ?'
  ).get(req.params.userId, req.user.membership_id);

  if (!targetUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  db.prepare('UPDATE users SET locked_ip = NULL, ip_locked_at = NULL WHERE id = ?').run(targetUser.id);
  db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(targetUser.id);

  res.json({ success: true, message: 'IP kilidi sıfırlandı.' });
});

// ──────────────────────────────────────────────
// Kanallar
// ──────────────────────────────────────────────

router.get('/channels', (req, res) => {
  const db = database.db;
  const channels = db.prepare(`
    SELECT * FROM channels
    WHERE (membership_id = ? OR is_public = 1) AND is_active = 1
    ORDER BY category, sort_order, name
  `).all(req.user.membership_id);
  res.json(channels);
});

router.post('/channels', (req, res) => {
  const { name, url, category, logo } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name ve url zorunludur.' });

  const db = database.db;
  const result = db.prepare(`
    INSERT INTO channels (membership_id, name, url, category, logo) VALUES (?, ?, ?, ?, ?)
  `).run(req.user.membership_id, name, url, category || 'genel', logo || null);

  res.json({ id: result.lastInsertRowid, success: true });
});

router.delete('/channels/:id', (req, res) => {
  const db = database.db;
  const channel = db.prepare(
    'SELECT * FROM channels WHERE id = ? AND membership_id = ?'
  ).get(req.params.id, req.user.membership_id);

  if (!channel) return res.status(404).json({ error: 'Kanal bulunamadı.' });

  db.prepare('UPDATE channels SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
