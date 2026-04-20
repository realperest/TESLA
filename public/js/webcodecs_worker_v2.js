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
let annexBuffer = new Uint8Array(0);
let seenSps = false;
let seenPps = false;
let hasStartedDecoding = false;
let lastTimestampUs = 0;

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
        decodeAnnexB(data, pts);
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

function decodeAnnexB(data, pts) {
    if (!isConfigured) return;
    annexBuffer = concatBytes(annexBuffer, data);

    const starts = findStartCodes(annexBuffer);
    if (starts.length < 2) {
        if (annexBuffer.length > 2 * 1024 * 1024) {
            annexBuffer = annexBuffer.slice(-512 * 1024);
        }
        return;
    }

    for (let i = 0; i < starts.length - 1; i++) {
        const start = starts[i].index;
        const end = starts[i + 1].index;
        const nal = annexBuffer.slice(start, end);
        decodeNal(nal, pts);
    }

    const tailStart = starts[starts.length - 1].index;
    annexBuffer = annexBuffer.slice(tailStart);
}

function decodeNal(nal, pts) {
    try {
        const prefixLen = getStartCodeLength(nal, 0);
        if (prefixLen === 0 || nal.length <= prefixLen) return;

        const unitType = nal[prefixLen] & 0x1f;
        if (unitType === 7) seenSps = true;
        if (unitType === 8) seenPps = true;

        if (unitType === 5) hasStartedDecoding = true;
        if (!seenSps || !seenPps) return;
        if (!hasStartedDecoding && unitType !== 5) return;

        const baseTs = Math.floor(pts * 1000000);
        const ts = baseTs <= lastTimestampUs ? (lastTimestampUs + 1) : baseTs;
        lastTimestampUs = ts;

        const chunk = new EncodedVideoChunk({
            type: unitType === 5 ? 'key' : 'delta',
            timestamp: ts,
            data: nal
        });
        decoder.decode(chunk);
    } catch (err) {
        // decoder'a bozuk nal yollamamak için yutuyoruz
    }
}

function findStartCodes(data) {
    const out = [];
    for (let i = 0; i < data.length - 3; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            out.push({ index: i });
        } else if (i < data.length - 4 && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
            out.push({ index: i });
        }
    }
    return out;
}

function getStartCodeLength(data, idx) {
    if (idx + 3 < data.length && data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 0 && data[idx + 3] === 1) return 4;
    if (idx + 2 < data.length && data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 1) return 3;
    return 0;
}

function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
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
        self.postMessage({ type: 'status', payload: { state: 'healthy', pts: item.pts } });

        for (let j = 0; j <= bestFrameIndex; j++) {
            frameQueue[j].frame.close();
        }
        frameQueue.splice(0, bestFrameIndex + 1);
    }
}
