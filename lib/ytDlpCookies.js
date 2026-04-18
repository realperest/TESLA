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

module.exports = { getYoutubeCookieArgs, DEFAULT_COOKIE_PATH: path.resolve(DEFAULT_REL) };
