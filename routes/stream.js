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

    let finalInputUrl = targetUrl;

    // 1. YouTube ise ham linki al (Throttling'den kaçmak için)
    if (isYouTube) {
      console.log('[Stream] Fetching direct URL for YouTube...');
      const ytProc = spawn(YT_DLP, [
        '--get-url', '--no-playlist', '--force-ipv4',
        '--format', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
        ..._ytCookieArgs(), targetUrl
      ]);
      
      let out = '';
      for await (const chunk of ytProc.stdout) { out += chunk.toString(); }
      finalInputUrl = out.trim().split('\n')[0]; // İlk linki al (genelde video+audio birleşik format)
      if (!finalInputUrl) throw new Error('YouTube linki alınamadı');
    }

    // 2. FFmpeg ile Yayını Başlat
    const ffArgs = [
      '-thread_queue_size', '8192', '-re',
      startTime !== '0' ? '-ss' : null, startTime !== '0' ? startTime : null,
      '-i', finalInputUrl,
      ..._ffmpegOutputs()
    ].filter(Boolean);

    ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    ACTIVE.set(ws, { ff });

    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) ws.send(Buffer.from([0x00]), (err) => { if (err) _cleanupSession(ws); });
    }, 10000);

    let isPaused = false;
    ws.on('message', (msg) => {
      try {
        const p = JSON.parse(msg);
        if (p.type === 'pause') { isPaused = true; ff.stdout.pause(); }
        else if (p.type === 'resume') { isPaused = false; ff.stdout.resume(); }
      } catch (e) {}
    });

    ff.stdout.on('data', (d) => { 
      if (!isPaused && ws.readyState === 1) ws.send(d, (err) => { if (err) _cleanupSession(ws); });
    });

    ff.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Error')) console.log('[FF-ERR]', msg.trim());
    });
    
    ff.on('close', () => { clearInterval(heartbeat); if (ws.readyState === 1) ws.close(); _cleanupSession(ws); });
    ff.on('error', (e) => { console.error('[FF-FATAL]', e); clearInterval(heartbeat); _cleanupSession(ws); });



  } catch (err) {
    console.error('[Stream] Fatal Error:', err.message);
    ws.close(1011);
  }

  ws.on('close', () => {
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
