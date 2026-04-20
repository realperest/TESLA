'use strict';

/**
 * WebCodecs Worker V2
 * - OffscreenCanvas Rendering
 * - WebCodecs VideoDecoder
 * - PTS-based Synchronization
 */

let canvas = null;
let ctx = null;
let decoder = null;
let frameQueue = [];
let masterClock = 0;
let isFirstFrame = true;

// NAL unit start pattern detection (Annex-B)
function findNALStart(buf, offset) {
    for (let i = offset; i < buf.length - 4; i++) {
        if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) return i;
        if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 1) return i;
    }
    return -1;
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        canvas = payload.canvas;
        ctx = canvas.getContext('2d');
        initDecoder();
        console.log('[WorkerV2] Initialized with OffscreenCanvas');
    } 
    else if (type === 'clock') {
        masterClock = payload.time;
        renderLoop();
    }
    else if (type === 'video') {
        // payload: ArrayBuffer [PTS(8) + DATA]
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
                pts: frame.timestamp / 1000000 // Convert micro to seconds
            });
            // Keep queue small (max 60 frames ~ 2 sec)
            if (frameQueue.length > 60) {
                const old = frameQueue.shift();
                old.frame.close();
            }
        },
        error: (e) => console.error('[WorkerV2] Decoder Error:', e)
    });

    // Tesla Browser typically supports H.264 Baseline/Main
    decoder.configure({
        codec: 'avc1.42E01E', // Baseline 3.0
        optimizeForLatency: true
    });
}

function decodeChunk(data, pts) {
    try {
        const chunk = new EncodedVideoChunk({
            type: isFirstFrame ? 'key' : 'delta',
            timestamp: pts * 1000000, // to microseconds
            data: data
        });
        decoder.decode(chunk);
        isFirstFrame = false;
    } catch (err) {
        // console.error('[WorkerV2] Decode fail:', err);
    }
}

function renderLoop() {
    if (!ctx || frameQueue.length === 0) return;

    // Find the best frame for current masterClock
    // We want the frame whose pts is closest to but not greater than masterClock
    let bestIndex = -1;
    for (let i = 0; i < frameQueue.length; i++) {
        if (frameQueue[i].pts <= masterClock) {
            bestIndex = i;
        } else {
            break;
        }
    }

    if (bestIndex !== -1) {
        const item = frameQueue[bestIndex];
        
        // Draw to OffscreenCanvas
        ctx.drawImage(item.frame, 0, 0, canvas.width, canvas.height);
        
        // Add subtle bypass noise (optional heuristic bypass)
        if (Math.random() > 0.99) {
            ctx.fillStyle = 'rgba(255,255,255,0.01)';
            ctx.fillRect(Math.random()*canvas.width, Math.random()*canvas.height, 1, 1);
        }

        // Clean up older frames
        for (let j = 0; j <= bestIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestIndex + 1);
    }
}
