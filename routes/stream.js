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
    '-probesize', '32k',
    '-analyzeduration', '100k',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,unsharp=5:5:1.0:5:5:0.5,fps=30',
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '1280x720',
    '-b:v', '6000k',
    '-maxrate', '8000k',
    '-bufsize', '24000k',
    '-g', '15',
    '-threads', '0',
    '-acodec', 'mp2',
    '-af', 'volume=2.0,aresample=async=1:min_hard_comp=0.100000:first_pts=0',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '192k',
    '-mpegts_flags', '+initial_discontinuity+system_b+latm',
    '-fflags', '+genpts+discardcorrupt+igndts',
    '-muxdelay', '0.1',
    'pipe:1'
  ];
}

async function handleStreamConnection(ws, req) {
  const query = new URL('http://x' + (req.url || '')).searchParams;
  const url = query.get('url');
  const startTime = query.get('t') || '0'; 
  const isV8 = query.get('v8') === '1';
  
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  const isYouTube = _isYouTubeUrl(targetUrl);

  try {
    let ff, yt;
    console.log(`[Stream] Fast-Start (${isV8 ? 'V8-Hybrid' : 'V5-MTS'}): ${targetUrl} (Seek: ${startTime}s)`);

    // Core Engine: Standardize transport for Tesla
    const ytArgs = [
      '--no-playlist', '--no-warnings', '--force-ipv4',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--extractor-args', isYouTube ? 'youtube:player_client=tv,android' : `generic:referer=https://www.trtizle.com/`,
      isYouTube ? '--download-sections' : null, 
      isYouTube ? `*${startTime}-inf` : null,
      '--format', isV8 ? 'best[height<=720]' : 'best[height<=720]', 
      '--socket-timeout', '30',
      '-o', '-', targetUrl
    ].concat(_ytCookieArgs()).filter(Boolean);
    
    let ffArgs;
    if (isV8) {
      // V8 Hibrit Modu: Video (H264) -> Pipe:1, Ses (MP3) -> Pipe:3
      ffArgs = [
        '-thread_queue_size', '4096', '-re', '-i', 'pipe:0',
        '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-f', 'h264', 'pipe:1',
        '-map', '0:a:0', '-c:a', 'libmp3lame', '-ar', '44100', '-f', 'mp3', 'pipe:3'
      ];
    } else {
      // V5 Standart Mod: MPEGTS
      ffArgs = ['-thread_queue_size', '4096', '-re', '-i', 'pipe:0', ..._ffmpegOutputs()];
    }

    yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    
    ACTIVE.set(ws, { ff, yt });

    yt.stdout.on('data', (chunk) => {
      if (ff.stdin && ff.stdin.writable) {
        ff.stdin.write(chunk, (err) => { if (err) try { yt.kill(); } catch(e){} });
      }
    });

    // ── Zırhlı Hata Yakalayıcılar ──
    yt.stdout.on('error', () => {});
    ff.stdin.on('error', () => {});
    yt.stderr.on('error', () => {});
    ff.stderr.on('error', () => {});

    yt.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('ERROR')) console.log('[YT-ERR]', msg.trim());
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) ws.send(Buffer.from([0x00]), (err) => { if (err) _cleanupSession(ws); });
    }, 10000);

    // V5 Veri Gönderimi (MPEGTS)
    if (!isV8) {
      ff.stdout.on('data', (d) => { 
        if (ws.readyState === 1) ws.send(d, (err) => { if (err) _cleanupSession(ws); });
      });
    } else {
      // V8 Veri Gönderimi (Multiplexed)
      // Video -> 0x00
      ff.stdout.on('data', (d) => {
        if (ws.readyState === 1) {
          const out = Buffer.concat([Buffer.from([0x00]), d]);
          ws.send(out, (err) => { if (err) _cleanupSession(ws); });
        }
      });
      // Audio (Pipe 3) -> 0x01
      ff.stdio[3].on('data', (d) => {
        if (ws.readyState === 1) {
          const out = Buffer.concat([Buffer.from([0x01]), d]);
          ws.send(out, (err) => { if (err) _cleanupSession(ws); });
        }
      });
    }

    ws.on('message', (msg) => {
      try {
        const p = JSON.parse(msg);
        if (p.type === 'pause' && ff.stdout) { ff.stdout.pause(); if (ff.stdio[3]) ff.stdio[3].pause(); }
        else if (p.type === 'resume' && ff.stdout) { ff.stdout.resume(); if (ff.stdio[3]) ff.stdio[3].resume(); }
      } catch (e) {}
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

async function handleAudioRequest(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL required');
  
  res.setHeader('Content-Type', 'audio/mpeg');
  const yt = spawn(YT_DLP, [
    '--no-playlist', '--format', 'bestaudio', '-o', '-', targetUrl
  ].concat(_ytCookieArgs()));
  
  const ff = spawn(FFMPEG_PATH, [
    '-i', 'pipe:0', '-acodec', 'libmp3lame', '-ab', '128k', '-f', 'mp3', 'pipe:1'
  ]);
  
  yt.stdout.pipe(ff.stdin);
  ff.stdout.pipe(res);
  
  res.on('close', () => {
    try { yt.kill(); ff.kill(); } catch(e){}
  });
}

async function handleHttpStreamRequest(req, res) {
  const targetUrl = req.query.url;
  const startTime = req.query.t || '0';
  if (!targetUrl) return res.status(400).send('URL required');
  
  const isYouTube = _isYouTubeUrl(targetUrl);
  
  res.setHeader('Content-Type', 'video/mp4');
  
  const ytArgs = [
    '--no-playlist', '--no-warnings', '--force-ipv4',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    '--extractor-args', isYouTube ? 'youtube:player_client=tv,android' : `generic:referer=https://www.trtizle.com/`,
    isYouTube ? '--download-sections' : null, 
    isYouTube ? `*${startTime}-inf` : null,
    '--format', 'best[ext=mp4][height<=720]', // MP4 format
    '-o', '-', targetUrl
  ].concat(_ytCookieArgs()).filter(Boolean);

  const yt = spawn(YT_DLP, ytArgs);
  
  yt.on('error', (err) => {
    console.error('[HTTP Stream] yt-dlp başlatılamadı:', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  // FFmpeg ile "copy" yaparak CPU kullanmadan Fragmented MP4 (fMP4) oluşturuyoruz.
  // fMP4, tarayıcıların "Range" desteği aramaksızın pipe üzerinden videoyu anında oynatmasını sağlar.
  const ffArgs = [
    '-i', 'pipe:0',
    '-c', 'copy',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov',
    'pipe:1'
  ];
  const ff = spawn(FFMPEG_PATH, ffArgs);

  ff.on('error', (err) => {
    console.error('[HTTP Stream] ffmpeg başlatılamadı:', err.message);
  });

  yt.stdout.pipe(ff.stdin);
  ff.stdout.pipe(res);
  
  res.on('close', () => {
    try { yt.kill(); } catch(e){}
    try { ff.kill(); } catch(e){}
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

module.exports = { router, handleStreamConnection, handleAudioRequest, handleHttpStreamRequest };
