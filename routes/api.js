const express = require('express');
const database = require('../database');
const { authenticate } = require('../middleware/authenticate');
const { ipLock } = require('../middleware/ipLock');
const iptvService = require('../services/iptvService');

const router = express.Router();

router.use(authenticate, ipLock);

/**
 * Maps Embed API anahtarı (sunucu ortamından).
 * Tarayıcıda iframe src içinde kullanılacak; Google Cloud’da HTTP referrer kısıtı şart.
 */
router.get('/maps/embed-config', (req, res) => {
  const key = String(process.env.GOOGLE_MAPS_EMBED_API_KEY || '').trim();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ key });
});

const IPTV_SOURCE_LISTS = [
  { key: 'iptv-org', url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tr.m3u' },
  { key: 'free-tv', url: 'https://raw.githubusercontent.com/free-tv/iptv/master/playlists/playlist_turkey.m3u8' },
];

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\sğüşıöç]/gi, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.length >= 3)
    .filter((s) => ![
      've', 'ile', 'için', 'this', 'that', 'the', 'bir', 'çok', 'daha', 'how', 'what',
      'video', 'official', 'hd', '4k', 'new', 'live', 'music', 'song'
    ].includes(s))
    .slice(0, 8);
}

function parseM3UEntries(content) {
  const lines = String(content || '').split('\n');
  const entries = [];
  let currentName = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const idx = line.lastIndexOf(',');
      currentName = idx >= 0 ? line.substring(idx + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(line)) continue;
    entries.push({ name: currentName || 'Unknown', url: line });
    currentName = '';
  }
  return entries;
}

async function fetchPlaylistEntries(source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const upstream = await fetch(source.url, { cache: 'no-store', signal: ctrl.signal });
    if (!upstream.ok) throw new Error(`Kaynak alınamadı (${upstream.status})`);
    const text = await upstream.text();
    const entries = parseM3UEntries(text).map((e) => ({ ...e, source: source.key }));
    return entries;
  } finally {
    clearTimeout(timer);
  }
}

async function probeStream(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('video') || url.includes('.m3u8')) {
      return { ok: true, reason: 'ok' };
    }
    return { ok: true, reason: 'ok' };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeChannelName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(hd|sd|fhd|uhd|4k)\b/g, ' ')
    .replace(/[^a-z0-9ğüşiöçı\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHANNEL_ALIASES = {
  'trt 1': ['trt 1', 'trt1'],
  'trt haber': ['trt haber', 'trthaber'],
  'trt türk': ['trt türk', 'trt turk', 'trtturk'],
  'trt belgesel': ['trt belgesel', 'trtbelgesel'],
  'trt çocuk': ['trt çocuk', 'trt cocuk', 'trtcocuk'],
  'tv8': ['tv8', 'tv 8'],
  'kanal d': ['kanal d', 'kanald'],
  'ntv': ['ntv'],
  'habertürk tv': ['habertürk tv', 'haberturk tv', 'habertürk', 'haberturk'],
  'tv100': ['tv100', 'tv 100'],
  'tgrt haber': ['tgrt haber', 'tgrthaber'],
  'tele 1': ['tele 1', 'tele1'],
};

// ──────────────────────────────────────────────
// Kullanıcı & Membership
// ──────────────────────────────────────────────

router.get('/me', (req, res) => {
  const db = database.db;
  const membership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.user.membership_id);
  const users = db.prepare(
    'SELECT id, email, name, avatar, role, preferred_language, locked_ip, is_active, created_at FROM users WHERE membership_id = ?'
  ).all(req.user.membership_id);
  res.json({ user: req.user, membership, users });
});

router.post('/user/language', (req, res) => {
  const allowed = new Set(['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ar']);
  const language = String(req.body?.language || '').trim().toLowerCase();
  if (!allowed.has(language)) {
    return res.status(400).json({ error: 'Geçersiz dil kodu.' });
  }

  const db = database.db;
  db.prepare('UPDATE users SET preferred_language = ? WHERE id = ?')
    .run(language, req.user.id);

  res.json({ success: true, language });
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

router.post('/membership/interests', (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi güncelleyebilir.' });
  }

  const raw = String(req.body?.interestTags || '').trim();
  const tags = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  const normalized = tags.join(', ');
  const db = database.db;
  db.prepare('UPDATE memberships SET interest_tags = ? WHERE id = ?')
    .run(normalized, req.user.membership_id);

  res.json({ success: true, interestTags: normalized });
});

router.post('/profile/search', (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.json({ success: true });

  const db = database.db;
  db.prepare('INSERT INTO user_search_history (user_id, query) VALUES (?, ?)')
    .run(req.user.id, query.slice(0, 180));

  const kws = extractKeywords(query);
  kws.forEach((kw) => {
    db.prepare(`
      INSERT INTO user_interest_keywords (user_id, keyword, weight, updated_at)
      VALUES (?, ?, 2, datetime('now'))
      ON CONFLICT(user_id, keyword)
      DO UPDATE SET
        weight = MIN(user_interest_keywords.weight + 2, 100),
        updated_at = datetime('now')
    `).run(req.user.id, kw);
  });

  db.prepare(`
    DELETE FROM user_search_history
    WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM user_search_history
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      )
  `).run(req.user.id, req.user.id);

  res.json({ success: true });
});

router.post('/profile/watch', (req, res) => {
  const videoId = String(req.body?.videoId || '').trim();
  const title = String(req.body?.title || '').trim();
  const channel = String(req.body?.channel || '').trim();
  if (!videoId) return res.json({ success: true });

  const db = database.db;
  db.prepare('INSERT INTO user_watch_history (user_id, video_id, title, channel) VALUES (?, ?, ?, ?)')
    .run(req.user.id, videoId.slice(0, 80), title.slice(0, 500), channel.slice(0, 250));

  const kws = [...extractKeywords(title), ...extractKeywords(channel)];
  [...new Set(kws)].forEach((kw) => {
    db.prepare(`
      INSERT INTO user_interest_keywords (user_id, keyword, weight, updated_at)
      VALUES (?, ?, 3, datetime('now'))
      ON CONFLICT(user_id, keyword)
      DO UPDATE SET
        weight = MIN(user_interest_keywords.weight + 3, 100),
        updated_at = datetime('now')
    `).run(req.user.id, kw);
  });

  db.prepare(`
    DELETE FROM user_watch_history
    WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM user_watch_history
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 300
      )
  `).run(req.user.id, req.user.id);

  res.json({ success: true });
});

router.get('/profile/interests', (req, res) => {
  const db = database.db;
  const membership = db.prepare('SELECT interest_tags FROM memberships WHERE id = ?').get(req.user.membership_id);
  const tags = String(membership?.interest_tags || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const keywordRows = db.prepare(`
    SELECT keyword, weight
    FROM user_interest_keywords
    WHERE user_id = ?
    ORDER BY weight DESC, updated_at DESC
    LIMIT 40
  `).all(req.user.id);

  const recentSearch = db.prepare(`
    SELECT query
    FROM user_search_history
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `).all(req.user.id);

  const searchKeywords = recentSearch
    .flatMap((r) => extractKeywords(r.query))
    .slice(0, 30);

  const merged = [...new Set([
    ...tags,
    ...keywordRows.map((r) => String(r.keyword || '').trim().toLowerCase()),
    ...searchKeywords,
  ])].slice(0, 20);

  res.json({
    language: req.user.preferred_language || 'tr',
    terms: merged,
  });
});

// ──────────────────────────────────────────────
// Kanallar
// ──────────────────────────────────────────────

router.get('/channels', (req, res) => {
  const db = database.db;
  const channels = db.prepare(`
    SELECT
      c.id,
      c.membership_id,
      c.name,
      COALESCE(NULLIF(ucs.custom_url, ''), c.url) AS url,
      c.url AS default_url,
      c.category,
      c.logo,
      c.sort_order,
      c.is_public,
      c.is_active,
      c.created_at,
      COALESCE(ucs.enabled, 1) AS user_enabled
    FROM channels c
    LEFT JOIN user_channel_settings ucs
      ON ucs.channel_id = c.id AND ucs.user_id = ?
    WHERE (c.membership_id = ? OR c.is_public = 1)
      AND c.is_active = 1
      AND COALESCE(ucs.enabled, 1) = 1
    ORDER BY category, sort_order, name
  `).all(req.user.id, req.user.membership_id);
  res.json(channels);
});

router.get('/user-tv-settings', (req, res) => {
  const db = database.db;
  const channels = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.category,
      c.url AS default_url,
      c.logo,
      c.is_public,
      COALESCE(ucs.enabled, 1) AS enabled,
      COALESCE(ucs.custom_url, '') AS custom_url
    FROM channels c
    LEFT JOIN user_channel_settings ucs
      ON ucs.channel_id = c.id AND ucs.user_id = ?
    WHERE (c.membership_id = ? OR c.is_public = 1)
      AND c.is_active = 1
    ORDER BY c.category, c.sort_order, c.name
  `).all(req.user.id, req.user.membership_id);

  res.json(channels);
});

router.post('/user-tv-settings/:channelId', (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return res.status(400).json({ error: 'Geçersiz kanal.' });
  }

  const enabled = req.body?.enabled === false ? 0 : 1;
  const customUrl = String(req.body?.customUrl || '').trim();
  if (customUrl && !/^https?:\/\//i.test(customUrl)) {
    return res.status(400).json({ error: 'Özel bağlantı http/https ile başlamalı.' });
  }

  const db = database.db;
  const channel = db.prepare(`
    SELECT id
    FROM channels
    WHERE id = ? AND (membership_id = ? OR is_public = 1) AND is_active = 1
  `).get(channelId, req.user.membership_id);

  if (!channel) return res.status(404).json({ error: 'Kanal bulunamadı.' });

  db.prepare(`
    INSERT INTO user_channel_settings (user_id, channel_id, enabled, custom_url, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, channel_id)
    DO UPDATE SET
      enabled = excluded.enabled,
      custom_url = excluded.custom_url,
      updated_at = datetime('now')
  `).run(req.user.id, channelId, enabled, customUrl);

  res.json({ success: true });
});

router.get('/channel-sources/:channelId', async (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return res.status(400).json({ error: 'Geçersiz kanal.' });
  }

  const db = database.db;
  const channel = db.prepare(`
    SELECT id, name, category, url
    FROM channels
    WHERE id = ? AND (membership_id = ? OR is_public = 1) AND is_active = 1
  `).get(channelId, req.user.membership_id);

  if (!channel) return res.status(404).json({ error: 'Kanal bulunamadı.' });

  try {
    const settled = await Promise.allSettled(IPTV_SOURCE_LISTS.map((s) => fetchPlaylistEntries(s)));
    const all = settled
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value);
    if (!all.length) {
      return res.status(502).json({ error: 'Kaynak listeleri alınamadı.' });
    }
    const needle = normalizeChannelName(channel.name);
    const aliases = CHANNEL_ALIASES[needle] || [needle];

    let matches = all.filter((e) => {
      const n = normalizeChannelName(e.name);
      if (!n) return false;
      return aliases.some((a) => n === a || n.includes(a));
    });

    // Hiç bulunamazsa son çare daha gevşek eşleşme
    if (!matches.length) {
      matches = all.filter((e) => {
        const n = normalizeChannelName(e.name);
        return n && (n.includes(needle) || needle.includes(n));
      });
    }

    const unique = [];
    const seen = new Set();
    [{ url: channel.url, source: 'db-current' }, ...matches].forEach((entry) => {
      const key = String(entry.url || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push({ url: key, source: entry.source || 'unknown' });
    });

    const limited = unique.slice(0, 24);
    const probes = await Promise.all(limited.map((s) => probeStream(s.url)));
    const sources = limited.map((s, idx) => ({
      url: s.url,
      source: s.source,
      healthy: probes[idx].ok,
      reason: probes[idx].reason,
    }));
    sources.sort((a, b) => Number(b.healthy) - Number(a.healthy));

    res.json({
      channel: { id: channel.id, name: channel.name },
      sources,
    });
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? 'Kaynak araştırması zaman aşımına uğradı.'
      : ('Kaynaklar araştırılamadı: ' + err.message);
    res.status(502).json({ error: msg });
  }
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

// ──────────────────────────────────────────────
// IPTV (M3U DB, Xtream, EPG XMLTV)
// ──────────────────────────────────────────────

router.get('/iptv/settings', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const db = database.db;
  const row = iptvService.getIptvSettingsRow(db, req.user.membership_id);
  const m3uText = row?.m3u_content ? String(row.m3u_content) : '';
  const isOwner = String(req.user.role || '').toLowerCase() === 'owner';
  const xtream = {
    baseUrl: row?.xtream_base_url || '',
    username: row?.xtream_username || '',
    passwordSet: !!(row?.xtream_password),
  };
  if (isOwner) {
    xtream.password = row != null && row.xtream_password != null ? String(row.xtream_password) : '';
  }

  const out = {
    m3u: {
      hasFile: m3uText.length > 0,
      updatedAt: row?.m3u_updated_at || null,
      sizeBytes: Buffer.byteLength(m3uText, 'utf8'),
    },
    xtream,
    epg: {
      url: row?.epg_xmltv_url || '',
      hasContent: !!(row?.epg_xmltv_content && String(row.epg_xmltv_content).trim()),
      updatedAt: row?.epg_updated_at || null,
    },
  };
  res.json(out);
});

router.post('/iptv/settings', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi IPTV ayarlarını değiştirebilir.' });
  }

  const body = req.body || {};
  const xtreamBaseUrl = String(body.xtreamBaseUrl ?? '').trim();
  const xtreamUsername = String(body.xtreamUsername ?? '').trim();
  const epgXmltvUrl = String(body.epgXmltvUrl ?? '').trim();

  const db = database.db;
  const row = iptvService.ensureIptvRow(db, req.user.membership_id);

  let xtreamPassword = row?.xtream_password || '';
  if (Object.prototype.hasOwnProperty.call(body, 'xtreamPassword')) {
    xtreamPassword = String(body.xtreamPassword ?? '');
  }

  db.prepare(`
    UPDATE membership_iptv_settings SET
      xtream_base_url = ?,
      xtream_username = ?,
      xtream_password = ?,
      epg_xmltv_url = ?,
      epg_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE membership_id = ?
  `).run(
    xtreamBaseUrl || null,
    xtreamUsername || null,
    xtreamPassword || null,
    epgXmltvUrl || null,
    req.user.membership_id
  );

  let xtreamTest = null;
  try {
    if (xtreamBaseUrl && xtreamUsername && xtreamPassword) {
      xtreamTest = await iptvService.testXtreamConnection(xtreamBaseUrl, xtreamUsername, xtreamPassword);
    } else if (xtreamBaseUrl || xtreamUsername) {
      xtreamTest = {
        skipped: true,
        message: 'Xtream doğrulaması için sunucu, kullanıcı adı ve şifre birlikte gerekir. Şifre daha önce kaydedildiyse tekrar yazın veya alanı doldurun.',
      };
    }
  } catch (e) {
    console.error('[IPTV] Xtream test:', e.message);
    xtreamTest = { ok: false, message: 'Kayıt yapıldı ancak bağlantı testi sırasında hata oluştu.' };
  }

  res.json({ success: true, xtreamTest });
});

router.post('/iptv/m3u-url', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi M3U yükleyebilir.' });
  }
  const url = String(req.body.url || '').trim();
  if (!url) {
    return res.status(400).json({ error: 'M3U adresi boş olamaz.' });
  }
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!upstream.ok) {
      return res.status(400).json({ error: `Liste alınamadı (HTTP ${upstream.status}).` });
    }
    const text = await upstream.text();
    if (!text.trim()) {
      return res.status(400).json({ error: 'Liste içeriği boş.' });
    }
    const db = database.db;
    iptvService.ensureIptvRow(db, req.user.membership_id);
    db.prepare(`
      UPDATE membership_iptv_settings SET
        m3u_content = ?,
        m3u_updated_at = datetime('now'),
        updated_at = datetime('now')
      WHERE membership_id = ?
    `).run(text, req.user.membership_id);

    res.json({ success: true, sizeBytes: Buffer.byteLength(text, 'utf8') });
  } catch (err) {
    console.error('[IPTV] M3U URL fetch:', err.message);
    res.status(502).json({ error: 'M3U adresine erişilemedi: ' + err.message });
  }
});

router.post('/iptv/m3u', express.text({ limit: '15mb' }), (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi M3U yükleyebilir.' });
  }
  const text = String(req.body || '');
  if (!text.trim()) {
    return res.status(400).json({ error: 'Dosya içeriği boş.' });
  }
  const db = database.db;
  iptvService.ensureIptvRow(db, req.user.membership_id);
  db.prepare(`
    UPDATE membership_iptv_settings SET
      m3u_content = ?,
      m3u_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE membership_id = ?
  `).run(text, req.user.membership_id);

  res.json({ success: true, sizeBytes: Buffer.byteLength(text, 'utf8') });
});

router.delete('/iptv/m3u', (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi kaldırabilir.' });
  }
  const db = database.db;
  iptvService.ensureIptvRow(db, req.user.membership_id);
  db.prepare(`
    UPDATE membership_iptv_settings SET
      m3u_content = NULL,
      m3u_updated_at = NULL,
      updated_at = datetime('now')
    WHERE membership_id = ?
  `).run(req.user.membership_id);
  res.json({ success: true });
});

router.post('/iptv/epg-content', express.text({ limit: '15mb' }), (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi yükleyebilir.' });
  }
  const text = String(req.body || '');
  if (!text.trim()) {
    return res.status(400).json({ error: 'EPG içeriği boş.' });
  }
  const db = database.db;
  iptvService.ensureIptvRow(db, req.user.membership_id);
  db.prepare(`
    UPDATE membership_iptv_settings SET
      epg_xmltv_content = ?,
      epg_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE membership_id = ?
  `).run(text, req.user.membership_id);

  res.json({ success: true, sizeBytes: Buffer.byteLength(text, 'utf8') });
});

router.delete('/iptv/epg-content', (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Sadece paket sahibi kaldırabilir.' });
  }
  const db = database.db;
  iptvService.ensureIptvRow(db, req.user.membership_id);
  db.prepare(`
    UPDATE membership_iptv_settings SET
      epg_xmltv_content = NULL,
      epg_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE membership_id = ?
  `).run(req.user.membership_id);
  res.json({ success: true });
});

router.get('/iptv/channels', async (req, res) => {
  const db = database.db;
  const row = iptvService.getIptvSettingsRow(db, req.user.membership_id);
  if (!row) {
    return res.json([]);
  }
  try {
    const list = await iptvService.buildMergedChannelList(row);
    res.json(list);
  } catch (e) {
    console.error('[IPTV] Kanal listesi:', e.message);
    res.status(502).json({ error: 'Kanal listesi oluşturulamadı.' });
  }
});

router.get('/iptv/epg', async (req, res) => {
  const channelId = String(req.query.channelId || '').trim();
  if (!channelId) {
    return res.status(400).json({ error: 'channelId gerekli.' });
  }
  const db = database.db;
  const row = iptvService.getIptvSettingsRow(db, req.user.membership_id);
  if (!row) {
    return res.json({ programmes: [] });
  }
  const hasEpg = (row.epg_xmltv_url && String(row.epg_xmltv_url).trim()) ||
    (row.epg_xmltv_content && String(row.epg_xmltv_content).trim());
  if (!hasEpg) {
    return res.json({ programmes: [] });
  }
  try {
    const data = await iptvService.getProgrammesForChannel(req.user.membership_id, row, channelId);
    res.json(data);
  } catch (e) {
    console.error('[IPTV] EPG:', e.message);
    res.status(502).json({ error: 'EPG verisi alınamadı.' });
  }
});

module.exports = router;
