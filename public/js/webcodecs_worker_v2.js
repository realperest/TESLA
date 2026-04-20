'use strict';

/**
 * WebCodecs Worker V2
 * Optimized for Tesla/Chromium
 */

let canvas = null;
let ctx = null;
let decoder = null;
let frameQueue = [];
let masterClock = 0;
let isConfigured = false;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        canvas = payload.canvas;
        // Optimize for speed
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        initDecoder();
    } 
    else if (type === 'clock') {
        masterClock = payload.time;
        renderLoop();
    }
    else if (type === 'video') {
        const view = new DataView(payload);
        const pts = view.getFloat64(0, true);
        const data = new Uint8Array(payload, 8);
        decodeChunk(data, pts);
    }
};

function initDecoder() {
    decoder = new VideoDecoder({
        output: (frame) => {
            frameQueue.push({
                frame: frame,
                pts: frame.timestamp / 1000000
            });
            // Buffer management
            if (frameQueue.length > 30) { 
                const old = frameQueue.shift();
                old.frame.close();
            }
        },
        error: (e) => {
            console.error('[WorkerV2] Decoder Error:', e);
            isConfigured = false;
        }
    });

    configureDecoder();
}

function configureDecoder() {
    try {
        // avc1.42E01E = Baseline 3.0
        // avc1.4D401F = Main 3.1
        decoder.configure({
            codec: 'avc1.42E01E', 
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware'
        });
        isConfigured = true;
    } catch (err) {
        console.error('[WorkerV2] Config Fail:', err);
    }
}

function decodeChunk(data, pts) {
    if (!isConfigured) return;

    try {
        // In Annex B stream, the first few bytes usually contain SPS/PPS
        // We treat every chunk as a potential keyframe because our FFmpeg GOP=1
        const chunk = new EncodedVideoChunk({
            type: (data[4] & 0x1f) === 7 || (data[4] & 0x1f) === 5 ? 'key' : 'key', // Force key for GOP=1
            timestamp: pts * 1000000,
            data: data
        });
        decoder.decode(chunk);
    } catch (err) {
        // silent error for partial chunks
    }
}

function renderLoop() {
    if (!ctx || frameQueue.length === 0) return;

    // Direct Sync logic
    let bestFrame = null;
    let bestIndex = -1;

    for (let i = 0; i < frameQueue.length; i++) {
        if (frameQueue[i].pts <= masterClock) {
            bestFrame = frameQueue[i].frame;
            bestIndex = i;
        } else {
            break;
        }
    }

    if (bestFrame) {
        ctx.drawImage(bestFrame, 0, 0, canvas.width, canvas.height);
        
        // Anti-Detection Noise (Bery subtle)
        if (Math.random() > 0.98) {
            ctx.fillStyle = 'rgba(0,0,0,0.01)';
            ctx.fillRect(0,0,1,1);
        }

        // Cleanup
        for (let j = 0; j <= bestIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestIndex + 1);
    }
}
