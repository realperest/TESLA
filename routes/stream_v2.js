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
 * Tesla Bypass V2 Streamer
 * - H.264 Annex B Stream
 * - 8-byte PTS injection (Master Clock Sync için)
 * - Low latency / No B-frames
 */
async function handleStreamConnectionV2(ws, req) {
    const query = new URL('http://x' + (req.url || '')).searchParams;
    const url = query.get('url');
    const startTime = query.get('t') || '0';
    
    if (!url) return ws.close(1008);
    const targetUrl = decodeURIComponent(url);

    try {
        console.log(`[StreamV2] Starting Bypass Stream: ${targetUrl} (T: ${startTime}s)`);

        // 1. YouTube/Media Stream Extract
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

        // 2. FFmpeg: Convert to Raw H.264 Annex B with PTS metadata
        const ffArgs = [
            '-re',               // Read at native frame rate to prevent flood
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',
            '-level', '3.1',
            '-b:v', '1500k',
            '-maxrate', '2000k',
            '-bufsize', '4000k',
            '-pix_fmt', 'yuv420p',
            '-g', '1',           // Every frame is a keyframe
            '-bf', '0', 
            '-f', 'h264',
            '-x264-params', 'annexb=1:keyint=1', 
            'pipe:1',
            '-an'
        ];

        const ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        yt.stdout.pipe(ff.stdin);

        ACTIVE_V2.set(ws, { ff, yt });

        const startTimeMs = Date.now();
        const startSec = parseFloat(startTime);

        ff.stdout.on('data', (chunk) => {
            if (ws.readyState === 1) {
                // ABSOLUTE PTS: Current Sec = Start Sec + Seconds since start
                const currentSec = startSec + (Date.now() - startTimeMs) / 1000;
                const header = Buffer.alloc(8);
                header.writeDoubleLE(currentSec);
                ws.send(Buffer.concat([header, chunk]));
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
