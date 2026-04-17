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
  `);

  // Örnek veri (ilk kurulumda)
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM memberships').get().cnt;
  if (cnt === 0) {
    sqlDb.run(`INSERT INTO memberships (name, plan, max_users) VALUES ('DEMO', 'pro', 10)`);

    sqlDb.run(`INSERT INTO channels (membership_id, name, url, category, is_public)
               VALUES (1, 'TRT 1 HD', 'https://trtyayin-lh.akamaihd.net/i/trtyayin_1@181520/master.m3u8', 'haber', 1)`);
    sqlDb.run(`INSERT INTO channels (membership_id, name, url, category, is_public)
               VALUES (1, 'TRT Haber', 'https://trthaber-lh.akamaihd.net/i/trthaber_1@181519/master.m3u8', 'haber', 1)`);
  }

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
