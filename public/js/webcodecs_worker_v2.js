'use strict';

/**
 * WebCodecs Worker V2
 * Hard-Sync (10ms) & Full Buffer Contol
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
            
            // Limit buffer
            if (frameQueue.length > 90) { // Keep up to 3s buffer
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
    } catch (err) {}
}

function decodeChunk(data, pts) {
    if (!isConfigured) return;
    try {
        // Find NAL unit type to determine if it's a keyframe
        // 0x07 = SPS, 0x05 = IDR
        const unitType = data[4] & 0x1f;
        const isKey = (unitType === 7 || unitType === 5);

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

    // UNDERFLOW CONTROL: Eğer görüntü biterse ana thread'e pause sinyali gönder
    if (frameQueue.length === 0) {
        self.postMessage({ type: 'status', payload: 'underflow' });
        return;
    }

    let bestFrameIndex = -1;

    // 10ms Hard Sync
    for (let i = 0; i < frameQueue.length; i++) {
        if (frameQueue[i].pts <= masterClock + 0.01) {
            bestFrameIndex = i;
        } else {
            break;
        }
    }

    if (bestFrameIndex !== -1) {
        const item = frameQueue[bestFrameIndex];
        ctx.drawImage(item.frame, 0, 0, canvas.width, canvas.height);

        // Notify main thread that we are healthy
        self.postMessage({ type: 'status', payload: 'healthy' });

        for (let j = 0; j <= bestFrameIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestFrameIndex + 1);
    }
}
