'use strict';

const { spawn } = require('child_process');
const http      = require('http');
const https     = require('https');
const path      = require('path');
const fs        = require('fs');
const dns       = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);

let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch {
  FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
}

const YT_DLP = (() => {
  const venv = path.join(__dirname, '..', 'venv', 'Scripts', 'yt-dlp.exe');
  try { fs.accessSync(venv); return venv; } catch { return 'yt-dlp'; }
})();

function _ytCookieArgs() {
  const p = path.join(__dirname, '..', 'youtube-cookies.txt');
  try { if (fs.existsSync(p) && fs.statSync(p).size > 0) return ['--cookies', p]; } catch {}
  return [];
}

const ACTIVE = new Map();

function _isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

function _h264Args() {
  return [
    '-re', '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '4.1',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=30:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'h264',
    'pipe:1',
  ];
}

const TYPE_VIDEO = 0x01;

function _attachH264Output(ws, ff, label) {
  let buffer = Buffer.alloc(0);
  const startTs = Date.now();

  ff.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    
    let i = 0;
    while (i < buffer.length - 4) {
      if (buffer[i] === 0 && buffer[i+1] === 0 && buffer[i+2] === 0 && buffer[i+3] === 1) {
        if (i > 0) {
          const nalUnit = buffer.slice(0, i);
          _sendVideoPacket(ws, nalUnit, startTs);
          buffer = buffer.slice(i);
          i = 0;
          continue;
        }
      }
      i++;
    }
  });

  ff.stderr.on('data', (c) => {
    const line = c.toString().trim();
    if (line.includes('Error') || line.includes('warning')) {
      console.log(`[ffmpeg/${label}]`, line);
    }
  });

  ff.on('close', () => { ACTIVE.delete(ws); if (ws.readyState <= 1) ws.close(1001); });
}

function _sendVideoPacket(ws, data, startTs) {
  if (ws.readyState !== 1 || data.length < 5) return;
  
  // Basit PTS: Akışın başlangıcından beri geçen ms
  const pts = BigInt(Date.now() - startTs);
  const header = Buffer.allocUnsafe(9);
  header[0] = TYPE_VIDEO;
  header.writeBigUInt64LE(pts, 1);
  
  try {
    ws.send(Buffer.concat([header, data]), { binary: true });
  } catch (e) {
    console.warn('[WS] Paket gönderim hatası:', e.message);
  }
}

async function handleStreamConnection(ws, req) {
  const url = new URL('http://x' + (req.url || '')).searchParams.get('url');
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  try {
    if (_isYouTubeUrl(targetUrl)) {
      console.log('[Stream] YouTube Mode:', targetUrl);
      const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '-f', '18/best', '-o', '-', targetUrl].flat().filter(Boolean);
      const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
      const ff = spawn(FFMPEG_PATH, _h264Args(), { stdio: ['pipe', 'pipe', 'pipe'] });
      
      yt.stdout.pipe(ff.stdin);
      ACTIVE.set(ws, { ff, yt });
      _attachH264Output(ws, ff, 'YT');
    } else {
      console.log('[Stream] Direct Mode:', targetUrl);
      const ff = spawn(FFMPEG_PATH, ['-i', targetUrl, ..._h264Args()], { stdio: ['ignore', 'pipe', 'pipe'] });
      ACTIVE.set(ws, { ff });
      _attachH264Output(ws, ff, 'Direct');
    }
  } catch (e) {
    console.error('[Stream] Başlatma Hatası:', e.message);
    ws.close(1011);
  }

  ws.on('close', () => {
    const entry = ACTIVE.get(ws);
    if (entry) {
      if (entry.yt) try { entry.yt.kill('SIGKILL'); } catch {}
      if (entry.ff) try { entry.ff.kill('SIGKILL'); } catch {}
      ACTIVE.delete(ws);
    }
  });
}

function handleAudioRequest(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  const targetUrl = decodeURIComponent(url);

  const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '-f', '140/bestaudio/18', '-o', '-', targetUrl].flat().filter(Boolean);
  const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  const ff = spawn(FFMPEG_PATH, ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-q:a', '5', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
  
  yt.stdout.pipe(ff.stdin);
  res.setHeader('Content-Type', 'audio/mpeg');
  ff.stdout.pipe(res);
  
  req.on('close', () => {
    try { yt.kill('SIGKILL'); ff.kill('SIGKILL'); } catch {}
  });
}

module.exports = { handleStreamConnection, handleAudioRequest };
