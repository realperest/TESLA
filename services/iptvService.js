/**
 * IPTV: M3U (DB), Xtream Codes API, XMLTV EPG
 */

const fetch = require('node-fetch');

const EPG_CACHE_TTL_MS = 10 * 60 * 1000;

function buildXtreamHeaders(baseUrl) {
  let origin = '';
  try {
    origin = new URL(String(baseUrl || '').trim()).origin;
  } catch (e) {
    origin = '';
  }
  const h = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/javascript, */*;q=0.01',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  };
  if (origin) {
    h.Referer = `${origin}/`;
    h.Origin = origin;
  }
  return h;
}

/** Bazı Xtream panelleri Origin/Referer veya ek başlıklarla 403 döner; sade tut. */
function buildXtreamHeadersMinimal() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/javascript, */*;q=0.01',
  };
}

/**
 * player_api.php isteği: 403/401 ise minimal başlıkla bir kez daha dene.
 */
async function xtreamFetchText(url, signal, baseUrl) {
  const full = { ...buildXtreamHeaders(baseUrl), Accept: 'application/json, text/javascript, */*;q=0.01' };
  let res = await fetch(url, { signal, headers: full });
  let text = await res.text();
  if (res.status === 403 || res.status === 401) {
    const min = buildXtreamHeadersMinimal();
    res = await fetch(url, { signal, headers: min });
    text = await res.text();
  }
  return { res, text };
}
const epgXmlCache = new Map();

function normalizeCategory(c) {
  const s = String(c || '').trim();
  return s || 'IPTV';
}

function parseM3UEntries(content) {
  const lines = String(content || '').split(/\r?\n/);
  const entries = [];
  let currentName = '';
  let currentLogo = '';
  let currentGroup = '';
  let currentTvgId = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const logoM = line.match(/tvg-logo="([^"]*)"/i);
      currentLogo = logoM ? logoM[1] : '';
      const grpM = line.match(/group-title="([^"]*)"/i);
      currentGroup = grpM ? grpM[1] : '';
      const idM = line.match(/tvg-id="([^"]*)"/i);
      currentTvgId = idM ? idM[1] : '';
      const idx = line.lastIndexOf(',');
      currentName = idx >= 0 ? line.substring(idx + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(line)) continue;
    entries.push({
      name: currentName || 'Kanal',
      url: line,
      logo: currentLogo || null,
      category: currentGroup || 'M3U',
      tvg_id: currentTvgId || null,
    });
    currentName = '';
    currentLogo = '';
    currentGroup = '';
    currentTvgId = '';
  }
  return entries;
}

async function fetchXtreamLiveStreams(baseUrl, username, password) {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base || !username || !password) return [];

  let origin;
  try {
    origin = new URL(base).origin;
  } catch (e) {
    throw new Error('Xtream sunucu adresi geçersiz');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const authParams = new URLSearchParams({ username, password });
    const authUrl = `${base}/player_api.php?${authParams.toString()}`;
    const { res: authRes, text: authText } = await xtreamFetchText(authUrl, ctrl.signal, base);
    let authJson;
    try {
      authJson = JSON.parse(authText);
    } catch (e) {
      throw new Error('Xtream kimlik yanıtı okunamadı');
    }
    const ui = authJson.user_info || {};
    if (String(ui.auth || '') === '0') {
      throw new Error('Xtream girişi reddedildi');
    }
    const st = String(ui.status || '').toLowerCase();
    if (st && (st.includes('banned') || st.includes('expired'))) {
      throw new Error('Xtream hesap durumu uygun değil');
    }

    const streamsUrl = `${base}/player_api.php?${authParams.toString()}&action=get_live_streams`;
    const { text: streamsText } = await xtreamFetchText(streamsUrl, ctrl.signal, base);
    let streamsData;
    try {
      streamsData = JSON.parse(streamsText);
    } catch (e) {
      throw new Error('Xtream kanal listesi okunamadı');
    }

    const rows = Array.isArray(streamsData)
      ? streamsData
      : (streamsData.streams || streamsData.data || []);

    if (!Array.isArray(rows)) {
      return [];
    }

    const out = [];
    for (const s of rows) {
      const sid = s.stream_id != null ? s.stream_id : s.id;
      if (sid == null) continue;
      const streamUrl = `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(String(sid))}.ts`;
      out.push({
        name: String(s.name || 'Kanal').trim(),
        url: streamUrl,
        logo: s.stream_icon || null,
        category: normalizeCategory(s.category_name || s.category_id || 'Xtream'),
        stream_id: sid,
        epg_channel_id: s.epg_channel_id != null ? String(s.epg_channel_id) : null,
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kayıt sonrası geri bildirim: kimlik doğrulama + hafif API (kanal sayısı yok, kategori sayısı var).
 */
async function testXtreamConnection(baseUrl, username, password) {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base || !username || !password) {
    return { ok: false, message: 'Sunucu adresi, kullanıcı adı ve şifre gerekli.' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22000);
  try {
    const authParams = new URLSearchParams({ username, password });
    const authUrl = `${base}/player_api.php?${authParams.toString()}`;
    const { res: authRes, text: authText } = await xtreamFetchText(authUrl, ctrl.signal, base);
    let authJson;
    const hint403 =
      'HTTP 403 panel tarafında yasak anlamına gelir (WAF, yanlış yol, http/https). Not: Bu test tarayıcınızdan değil, Node uygulamasının çalıştığı makineden gider; Railway/VPS kullanıyorsanız çıkış IP eviniz değildir. Yerelde (localhost) çalıştırıyorsanız çıkış IP ev ağınızdır.';
    try {
      authJson = JSON.parse(authText);
    } catch (e) {
      const trimmed = String(authText || '').trim();
      const looksHtml = trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype');
      if (!authRes.ok) {
        return {
          ok: false,
          message: `Panel yanıtı: HTTP ${authRes.status}. ${hint403}`,
        };
      }
      if (looksHtml) {
        return {
          ok: false,
          message: `Panel JSON yerine HTML döndü. ${hint403}`,
        };
      }
      return {
        ok: false,
        message: `Panel geçerli JSON döndürmedi. ${hint403}`,
      };
    }

    const ui = authJson.user_info || {};
    if (String(ui.auth || '') === '0') {
      return { ok: false, message: 'Kullanıcı adı veya şifre hatalı.' };
    }
    const st = String(ui.status || '').toLowerCase();
    if (st && (st.includes('banned') || st.includes('expired'))) {
      return { ok: false, message: 'Hesap engelli veya süresi dolmuş görünüyor.' };
    }

    let categoryCount = null;
    try {
      const catUrl = `${base}/player_api.php?${authParams.toString()}&action=get_live_categories`;
      const { text: catText } = await xtreamFetchText(catUrl, ctrl.signal, base);
      const catJson = JSON.parse(catText);
      const cats = Array.isArray(catJson) ? catJson : (catJson.categories || catJson.data || []);
      if (Array.isArray(cats)) categoryCount = cats.length;
    } catch (e) {
      console.warn('[IPTV] Xtream test: kategori listesi okunamadı:', e.message);
    }

    const statusLabel = String(ui.status || 'Active');
    const exp = ui.exp_date || ui.expire_date || '';
    let message = `Bağlantı başarılı. Hesap durumu: ${statusLabel}`;
    if (exp) message += ` · Bitiş: ${exp}`;
    if (categoryCount != null) message += ` · Canlı kategori: ${categoryCount}`;

    return {
      ok: true,
      message,
      categoryCount,
      accountStatus: statusLabel,
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, message: 'Bağlantı zaman aşımı. Sunucu adresini veya erişimi kontrol edin.' };
    }
    return { ok: false, message: e.message || 'Bağlantı kurulamadı.' };
  } finally {
    clearTimeout(timer);
  }
}

function parseXmltvProgrammes(xml) {
  const xmlStr = String(xml || '');
  const list = [];
  const re = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
  let m;
  while ((m = re.exec(xmlStr))) {
    const attrs = m[1];
    const inner = m[2];
    const ch = (attrs.match(/channel="([^"]+)"/i) || [])[1];
    const start = (attrs.match(/start="([^"]+)"/i) || [])[1];
    const stop = (attrs.match(/stop="([^"]+)"/i) || [])[1];
    const titleM = inner.match(/<title[^>]*>([^<]*)</i);
    const title = titleM ? titleM[1].trim() : '';
    if (ch && start && title) {
      list.push({ channelId: ch, start, stop: stop || null, title });
    }
  }
  return list;
}

async function fetchEpgXml(settings) {
  const url = String(settings.epg_xmltv_url || '').trim();
  const cached = String(settings.epg_xmltv_content || '').trim();
  if (cached) return cached;
  if (!url) return '';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/xml,text/xml,*/*' },
    });
    if (!res.ok) {
      throw new Error(`EPG adresi yanıt vermedi (${res.status})`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getProgrammesForChannel(membershipId, settings, channelId) {
  const key = String(channelId || '').trim();
  if (!key) {
    return { programmes: [] };
  }

  const cacheKey = `${membershipId}:${settings.epg_xmltv_url || ''}:${settings.epg_updated_at || ''}:${settings.epg_xmltv_content ? '1' : '0'}`;
  let xml;
  const now = Date.now();
  const hit = epgXmlCache.get(cacheKey);
  if (hit && now - hit.at < EPG_CACHE_TTL_MS) {
    xml = hit.xml;
  } else {
    xml = await fetchEpgXml(settings);
    epgXmlCache.set(cacheKey, { xml, at: now });
  }

  if (!xml) {
    return { programmes: [] };
  }

  const all = parseXmltvProgrammes(xml);
  const filtered = all.filter((p) => p.channelId === key).slice(0, 200);
  return { programmes: filtered };
}

async function buildMergedChannelList(settings) {
  const merged = [];
  let m3uIdx = 0;

  if (settings.m3u_content) {
    const parsed = parseM3UEntries(settings.m3u_content);
    parsed.forEach((e) => {
      merged.push({
        id: `m3u-${m3uIdx}`,
        name: e.name,
        url: e.url,
        logo: e.logo,
        category: normalizeCategory(e.category),
        source: 'm3u',
        epg_channel_id: e.tvg_id || null,
      });
      m3uIdx += 1;
    });
  }

  if (settings.xtream_base_url && settings.xtream_username && settings.xtream_password) {
    try {
      const xc = await fetchXtreamLiveStreams(
        settings.xtream_base_url,
        settings.xtream_username,
        settings.xtream_password
      );
      xc.forEach((s) => {
        merged.push({
          id: `xc-${s.stream_id}`,
          name: s.name,
          url: s.url,
          logo: s.logo,
          category: normalizeCategory(s.category),
          source: 'xtream',
          epg_channel_id: s.epg_channel_id,
        });
      });
    } catch (e) {
      console.error('[IPTV] Xtream kanal listesi alınamadı:', e.message);
    }
  }

  return merged;
}

function getIptvSettingsRow(db, membershipId) {
  return db.prepare('SELECT * FROM membership_iptv_settings WHERE membership_id = ?').get(membershipId);
}

function ensureIptvRow(db, membershipId) {
  let row = getIptvSettingsRow(db, membershipId);
  if (!row) {
    db.prepare('INSERT INTO membership_iptv_settings (membership_id) VALUES (?)').run(membershipId);
    row = getIptvSettingsRow(db, membershipId);
  }
  return row;
}

module.exports = {
  parseM3UEntries,
  fetchXtreamLiveStreams,
  testXtreamConnection,
  parseXmltvProgrammes,
  buildMergedChannelList,
  getProgrammesForChannel,
  getIptvSettingsRow,
  ensureIptvRow,
};
