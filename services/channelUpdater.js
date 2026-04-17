const database = require('../database');

const SOURCE_URL = 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tr.m3u';
const REFRESH_MS = 6 * 60 * 60 * 1000;

const TARGETS = [
  { key: 'TRT 1', names: ['TRT 1'], category: 'ulusal' },
  { key: 'TRT Haber', names: ['TRT Haber'], category: 'haber' },
  { key: 'TRT Türk', names: ['TRT Türk'], category: 'haber' },
  { key: 'TRT Belgesel', names: ['TRT Belgesel'], category: 'belgesel' },
  { key: 'TRT Çocuk', names: ['TRT Çocuk'], category: 'cocuk' },
  { key: 'TV8', names: ['TV 8', 'TV8'], category: 'ulusal' },
  { key: 'Kanal D', names: ['Kanal D'], category: 'ulusal' },
  { key: 'NTV', names: ['NTV'], category: 'haber' },
  { key: 'Habertürk TV', names: ['Habertürk TV', 'Haberturk TV'], category: 'haber' },
  { key: 'TV100', names: ['TV 100', 'TV100'], category: 'haber' },
  { key: 'TGRT Haber', names: ['TGRT Haber'], category: 'haber' },
  { key: 'Tele 1', names: ['Tele 1'], category: 'haber' },
];

function parseM3U(content) {
  const lines = String(content || '').split('\n');
  const out = [];
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
    out.push({ name: currentName || 'Unknown', url: line });
    currentName = '';
  }
  return out;
}

async function refreshPublicChannels() {
  const db = database.db;
  const membershipSeedId = db.prepare('SELECT id FROM memberships ORDER BY id ASC LIMIT 1').get()?.id || 1;

  const res = await fetch(SOURCE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Kaynak alınamadı: ${res.status}`);
  const text = await res.text();
  const entries = parseM3U(text);

  TARGETS.forEach((target, idx) => {
    const found = entries.find((e) => target.names.some((n) => e.name.toLowerCase() === n.toLowerCase()));
    if (!found) return;

    const existing = db.prepare(`
      SELECT id FROM channels
      WHERE is_public = 1 AND name = ? AND url = ?
    `).get(target.key, found.url);
    if (existing) return;

    db.prepare(`
      INSERT INTO channels (membership_id, name, url, category, sort_order, is_public, is_active)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run(membershipSeedId, target.key, found.url, target.category, idx + 1);
  });
}

function startChannelUpdater() {
  const run = async () => {
    try {
      await refreshPublicChannels();
      console.log('[ChannelUpdater] Public channels refreshed');
    } catch (err) {
      console.warn('[ChannelUpdater] refresh failed:', err.message);
    }
  };

  run();
  setInterval(run, REFRESH_MS);
}

module.exports = { startChannelUpdater, refreshPublicChannels };
