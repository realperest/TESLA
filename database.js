/**
 * SQLite veritabanı — sql.js kullanır (native derleme gerektirmez)
 *
 * better-sqlite3 API'sine benzer bir wrapper sağlar:
 *   db.prepare(sql).get(params)
 *   db.prepare(sql).all(params)
 *   db.prepare(sql).run(params)  → { lastInsertRowid }
 *   db.exec(sql)
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'tesla_tv.db');

// ── Wrapper sınıfları (better-sqlite3 uyumlu sync API) ──────────────────────

class Statement {
  constructor(sqlDb, sql, _save) {
    this._sqlDb = sqlDb;
    this._sql = sql;
    this._save = _save;
  }

  /** Tek satır döner (undefined yoksa) */
  get(...args) {
    const params = _normalize(args);
    const stmt = this._sqlDb.prepare(this._sql);
    try {
      stmt.bind(params);
      if (stmt.step()) return _convertRow(stmt.getAsObject());
      return undefined;
    } finally {
      stmt.free();
    }
  }

  /** Tüm satırları dizi olarak döner */
  all(...args) {
    const params = _normalize(args);
    const stmt = this._sqlDb.prepare(this._sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(_convertRow(stmt.getAsObject()));
    } finally {
      stmt.free();
    }
    return rows;
  }

  /** INSERT/UPDATE/DELETE çalıştırır, { lastInsertRowid, changes } döner */
  run(...args) {
    const params = _normalize(args);
    this._sqlDb.run(this._sql, params);
    const lastInsertRowid = this._sqlDb.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
    this._save();
    return { lastInsertRowid };
  }
}

class DB {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._save = this._save.bind(this);
  }

  prepare(sql) {
    return new Statement(this._db, sql, this._save);
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
    return this;
  }

  pragma(sql) {
    this._db.run(`PRAGMA ${sql}`);
    return this;
  }

  _save() {
    const data = this._db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

/** [params] veya (...params) çağrısını normalize et */
function _normalize(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && (Array.isArray(args[0]) || (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])))) {
    return args[0];
  }
  return args;
}

/** sql.js'in döndürdüğü değerleri temizle */
function _convertRow(obj) {
  if (!obj) return obj;
  // sql.js bazen null yerine undefined döner
  const out = {};
  for (const k in obj) {
    out[k] = obj[k] === undefined ? null : obj[k];
  }
  return out;
}

// ── Dışa aktarılan singleton ─────────────────────────────────────────────────

let db; // initDB çağrıldıktan sonra kullanılabilir

async function initDB() {
  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buf);
  } else {
    sqlDb = new SQL.Database();
  }

  db = new DB(sqlDb);

  // WAL modu sql.js'de çalışmaz (in-memory), foreign keys aktif edelim
  sqlDb.run('PRAGMA foreign_keys = ON');

  // ── Şema ──────────────────────────────────────────────────────────────────
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS memberships (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      plan        TEXT    NOT NULL DEFAULT 'basic',
      status      TEXT    NOT NULL DEFAULT 'active',
      max_users   INTEGER NOT NULL DEFAULT 5,
      created_at  DATETIME DEFAULT (datetime('now')),
      expires_at  DATETIME
    );

    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_id   INTEGER NOT NULL REFERENCES memberships(id),
      google_id       TEXT    UNIQUE NOT NULL,
      email           TEXT    UNIQUE NOT NULL,
      name            TEXT,
      avatar          TEXT,
      role            TEXT    NOT NULL DEFAULT 'member',
      preferred_language TEXT NOT NULL DEFAULT 'tr',
      locked_ip       TEXT,
      ip_locked_at    DATETIME,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      token       TEXT    UNIQUE NOT NULL,
      ip_address  TEXT    NOT NULL,
      user_agent  TEXT,
      created_at  DATETIME DEFAULT (datetime('now')),
      last_seen   DATETIME DEFAULT (datetime('now')),
      expires_at  DATETIME NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS channels (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_id INTEGER REFERENCES memberships(id),
      name          TEXT    NOT NULL,
      url           TEXT    NOT NULL,
      category      TEXT    DEFAULT 'genel',
      logo          TEXT,
      sort_order    INTEGER DEFAULT 0,
      is_public     INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ip_change_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      old_ip      TEXT,
      new_ip      TEXT,
      attempted_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_id INTEGER NOT NULL,
      email         TEXT    NOT NULL,
      invited_by    INTEGER NOT NULL,
      used          INTEGER NOT NULL DEFAULT 0,
      created_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_search_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      query       TEXT    NOT NULL,
      created_at  DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_watch_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      video_id    TEXT    NOT NULL,
      title       TEXT,
      channel     TEXT,
      created_at  DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_interest_keywords (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      keyword     TEXT    NOT NULL,
      weight      INTEGER NOT NULL DEFAULT 1,
      updated_at  DATETIME DEFAULT (datetime('now')),
      UNIQUE(user_id, keyword)
    );

    CREATE TABLE IF NOT EXISTS user_channel_settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      channel_id  INTEGER NOT NULL REFERENCES channels(id),
      enabled     INTEGER NOT NULL DEFAULT 1,
      custom_url  TEXT,
      updated_at  DATETIME DEFAULT (datetime('now')),
      UNIQUE(user_id, channel_id)
    );
  `);

  // Şema güncelleme: memberships.interest_tags (virgülle ayrılmış etiketler)
  const membershipCols = sqlDb.exec(`PRAGMA table_info(memberships)`);
  const hasInterestTags =
    Array.isArray(membershipCols) &&
    membershipCols[0] &&
    Array.isArray(membershipCols[0].values) &&
    membershipCols[0].values.some((row) => row[1] === 'interest_tags');

  if (!hasInterestTags) {
    sqlDb.run(`ALTER TABLE memberships ADD COLUMN interest_tags TEXT DEFAULT ''`);
  }

  const userCols = sqlDb.exec(`PRAGMA table_info(users)`);
  const hasPreferredLanguage =
    Array.isArray(userCols) &&
    userCols[0] &&
    Array.isArray(userCols[0].values) &&
    userCols[0].values.some((row) => row[1] === 'preferred_language');

  if (!hasPreferredLanguage) {
    sqlDb.run(`ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'tr'`);
  }

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS membership_iptv_settings (
      membership_id       INTEGER PRIMARY KEY REFERENCES memberships(id),
      m3u_content         TEXT,
      m3u_updated_at      DATETIME,
      xtream_base_url     TEXT,
      xtream_username     TEXT,
      xtream_password     TEXT,
      epg_xmltv_url       TEXT,
      epg_xmltv_content   TEXT,
      epg_updated_at      DATETIME,
      updated_at          DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Kamuya açık Türkiye canlı TV listesi (kaynak: iptv-org/iptv streams/tr.m3u)
  const defaultPublicChannels = [
    { name: 'TRT 1', url: 'https://tv-trt1.medya.trt.com.tr/master.m3u8', category: 'ulusal' },
    { name: 'TRT 2', url: 'https://tv-trt2.medya.trt.com.tr/master.m3u8', category: 'ulusal' },
    { name: 'TRT Haber', url: 'https://tv-trthaber.medya.trt.com.tr/master.m3u8', category: 'haber' },
    { name: 'TRT Türk', url: 'https://tv-trtturk.medya.trt.com.tr/master.m3u8', category: 'haber' },
    { name: 'TRT Belgesel', url: 'https://tv-trtbelgesel.medya.trt.com.tr/master.m3u8', category: 'belgesel' },
    { name: 'TRT Çocuk', url: 'https://tv-trtcocuk.medya.trt.com.tr/master.m3u8', category: 'cocuk' },
    { name: 'TRT Müzik', url: 'https://tv-trtmuzik.medya.trt.com.tr/master.m3u8', category: 'muzik' },
    { name: 'TRT Avaz', url: 'https://tv-trtavaz.medya.trt.com.tr/master.m3u8', category: 'ulusal' },
    { name: 'TRT Kurdi', url: 'https://tv-trtkurdi.medya.trt.com.tr/master.m3u8', category: 'ulusal' },
    { name: 'TRT World', url: 'https://tv-trtworld.medya.trt.com.tr/master.m3u8', category: 'haber' },
    { name: 'TRT Arabi', url: 'https://tv-trtarabi.medya.trt.com.tr/master.m3u8', category: 'haber' },
    { name: 'TV8', url: 'https://tv8-live.daioncdn.net/tv8/tv8.m3u8', category: 'ulusal' },
    { name: 'TV8 (Alternatif)', url: 'https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3', category: 'ulusal' },
    { name: 'Kanal D', url: 'https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3', category: 'ulusal' },
    { name: 'Teve2', url: 'https://demiroren-live.daioncdn.net/teve2/teve2.m3u8', category: 'ulusal' },
    { name: 'NTV', url: 'https://dogus-live.daioncdn.net/ntv/ntv.m3u8', category: 'haber' },
    { name: 'Kral Pop TV', url: 'https://dogus-live.daioncdn.net/kralpoptv/playlist.m3u8', category: 'muzik' },
    { name: 'Habertürk TV', url: 'https://ciner-live.daioncdn.net/haberturktv/haberturktv.m3u8', category: 'haber' },
    { name: 'Bloomberg HT', url: 'https://ciner-live.daioncdn.net/bloomberght/bloomberght.m3u8', category: 'haber' },
    { name: 'Halk TV', url: 'https://halktv-live.daioncdn.net/halktv/halktv.m3u8', category: 'haber' },
    { name: 'TV100', url: 'https://tv100-live.daioncdn.net/tv100/tv100.m3u8', category: 'haber' },
    { name: 'TGRT Haber', url: 'https://canli.tgrthaber.com/tgrt.m3u8', category: 'haber' },
    { name: 'Tele 1', url: 'https://tele1-live.ercdn.net/tele1/tele1.m3u8', category: 'haber' },
    { name: 'TVNET', url: 'https://mn-nl.mncdn.com/tvnet/tvnet/playlist.m3u8', category: 'haber' },
    { name: 'TV24', url: 'https://turkmedya-live.ercdn.net/tv24/tv24.m3u8', category: 'haber' },
    { name: 'TV4', url: 'https://turkmedya-live.ercdn.net/tv4/tv4.m3u8', category: 'ulusal' },
    { name: 'Akit TV', url: 'https://akittv-live.ercdn.net/akittv/akittv.m3u8', category: 'haber' },
    { name: 'A Spor TV', url: 'https://tv.ensonhaber.com/aspor/aspor.m3u8', category: 'spor' },
    { name: 'TRT Spor', url: 'https://tv-trtspor1.medya.trt.com.tr/master.m3u8', category: 'spor' },
    { name: 'TRT Spor 2', url: 'https://tv-trtspor2.medya.trt.com.tr/master.m3u8', category: 'spor' },
    { name: 'HT Spor', url: 'https://ciner.daioncdn.net/ht-spor/ht-spor.m3u8?app=web', category: 'spor' },
    { name: 'TJK TV', url: 'https://tjktv-live.tjk.org/tjktv.m3u8', category: 'spor' },
    { name: 'TJK TV2', url: 'https://tjktv-live.tjk.org/tjktv2/tjktv2.m3u8', category: 'spor' },
    { name: 'Power TV', url: 'https://livetv.powerapp.com.tr/powerTV/powerhd.smil/playlist.m3u8', category: 'muzik' },
    { name: 'Power Türk', url: 'https://livetv.powerapp.com.tr/powerturkTV/powerturkhd.smil/playlist.m3u8', category: 'muzik' },
    { name: 'Dream Türk', url: 'https://live.duhnet.tv/S2/HLS_LIVE/dreamturknp/playlist.m3u8', category: 'muzik' },
    { name: 'Number 1 TV', url: 'https://mn-nl.mncdn.com/blutv_nr12/live.m3u8', category: 'muzik' },
    { name: 'Number 1 Türk', url: 'https://mn-nl.mncdn.com/blutv_nr1turk2/live.m3u8', category: 'muzik' },
    { name: 'Kanal 7', url: 'https://kanal7-live.daioncdn.net/kanal7/kanal7.m3u8', category: 'ulusal' },
    { name: 'Euro D', url: 'https://live.duhnet.tv/S2/HLS_LIVE/eurodnp/playlist.m3u8', category: 'ulusal' },
    { name: 'Diyanet TV', url: 'https://eustr73.mediatriple.net/videoonlylive/mtikoimxnztxlive/broadcast_5e3bf95a47e07.smil/playlist.m3u8', category: 'ulusal' },
    { name: 'TBMM TV', url: 'https://meclistv-live.ercdn.net/meclistv/meclistv.m3u8', category: 'haber' },
  ];

  // Örnek üyelik (ilk kurulumda)
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM memberships').get().cnt;
  if (cnt === 0) {
    sqlDb.run(`INSERT INTO memberships (name, plan, max_users) VALUES ('DEMO', 'pro', 10)`);
  }

  const membershipSeedId = db.prepare('SELECT id FROM memberships ORDER BY id ASC LIMIT 1').get()?.id || 1;
  defaultPublicChannels.forEach((ch, i) => {
    const exists = db.prepare(
      'SELECT id FROM channels WHERE is_public = 1 AND name = ? AND url = ?'
    ).get(ch.name, ch.url);

    if (!exists) {
      db.prepare(`
        INSERT INTO channels (membership_id, name, url, category, logo, sort_order, is_public, is_active)
        VALUES (?, ?, ?, ?, NULL, ?, 1, 1)
      `).run(membershipSeedId, ch.name, ch.url, ch.category, i + 1);
    }
  });

  db._save();
  console.log('[DB] Veritabanı hazır →', DB_PATH);
}

// db'yi doğrudan export etme — initDB() sonrası kullanılabilir
module.exports = {
  get db() {
    if (!db) throw new Error('initDB() henüz çağrılmadı!');
    return db;
  },
  initDB,
};
