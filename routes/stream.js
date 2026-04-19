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
    '-thread_queue_size', '512',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '1280x720',
    '-b:v', '1000k',
    '-maxrate', '1200k',
    '-bufsize', '3000k',
    '-bf', '0',
    '-codec:a', 'mp2',
    '-af', 'volume=2.5', // Slightly more boost
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '128k',
    '-muxdelay', '0.001',
    'pipe:1'
  ];
}

function _setupOutputs(ws, ff) {
  ff.stdout.on('data', (chunk) => {
    if (ws.readyState === 1) ws.send(chunk);
  });

  ff.stderr.on('data', (c) => {
    const msg = c.toString();
    if (msg.includes('Error') || msg.includes('Failed')) {
      console.warn('[FMMPEG-ERR]', msg.trim());
    }
  });

  ff.on('close', (code) => {
    console.log('[Stream] FFmpeg exit code:', code);
    ACTIVE.delete(ws);
    if (ws.readyState <= 1) ws.close(1001);
  });
}

function _sendWsPacket(ws, type, data, startTs) {
  // Not used in Multiplex mode, but kept for legacy
}

async function handleStreamConnection(ws, req) {
  const url = new URL('http://x' + (req.url || '')).searchParams.get('url');
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  try {
    if (_isYouTubeUrl(targetUrl)) {
      console.log('[Stream] yt-dlp:', targetUrl);
      const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '-f', '18/92/22/best', '-o', '-', targetUrl].flat().filter(Boolean);
      const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      
      const args = ['-re', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0'].concat(_ffmpegOutputs());
      const ff = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      
      // Prevent EPIPE crash
      yt.stdout.on('error', (e) => console.warn('[YT-STDOUT-ERR]', e.message));
      ff.stdin.on('error', (e) => {
         if (e.code === 'EPIPE') {
           console.warn('[FF-STDIN-EPIPE] FFmpeg input closed unexpectedly');
         } else {
           console.warn('[FF-STDIN-ERR]', e.message);
         }
      });

      yt.stdout.pipe(ff.stdin);
      
      yt.stderr.on('data', (d) => {
         const m = d.toString();
         if (m.includes('ERROR')) console.warn('[YT-ERR]', m.trim());
      });

      ACTIVE.set(ws, { ff, yt });
      _setupOutputs(ws, ff);
    } else {
      console.log('[Stream] Direct:', targetUrl);
      const args = ['-re', '-i', targetUrl, '-map', '0:v:0?', '-map', '0:a:0?'].concat(_ffmpegOutputs());
      const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      ACTIVE.set(ws, { ff });
      _setupOutputs(ws, ff);
    }
  } catch (e) {
    console.error('[Stream] App Error:', e.message);
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
  // We don't strictly need this endpoint anymore if using Multiplex WebSocket,
  // but we keep it around just in case for older clients or fallback.
  res.status(404).end();
}

module.exports = { handleStreamConnection, handleAudioRequest };
