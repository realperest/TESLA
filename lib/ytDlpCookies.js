/**
 * yt-dlp için YouTube çerez dosyası (--cookies).
 * Datacenter IP'lerde "Sign in to confirm you're not a bot" hatasını çoğu zaman giderir.
 *
 * 1) Chrome'da youtube.com'a giriş yapın
 * 2) "Get cookies.txt LOCALLY" veya benzeri eklentiyle Netscape cookies.txt export edin
 * 3) Dosyayı projede youtube-cookies.txt olarak kaydedin VEYA Railway'de YOUTUBE_COOKIES_FILE ile yol verin
 * 4) Bu dosyayı asla git'e commit etmeyin (.gitignore)
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_REL = path.join(__dirname, '..', 'youtube-cookies.txt');

function getYoutubeCookieArgs() {
  const fromEnv = process.env.YOUTUBE_COOKIES_FILE;
  const candidate = fromEnv ? path.resolve(fromEnv.trim()) : path.resolve(DEFAULT_REL);
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
      fs.accessSync(candidate, fs.constants.R_OK);
      return ['--cookies', candidate];
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[yt-dlp] cookies dosyasi okunamadi:', candidate, err.message);
    }
  }
  return [];
}

/**
 * railway run cogu zaman KENDI PC'de calisir; /data yok. Cozum: cookies'i Base64 olarak
 * Railway degiskenine yapistir, surec acilisinda diske yazilir.
 * PowerShell: [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content .\\youtube-cookies.txt -Raw)))
 */
function materializeCookiesFromB64() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64 || !String(b64).trim()) return;
  const target = process.env.YOUTUBE_COOKIES_FILE
    ? path.resolve(String(process.env.YOUTUBE_COOKIES_FILE).trim())
    : path.resolve(DEFAULT_REL);
  try {
    const buf = Buffer.from(String(b64).replace(/\s+/g, ''), 'base64');
    if (!buf.length) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[yt-dlp] YOUTUBE_COOKIES_B64 gecersiz (bos decode)');
      }
      return;
    }
    const dir = path.dirname(target);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, buf);
    if (typeof console !== 'undefined' && console.log) {
      console.log('[yt-dlp] cookies dosyasi yazildi:', target, `(${buf.length} bayt)`);
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[yt-dlp] YOUTUBE_COOKIES_B64 yazilamadi:', err.message);
    }
  }
}

module.exports = {
  getYoutubeCookieArgs,
  materializeCookiesFromB64,
  DEFAULT_COOKIE_PATH: path.resolve(DEFAULT_REL),
};
