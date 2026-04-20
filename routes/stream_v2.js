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
 */
async function handleStreamConnectionV2(ws, req) {
    const query = new URL('http://x' + (req.url || '')).searchParams;
    const url = query.get('url');
    const startTimeStr = query.get('t') || '0';
    const startSec = isNaN(parseFloat(startTimeStr)) ? 0 : parseFloat(startTimeStr);
    
    if (!url) return ws.close(1008);
    const targetUrl = decodeURIComponent(url);

    try {
        console.log(`[StreamV2] Starting Bypass Stream: ${targetUrl}`);

        const ytArgs = [
            ..._ytCookieArgs(),
            '--no-playlist', '--no-warnings', '--force-ipv4',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            '--extractor-args', 'youtube:player_client=tv,android',
            startSec !== 0 ? '--download-sections' : null,
            startSec !== 0 ? `*${startSec}-inf` : null,
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
            '-maxrate', '5000k',
            '-bufsize', '10000k',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-bf', '0',
            '-an',
            '-f', 'h264',
            '-x264-params', 'annexb=1:repeat-headers=1:aud=1', // AU boundary'leri icin AUD ekle
            'pipe:1'
        ];

        const ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        yt.stdout.pipe(ff.stdin);

        ACTIVE_V2.set(ws, { ff, yt });

        const streamStartAt = Date.now();

        ff.stdout.on('data', (chunk) => {
            if (ws.readyState !== 1) return;

            // V2 için chunk'ı olduğu gibi gönder: over-packetize etmek WebCodecs tarafında
            // siyah ekran üretebiliyor. Decoder, Annex-B chunk'ları frame bazında daha stabil alıyor.
            const pts = startSec + (Date.now() - streamStartAt) / 1000;
            const header = Buffer.alloc(8);
            header.writeDoubleLE(pts);
            ws.send(Buffer.concat([header, chunk]));
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
    const startTimeStr = query.t || '0';
    const startSec = isNaN(parseFloat(startTimeStr)) ? 0 : parseFloat(startTimeStr);

    if (!url) return res.status(400).end();
    const targetUrl = decodeURIComponent(url);

    res.setHeader('Content-Type', 'audio/mpeg');

    const ytArgs = [
        ..._ytCookieArgs(),
        '--no-playlist', '--no-warnings', '--force-ipv4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        startSec !== 0 ? '--download-sections' : null,
        startSec !== 0 ? `*${startSec}-inf` : null,
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
