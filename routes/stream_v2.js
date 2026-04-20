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
        // Tesla'da WebCodecs hardware acceleration için 'avc1' (h.264) en stabil olanıdır.
        const ffArgs = [
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',
            '-level', '3.1',
            '-b:v', '2500k',
            '-maxrate', '3000k',
            '-bufsize', '6000k',
            '-pix_fmt', 'yuv420p',
            '-g', '30',          // GOP size
            '-bf', '0',          // B-frames = 0 (low latency)
            '-f', 'h264',        // Raw H.264 bitstream
            '-x264-params', 'annexb=1', 
            'pipe:1',
            // Ses için ayrı bir stream (isteğe bağlı ama dünkü plana sadık kalarak PCM/MP3 denenebilir)
            // Ancak şimdilik ses player'da ayrı <audio> olarak çözüleceği için videoyu odaklıyoruz.
            '-an'
        ];

        const ff = spawn(FFMPEG_PATH, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        yt.stdout.pipe(ff.stdin);

        ACTIVE_V2.set(ws, { ff, yt });

        /**
         * PTS INJECTION LOGIC:
         * FFmpeg raw h264'te PTS bilgisi paket içinde gömülü değildir. 
         * Ancak her frame'in (NAL unit) başına tarayıcıda senkron için 8-byte PTS ekleyeceğiz.
         * Şimdilik gerçek zamanlı senkron için basitleştirilmiş bir paketleme yapıyoruz.
         * (Daha kompleks bir TS/AVParser yerine, her buffer gönderiminde zaman damgası ekliyoruz)
         */
        const startTimeMs = Date.now();
        ff.stdout.on('data', (chunk) => {
            if (ws.readyState === 1) {
                // Header: [8-byte Timestamp (Double/Float64)] + [Original H.264 Data]
                const timestamp = (Date.now() - startTimeMs) / 1000;
                const header = Buffer.alloc(8);
                header.writeDoubleLE(timestamp);
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

function _cleanupV2(ws) {
    const entry = ACTIVE_V2.get(ws);
    if (entry) {
        if (entry.yt) try { entry.yt.kill(); } catch {}
        if (entry.ff) try { entry.ff.kill(); } catch {}
        ACTIVE_V2.delete(ws);
    }
}

module.exports = { handleStreamConnectionV2 };
