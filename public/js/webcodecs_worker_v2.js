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
let lastTimestampUs = 0;
let spsNal = null;
let ppsNal = null;
let currentAuNals = [];
let currentAuHasVcl = false;
let currentAuHasIdr = false;
let currentAuPts = 0;

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
        pushNalToAccessUnit(nal, pts);
    }

    const tailStart = starts[starts.length - 1].index;
    annexBuffer = annexBuffer.slice(tailStart);
}

function pushNalToAccessUnit(nal, pts) {
    try {
        const prefixLen = getStartCodeLength(nal, 0);
        if (prefixLen === 0 || nal.length <= prefixLen) return;

        const unitType = nal[prefixLen] & 0x1f;
        if (unitType === 7) spsNal = nal;
        if (unitType === 8) ppsNal = nal;

        if (unitType === 9) {
            flushCurrentAccessUnit();
            currentAuPts = pts;
            currentAuNals.push(nal);
            return;
        }

        const isVcl = (unitType === 1 || unitType === 5);
        if (isVcl) {
            if (currentAuHasVcl) {
                flushCurrentAccessUnit();
            }
            if (!currentAuNals.length) currentAuPts = pts;

            if (unitType === 5) {
                if (spsNal) currentAuNals.push(spsNal);
                if (ppsNal) currentAuNals.push(ppsNal);
                currentAuHasIdr = true;
            }
            currentAuHasVcl = true;
            currentAuNals.push(nal);
            return;
        }

        if (!currentAuNals.length) currentAuPts = pts;
        currentAuNals.push(nal);
    } catch (err) {
        self.postMessage({ type: 'status', payload: { state: 'decode_error' } });
    }
}

function flushCurrentAccessUnit() {
    if (!currentAuHasVcl || currentAuNals.length === 0) {
        currentAuNals = [];
        currentAuHasVcl = false;
        currentAuHasIdr = false;
        return;
    }

    const au = concatMany(currentAuNals);
    const baseTs = Math.floor((currentAuPts || 0) * 1000000);
    const ts = baseTs <= lastTimestampUs ? (lastTimestampUs + 1) : baseTs;
    lastTimestampUs = ts;

    try {
        const chunk = new EncodedVideoChunk({
            type: currentAuHasIdr ? 'key' : 'delta',
            timestamp: ts,
            data: au
        });
        decoder.decode(chunk);
    } catch (err) {
        self.postMessage({ type: 'status', payload: { state: 'decode_error' } });
    }

    currentAuNals = [];
    currentAuHasVcl = false;
    currentAuHasIdr = false;
}

function findStartCodes(data) {
    const out = [];
    for (let i = 0; i < data.length - 3;) {
        const len = getStartCodeLength(data, i);
        if (len > 0) {
            out.push({ index: i });
            i += len; // 4-byte start code içinde tekrar 3-byte eşleşmeyi engelle
            continue;
        }
        i += 1;
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

function concatMany(arr) {
    let total = 0;
    for (let i = 0; i < arr.length; i++) total += arr[i].length;
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < arr.length; i++) {
        out.set(arr[i], off);
        off += arr[i].length;
    }
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
