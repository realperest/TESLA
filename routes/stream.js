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
    '-b:v', '4000k',
    '-maxrate', '5000k',
    '-bufsize', '10000k',
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
  const startTime = query.get('t') || '0'; // seconds
  
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  const isYouTube = targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be');

  try {
    let ff, yt;
    console.log(`[Stream] Loading: ${targetUrl} (Start: ${startTime}s)`);
    
    // Unified Loader with Seek support
    const ytArgs = [
      '--no-playlist', '--no-warnings', '--force-ipv4', '--geo-bypass',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--extractor-args', isYouTube ? 'youtube:player_client=tv,android' : 'generic:referer=https://www.trtizle.com/',
      isYouTube ? `--start-time` : null, isYouTube ? startTime : null, 
      '--format', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best[height<=720]',
      '-o', '-', targetUrl
    ].filter(Boolean);
    
    yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    
    const ffArgs = ['-thread_queue_size', '1024', '-re', '-i', 'pipe:0', '-map', '0:v:0?', '-map', '0:a:0?'].concat(_ffmpegOutputs());
    ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    yt.stdout.pipe(ff.stdin);
    
    // Pipe and error handling
    ff.stdin.on('error', (e) => { if (e.code === 'EPIPE') console.warn('[FF] Pipe closed'); });
    yt.stderr.on('data', (d) => { 
      const m = d.toString();
      if (m.includes('ERROR')) console.error('[Fetcher-ERR]', m.trim());
    });

    ACTIVE.set(ws, { ff, yt });

    // Pipe outputs to WS
    ff.stdout.on('data', (d) => { if (ws.readyState === 1) ws.send(d); });
    ff.on('close', () => {
      if (ws.readyState === 1) ws.close();
      _cleanupSession(ws);
    });

  } catch (err) {
    console.error('[Stream] App Error:', err.message);
    ws.close(1011);
  }

  ws.on('close', () => _cleanupSession(ws));
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
