'use strict';

/**
 * WebCodecs Worker V2
 * Dynamic NAL Detection & Atomic Start
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
            if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
            }

            frameQueue.push({
                frame: frame,
                pts: frame.timestamp / 1000000
            });
            
            if (frameQueue.length > 90) { 
                const old = frameQueue.shift();
                old.frame.close();
            }
        },
        error: (e) => console.error('[WorkerV2] Decoder Error:', e)
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
        console.log('[WorkerV2] Decoder Configured');
    } catch (err) {
        console.error('[WorkerV2] Config Fail:', err);
    }
}

function decodeChunk(data, pts) {
    if (!isConfigured) return;
    try {
        // DYNAMIC NAL DETECTION
        // Start code can be 3 or 4 bytes: 00 00 01 or 00 00 00 01
        let headerOffset = 0;
        if (data[0] === 0 && data[1] === 0 && data[2] === 1) headerOffset = 3;
        else if (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) headerOffset = 4;
        
        if (headerOffset === 0) return; // Not a valid NAL unit

        const unitType = data[headerOffset] & 0x1f;
        // Types: 7=SPS, 8=PPS, 5=IDR (Key), 1=Coded slice (Non-key)
        const isKey = (unitType === 7 || unitType === 8 || unitType === 5);

        const chunk = new EncodedVideoChunk({
            type: isKey ? 'key' : 'delta',
            timestamp: pts * 1000000,
            data: data
        });
        decoder.decode(chunk);
    } catch (err) {}
}

function renderLoop() {
    if (!ctx) return;

    if (frameQueue.length === 0) {
        self.postMessage({ type: 'status', payload: 'underflow' });
        return;
    }

    let bestFrameIndex = -1;
    for (let i = 0; i < frameQueue.length; i++) {
        if (frameQueue[i].pts <= masterClock + 0.02) {
            bestFrameIndex = i;
        } else {
            break;
        }
    }

    if (bestFrameIndex !== -1) {
        const item = frameQueue[bestFrameIndex];
        ctx.drawImage(item.frame, 0, 0, canvas.width, canvas.height);
        self.postMessage({ type: 'status', payload: 'healthy' });

        for (let j = 0; j <= bestFrameIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestFrameIndex + 1);
    }
}
