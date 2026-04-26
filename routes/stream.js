'use strict';

const { spawn } = require('child_process');
const http      = require('http');
const https     = require('https');
const path      = require('path');
const fs        = require('fs');

let FFMPEG_PATH;
try { FFMPEG_PATH = require('ffmpeg-static'); } catch { FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'; }

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

function _ffmpegOutputs() {
  return [
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,unsharp=5:5:1.0:5:5:0.5,fps=30',
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '1280x720',
    '-b:v', '6000k',
    '-maxrate', '8000k',
    '-bufsize', '12000k',
    '-g', '15',
    '-acodec', 'mp2',
    '-af', 'volume=2.0,aresample=async=1:min_hard_comp=0.100000:first_pts=0', // Force audio sync
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '256k',
    '-mpegts_flags', '+initial_discontinuity+system_b+latm',
    '-fflags', '+genpts+discardcorrupt+igndts', // Better timestamp generation
    '-muxdelay', '0',
    'pipe:1'
  ];
}

async function handleStreamConnection(ws, req) {
  const query = new URL('http://x' + (req.url || '')).searchParams;
  const url = query.get('url');
  const startTime = query.get('t') || '0'; 
  
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  const isYouTube = _isYouTubeUrl(targetUrl);

  try {
    let ff, yt;
    console.log(`[Stream] Fast-Start: ${targetUrl} (Seek: ${startTime}s)`);
    
    // Core Engine: Standardize transport for Tesla
    const ytArgs = [
      '--no-playlist', '--no-warnings', '--force-ipv4', '--geo-bypass',
      '--concurrent-fragments', '4',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--extractor-args', isYouTube ? 'youtube:player_client=tv,android' : `generic:referer=https://www.trtizle.com/`,
      isYouTube && startTime !== '0' ? '--download-sections' : null, 
      isYouTube && startTime !== '0' ? `*${startTime}-inf` : null,
      '--format', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best[height<=720]',
      '-o', '-', targetUrl
    ].filter(Boolean);
    
    // FFmpeg Optimization for Tesla Seeking:
    const ffArgs = [
      '-thread_queue_size', '4096', '-re', '-i', 'pipe:0',
      '-g', '1', '-bf', '0', 
      '-map', '0:v:0?', '-map', '0:a:0?'
    ].concat(_ffmpegOutputs());

    yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    // EPIPE Hatasını Önlemek İçin Pipe Yönetimi
    yt.stdout.on('data', (chunk) => {
      if (ff.stdin.writable) {
        ff.stdin.write(chunk, (err) => {
          if (err && err.code === 'EPIPE') yt.kill();
        });
      }
    });

    yt.stdout.on('error', () => {});
    ff.stdin.on('error', (err) => {
      if (err.code === 'EPIPE') yt.kill();
    });
    
    ACTIVE.set(ws, { ff, yt });

    // RAILWAY TIMEOUT Koruması: Her 10 saniyede bir "kalp atışı" (Binary 0x00) gönder
    // JSMpeg binary beklediği için JSON göndermek bağlantıyı koparabilir.
    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(Buffer.from([0x00]), (err) => {
          if (err) _cleanupSession(ws);
        });
      }
    }, 10000);

    let isPaused = false;
    ws.on('message', (msg) => {
      try {
        const payload = JSON.parse(msg);
        if (payload.type === 'pause') {
          isPaused = true;
          ff.stdout.pause();
        } else if (payload.type === 'resume') {
          isPaused = false;
          ff.stdout.resume();
        }
      } catch (e) {}
    });

    ff.stdout.on('data', (d) => { 
      if (!isPaused && ws.readyState === 1) {
        ws.send(d, (err) => {
          if (err) _cleanupSession(ws);
        });
      } 
    });
    
    ff.on('close', () => { 
      clearInterval(heartbeat);
      if (ws.readyState === 1) ws.close(); 
      _cleanupSession(ws); 
    });
    ff.on('error', () => {
      clearInterval(heartbeat);
      _cleanupSession(ws);
    });
    
    yt.stderr.on('data', (d) => { 
      const msg = d.toString();
      if (msg.includes('ERROR')) console.error('[YT-ERR]', msg.trim());
    });

  } catch (err) {
    console.error('[Stream] Fatal Error:', err.message);
    ws.close(1011);
  }

  ws.on('close', () => {
    // heartbeat burada temizlenemez çünkü scope dışında kalabilir, 
    // ff.on('close') ve fatal catch içinde temizlenmesi daha güvenli.
    _cleanupSession(ws);
  });
}

function _cleanupSession(ws) {
  const entry = ACTIVE.get(ws);
  if (entry) {
    if (entry.yt) try { entry.yt.kill(); } catch {}
    if (entry.ff) try { entry.ff.kill(); } catch {}
    ACTIVE.delete(ws);
  }
}

function handleAudioRequest(req, res) {
  res.status(404).end();
}

module.exports = { handleStreamConnection, handleAudioRequest };
