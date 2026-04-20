'use strict';

const { spawn } = require('child_process');
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

const ACTIVE_V2 = new Map();

/**
 * Tesla Bypass V2 Streamer with Annex B Packetizer
 */
async function handleStreamConnectionV2(ws, req) {
    const query = new URL('http://x' + (req.url || '')).searchParams;
    const url = query.get('url');
    const startTime = query.get('t') || '0';
    
    if (!url) return ws.close(1008);
    const targetUrl = decodeURIComponent(url);

    try {
        console.log(`[StreamV2] Starting Bypass Stream: ${targetUrl}`);

        const ytArgs = [
            ..._ytCookieArgs(),
            '--no-playlist', '--no-warnings', '--force-ipv4',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            '--extractor-args', 'youtube:player_client=tv,android',
            startTime !== '0' ? '--download-sections' : null,
            startTime !== '0' ? `*${startTime}-inf` : null,
            '--format', 'bestvideo[height<=720][vcodec^=avc1]+bestaudio/best[height<=720]',
            '-o', '-', targetUrl
        ].filter(Boolean);

        const yt = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

        const ffArgs = [
            '-re',
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',
            '-level', '3.1',
            '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
            '-b:v', '4000k',
            '-maxrate', '4500k',
            '-bufsize', '9000k',
            '-pix_fmt', 'yuv420p',
            '-g', '15',          // Keyframe every 0.5s for fast recovery
            '-bf', '0', 
            '-f', 'h264',
            '-x264-params', 'annexb=1', 
            'pipe:1',
            '-an'
        ];

        const ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        yt.stdout.pipe(ff.stdin);

        ACTIVE_V2.set(ws, { ff, yt });

        const startTimeMs = Date.now();
        const startSec = parseFloat(startTime);

        /**
         * Annex B Packetizer
         * Finds [0,0,0,1] or [0,0,1] markers and ensures whole NAL units are sent
         */
        let buffer = Buffer.alloc(0);
        ff.stdout.on('data', (chunk) => {
            if (ws.readyState !== 1) return;
            buffer = Buffer.concat([buffer, chunk]);

            let pos;
            while ((pos = _findNALStartCode(buffer, 4)) !== -1) {
                const nal = buffer.slice(0, pos);
                buffer = buffer.slice(pos);
                
                if (nal.length > 0) {
                    const currentSec = startSec + (Date.now() - startTimeMs) / 1000;
                    const header = Buffer.alloc(8);
                    header.writeDoubleLE(currentSec);
                    ws.send(Buffer.concat([header, nal]));
                }
            }
        });

        ff.on('close', () => {
            if (ws.readyState === 1) ws.close();
            _cleanupV2(ws);
        });

    } catch (err) {
        console.error('[StreamV2] Error:', err);
        ws.close(1011);
    }

    ws.on('close', () => _cleanupV2(ws));
}

// FFmpeg raw h264'te start code arar [0,0,0,1]
function _findNALStartCode(buf, offset) {
    for (let i = offset; i < buf.length - 4; i++) {
        if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
            return i;
        }
        if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) {
            return i;
        }
    }
    return -1;
}

function _cleanupV2(ws) {
    const entry = ACTIVE_V2.get(ws);
    if (entry) {
        if (entry.yt) try { entry.yt.kill(); } catch {}
        if (entry.ff) try { entry.ff.kill(); } catch {}
        ACTIVE_V2.delete(ws);
    }
}

/**
 * Audio Streaming for V2 (Master Clock)
 */
async function handleAudioRequestV2(req, res) {
    const query = req.query;
    const url = query.url;
    const startTime = query.t || '0';

    if (!url) return res.status(400).end();
    const targetUrl = decodeURIComponent(url);

    res.setHeader('Content-Type', 'audio/mpeg');

    const ytArgs = [
        ..._ytCookieArgs(),
        '--no-playlist', '--no-warnings', '--force-ipv4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        startTime !== '0' ? '--download-sections' : null,
        startTime !== '0' ? `*${startTime}-inf` : null,
        '--format', 'bestaudio/best',
        '-o', '-', targetUrl
    ].filter(Boolean);

    const yt = spawn(YT_DLP, ytArgs);
    
    const ffArgs = [
        '-i', 'pipe:0',
        '-acodec', 'libmp3lame',
        '-ab', '128k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1'
    ];

    const ff = spawn(FFMPEG_PATH, ffArgs);
    yt.stdout.pipe(ff.stdin);
    ff.stdout.pipe(res);

    req.on('close', () => {
        try { yt.kill(); ff.kill(); } catch {}
    });
}

module.exports = { handleStreamConnectionV2, handleAudioRequestV2 };
