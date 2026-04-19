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
    '-map', '0:v:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', '3.1',
    '-x264opts', 'annexb=1:repeat-headers=1:keyint=30:min-keyint=30:bframes=0:scenecut=0',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
    '-f', 'h264',
    'pipe:1',
    '-map', '0:a:0?', '-c:a', 'libmp3lame', '-q:a', '5', '-f', 'mp3', 'pipe:3'
  ];
}

const TYPE_VIDEO = 0x01;
const TYPE_AUDIO = 0x02;

function _setupOutputs(ws, ff) {
  let videoBuffer = Buffer.alloc(0);
  const startTs = Date.now();

  // VIDEO (pipe:1 - stdout)
  ff.stdout.on('data', (chunk) => {
    videoBuffer = Buffer.concat([videoBuffer, chunk]);
    let offset = 0;
    let i = 0;
    while (i <= videoBuffer.length - 4) {
      if (videoBuffer[i] === 0 && videoBuffer[i+1] === 0 && videoBuffer[i+2] === 0 && videoBuffer[i+3] === 1) {
        if (i > offset) {
          const nalUnit = videoBuffer.slice(offset, i);
          _sendWsPacket(ws, TYPE_VIDEO, nalUnit, startTs);
        }
        offset = i; // Next element includes the 00 00 00 01 delimiter
        i += 4;
      } else {
        i++;
      }
    }
    videoBuffer = videoBuffer.slice(offset);
  });

  // AUDIO (pipe:3)
  const audioPipe = ff.stdio[3];
  if (audioPipe) {
    audioPipe.on('data', (chunk) => {
      _sendWsPacket(ws, TYPE_AUDIO, chunk, startTs);
    });
  }

  // ERROR LOGGING (pipe:2 - stderr)
  ff.stderr.on('data', (c) => {
    const line = c.toString().trim();
    if (line.includes('Error') || line.includes('warning')) {
      console.log(`[ffmpeg] ${line}`);
    }
  });

  ff.on('close', () => { ACTIVE.delete(ws); if (ws.readyState <= 1) ws.close(1001); });
}

function _sendWsPacket(ws, type, data, startTs) {
  if (ws.readyState !== 1) return;
  const pts = BigInt(Date.now() - startTs);
  const header = Buffer.allocUnsafe(9);
  header[0] = type;
  header.writeBigUInt64LE(pts, 1);
  try {
    ws.send(Buffer.concat([header, data]), { binary: true });
  } catch (e) {}
}

async function handleStreamConnection(ws, req) {
  const url = new URL('http://x' + (req.url || '')).searchParams.get('url');
  if (!url) return ws.close(1008);
  
  const targetUrl = decodeURIComponent(url);
  try {
    if (_isYouTubeUrl(targetUrl)) {
      console.log('[Stream] YouTube Multiplex Mode:', targetUrl);
      const ytArgs = [_ytCookieArgs(), '--no-playlist', '--no-warnings', '-f', '18/best', '-o', '-', targetUrl].flat().filter(Boolean);
      const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
      const args = ['-i', 'pipe:0'].concat(_ffmpegOutputs());
      const ff = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
      
      yt.stdout.pipe(ff.stdin);
      ACTIVE.set(ws, { ff, yt });
      _setupOutputs(ws, ff);
    } else {
      console.log('[Stream] Direct Multiplex Mode:', targetUrl);
      const args = ['-i', targetUrl].concat(_ffmpegOutputs());
      const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      ACTIVE.set(ws, { ff });
      _setupOutputs(ws, ff);
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
  // We don't strictly need this endpoint anymore if using Multiplex WebSocket,
  // but we keep it around just in case for older clients or fallback.
  res.status(404).end();
}

module.exports = { handleStreamConnection, handleAudioRequest };
