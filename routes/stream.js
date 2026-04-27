const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Global state to track active streams per connection
const ACTIVE = new Map();

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

function _isYouTubeUrl(url) {
  return url.includes('youtube.com/') || url.includes('youtu.be/');
}

function _ytCookieArgs() {
  const cookiePath = path.join(__dirname, '..', 'youtube-cookies.txt');
  if (fs.existsSync(cookiePath)) {
    return ['--cookies', cookiePath];
  }
  return [];
}

function _ffmpegOutputs() {
  return [
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30', // unsharp kaldırıldı (CPU dostu)
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '1280x720',
    '-b:v', '5000k', // Bitrate bir tık düşürüldü (Daha stabil akış)
    '-maxrate', '6000k',
    '-bufsize', '10000k',
    '-g', '30', // GOP artırıldı (İşlemci yükü azalır)
    '-threads', '0', // Tüm CPU çekirdeklerini kullan
    '-acodec', 'mp2',
    '-af', 'volume=2.0,aresample=async=1:min_hard_comp=0.100000:first_pts=0',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '192k',
    '-mpegts_flags', '+initial_discontinuity+system_b+latm',
    '-fflags', '+genpts+discardcorrupt+igndts',
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
      '--no-playlist', '--no-warnings', '--force-ipv4',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--extractor-args', isYouTube ? 'youtube:player_client=tv,android' : `generic:referer=https://www.trtizle.com/`,
      isYouTube && startTime !== '0' ? '--download-sections' : null, 
      isYouTube && startTime !== '0' ? `*${startTime}-inf` : null,
      '--format', 'best[height<=720]', // Tek parça format her zaman daha hızlı açılır
      '-o', '-', targetUrl
    ].concat(_ytCookieArgs()).filter(Boolean);
    
    const ffArgs = [
      '-thread_queue_size', '8192', '-re', 
      '-i', 'pipe:0',
      ..._ffmpegOutputs()
    ].filter(Boolean);

    yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    ACTIVE.set(ws, { ff, yt });

    yt.stdout.on('data', (chunk) => {
      if (ff.stdin && ff.stdin.writable) {
        ff.stdin.write(chunk, (err) => { if (err) try { yt.kill(); } catch(e){} });
      }
    });

    // ── Zırhlı Hata Yakalayıcılar ──
    yt.stdout.on('error', () => {});
    ff.stdin.on('error', () => {});

    yt.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('ERROR')) console.log('[YT-ERR]', msg.trim());
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) ws.send(Buffer.from([0x00]), (err) => { if (err) _cleanupSession(ws); });
    }, 10000);

    ws.on('message', (msg) => {
      try {
        const p = JSON.parse(msg);
        if (p.type === 'pause' && ff.stdout) { ff.stdout.pause(); }
        else if (p.type === 'resume' && ff.stdout) { ff.stdout.resume(); }
      } catch (e) {}
    });

    ff.stdout.on('data', (d) => { 
      if (ws.readyState === 1) ws.send(d, (err) => { if (err) _cleanupSession(ws); });
    });
    
    ff.on('close', () => { clearInterval(heartbeat); if (ws.readyState === 1) ws.close(); _cleanupSession(ws); });
    ff.on('error', () => { clearInterval(heartbeat); _cleanupSession(ws); });

  } catch (err) {
    console.error('[Stream] Fatal Error:', err.message);
    ws.close(1011);
  }

  ws.on('close', () => {
    _cleanupSession(ws);
  });
}

function _cleanupSession(ws) {
  const session = ACTIVE.get(ws);
  if (session) {
    try {
      if (session.ff) session.ff.kill();
      if (session.yt) session.yt.kill();
    } catch (e) {}
    ACTIVE.delete(ws);
  }
}

module.exports = { router, handleStreamConnection };
