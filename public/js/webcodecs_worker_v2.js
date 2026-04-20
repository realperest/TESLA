'use strict';

/**
 * WebCodecs Worker V2
 * Optimized for Tesla/Chromium - Autosize & Smooth Sync
 */

let canvas = null;
let ctx = null;
let decoder = null;
let frameQueue = [];
let masterClock = 0;
let isConfigured = false;
let lastWidth = 0;
let lastHeight = 0;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        canvas = payload.canvas;
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
            // AUTOSIZE: Canvas boyutunu gelen ilk kareye göre ayarla
            if (frame.displayWidth !== lastWidth || frame.displayHeight !== lastHeight) {
                lastWidth = frame.displayWidth;
                lastHeight = frame.displayHeight;
                canvas.width = lastWidth;
                canvas.height = lastHeight;
                console.log(`[WorkerV2] Resized to ${lastWidth}x${lastHeight}`);
            }

            frameQueue.push({
                frame: frame,
                pts: frame.timestamp / 1000000
            });
            
            if (frameQueue.length > 60) { 
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
        const chunk = new EncodedVideoChunk({
            type: (data[4] & 0x1f) === 7 || (data[4] & 0x1f) === 5 ? 'key' : 'key',
            timestamp: pts * 1000000,
            data: data
        });
        decoder.decode(chunk);
    } catch (err) {}
}

function renderLoop() {
    if (!ctx || frameQueue.length === 0) return;

    let bestFrame = null;
    let bestIndex = -1;

    // Bulunan karelerden masterClock'a en yakın olanı seç
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
        
        // Cleanup old frames
        for (let j = 0; j <= bestIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestIndex + 1);
    }
}
