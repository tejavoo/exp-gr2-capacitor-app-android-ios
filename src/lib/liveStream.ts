import { logger } from './logger';

export type StreamState = 'connecting' | 'streaming' | 'frames' | 'stalled' | 'error';

export interface StreamHandlers {
  onFrame: (frame: ImageBitmap) => void;
  onState: (state: StreamState, detail?: string) => void;
}

const STALL_MS = 4000;
const MAX_BUFFER = 4 * 1024 * 1024;
const HEADER_WINDOW = 256;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function findMarker(buf: Uint8Array, second: number, from: number): number {
  for (let i = Math.max(0, from); i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === second) return i;
  }
  return -1;
}

const latin1 = new TextDecoder('latin1');

// Content-Length from the multipart part headers just before the JPEG, if any.
function partLength(buf: Uint8Array, jpegStart: number): number {
  if (jpegStart < 16) return 0;
  const head = latin1.decode(buf.subarray(Math.max(0, jpegStart - HEADER_WINDOW), jpegStart));
  const blank = head.lastIndexOf('\r\n\r\n');
  if (blank < 0 || head.length - blank !== 4) return 0; // headers must end right before the JPEG
  const m = /content-length:\s*(\d+)/i.exec(head.slice(Math.max(0, head.lastIndexOf('--'))));
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n < MAX_BUFFER ? n : 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Incremental MJPEG frame splitter (same algorithm as the native plugins' MjpegParser).
 * Prefers the multipart part's Content-Length when its headers end exactly where the JPEG
 * starts; otherwise cuts on SOI (FF D8) … EOI (FF D9).
 */
export function createFrameSplitter() {
  let buf: Uint8Array = new Uint8Array(0);
  let start = -1;
  let scanFrom = 0;

  return {
    feed(chunk: Uint8Array, onFrame: (jpeg: Uint8Array) => void) {
      buf = concat(buf, chunk);
      for (;;) {
        if (start < 0) {
          start = findMarker(buf, 0xd8, scanFrom);
          if (start < 0) {
            // Keep a tail: FF D8 may straddle chunks, and the part headers (Content-Length)
            // preceding the next JPEG must survive until it arrives.
            buf = buf.slice(Math.max(0, buf.length - HEADER_WINDOW));
            scanFrom = Math.max(0, buf.length - 1);
            return;
          }
        }
        // An embedded EXIF thumbnail has its own FF D9, so Content-Length wins when present.
        const declared = partLength(buf, start);
        if (declared) {
          if (buf.length < start + declared) return;
          onFrame(buf.slice(start, start + declared));
          buf = buf.slice(start + declared);
          start = -1;
          scanFrom = 0;
          continue;
        }
        const end = findMarker(buf, 0xd9, Math.max(start + 2, scanFrom));
        if (end < 0) {
          scanFrom = Math.max(start + 2, buf.length - 1);
          if (buf.length > MAX_BUFFER) { buf = new Uint8Array(0); start = -1; scanFrom = 0; }
          return;
        }
        onFrame(buf.slice(start, end + 2));
        buf = buf.slice(end + 2);
        start = -1;
        scanFrom = 0;
      }
    },
  };
}

/**
 * Reads the camera's live view with fetch() and emits decoded frames.
 *
 * Works for both shapes the camera could send:
 *  - a continuous MJPEG / multipart stream (one long response, many JPEGs), and
 *  - a single JPEG per request (then requests are chained back-to-back, never overlapping).
 *
 * Frames are cut on JPEG SOI (FFD8) / EOI (FFD9) markers, so the multipart framing and
 * headers don't matter. Only the newest frame is decoded; stale ones are dropped so the
 * picture never lags behind the camera.
 */
export function startLiveStream(url: string, h: StreamHandlers): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let lastFrameAt = 0;
  let decoding = false;
  let pending: Uint8Array | null = null;
  let badFrames = 0;
  let mode: 'stream' | 'frames' = 'stream';
  let announced = false;

  const decode = async () => {
    if (decoding || !pending) return;
    decoding = true;
    const bytes = pending;
    pending = null;
    try {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
      if (stopped) bmp.close();
      else h.onFrame(bmp);
    } catch {
      if (++badFrames % 25 === 1) logger.warn(`Live view: ${badFrames} undecodable frame(s) skipped`);
    } finally {
      decoding = false;
      if (pending && !stopped) void decode();
    }
  };

  const push = (bytes: Uint8Array) => {
    lastFrameAt = performance.now();
    pending = bytes; // replaces any not-yet-decoded frame: always show the newest
    void decode();
  };

  // One HTTP request; returns how many frames it produced.
  const readOnce = async (): Promise<number> => {
    ctrl = new AbortController();
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!announced) {
      announced = true;
      logger.log(`Live view: ${res.headers.get('content-type') || 'unknown content-type'}`);
    }
    if (!res.body) {
      push(new Uint8Array(await res.arrayBuffer()));
      return 1;
    }

    const reader = res.body.getReader();
    const splitter = createFrameSplitter();
    let frames = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done || stopped) break;
      splitter.feed(value, jpeg => {
        frames++;
        if (frames === 1 && mode === 'stream') h.onState('streaming');
        push(jpeg);
      });
    }
    return frames;
  };

  const watchdog = setInterval(() => {
    if (mode === 'stream' && lastFrameAt && performance.now() - lastFrameAt > STALL_MS) {
      logger.warn('Live view stalled — reopening stream');
      h.onState('stalled');
      lastFrameAt = 0;
      ctrl?.abort();
    }
  }, 1000);

  const onVisibility = () => { if (document.hidden) ctrl?.abort(); };
  document.addEventListener('visibilitychange', onVisibility);

  (async () => {
    let failures = 0;
    h.onState('connecting');
    while (!stopped) {
      if (document.hidden) { await sleep(500); continue; }
      try {
        const frames = await readOnce();
        failures = 0;
        if (stopped) break;
        if (mode === 'stream' && frames <= 1) {
          mode = 'frames';
          logger.log('Live view: camera sends one image per request — chaining requests');
          h.onState('frames');
        } else if (mode === 'stream') {
          await sleep(250); // stream ended cleanly; reopen
        }
      } catch (err: any) {
        if (stopped) break;
        if (err?.name === 'AbortError') continue;
        failures++;
        const wait = Math.min(500 * 2 ** failures, 5000);
        h.onState('error', err?.message || String(err));
        if (failures === 1 || failures % 5 === 0) logger.warn(`Live view error (${failures}): ${err?.message || err} — retry in ${wait}ms`);
        await sleep(wait);
      }
    }
  })();

  return () => {
    stopped = true;
    clearInterval(watchdog);
    document.removeEventListener('visibilitychange', onVisibility);
    ctrl?.abort();
  };
}
