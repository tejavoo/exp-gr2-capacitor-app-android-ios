import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GrMjpeg } from 'capacitor-gr-mjpeg';
import type { PluginListenerHandle } from '@capacitor/core';
import { useCameraStore } from '../store/camera';
import { grapi } from '../lib/grapi';
import { startLiveStream } from '../lib/liveStream';
import { formatValue } from '../lib/exposure';
import { isNative } from '../lib/platform';
import { logger } from '../lib/logger';
import { recordLive } from '../lib/diag';

type ViewState = 'connecting' | 'streaming' | 'frames' | 'stalled' | 'error';

const DEFAULT_RATIO = 3 / 2;

// Largest ratio-correct rectangle that fits in the container.
function useFit(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const w = Math.min(W, H * ratio);
      setSize({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return { ref, size };
}

export function LiveView({ active = true }: { active?: boolean }) {
  const status = useCameraStore(s => s.status);
  const connect = useCameraStore(s => s.connect);
  const focusAt = useCameraStore(s => s.focusAt);
  const source = useCameraStore(s => s.liveSource);
  const mode = useCameraStore(s => s.mode);
  const exposure = useCameraStore(s => s.exposure);
  const focusLocked = useCameraStore(s => s.focusLocked);
  const shutterHeld = useCameraStore(s => s.shutterHeld);
  const isShooting = useCameraStore(s => s.isShooting);

  const connected = status === 'connected';
  const path = source === 'display' ? 'v1/display' : 'v1/liveview';
  // native: GrMjpeg layer under the web view · canvas: browser via dev proxy · img: browser, direct mode
  const renderer = !connected ? 'none' : isNative ? 'native' : grapi.isProxied() ? 'canvas' : 'img';

  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const { ref: boxRef, size } = useFit(ratio);
  const pictureRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ViewState>('connecting');
  const [fps, setFps] = useState(0);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [imgKey, setImgKey] = useState(0);
  const nativeStarted = useRef(false);

  // ── Browser: fetch + canvas ──
  useEffect(() => {
    if (renderer !== 'canvas' || !active) return;
    let latest: ImageBitmap | null = null;
    let raf = 0;
    let frames = 0;
    let lastRatio = 0;

    const draw = () => {
      raf = 0;
      const c = canvasRef.current;
      const bmp = latest;
      if (!c || !bmp) return;
      latest = null;
      if (c.width !== bmp.width || c.height !== bmp.height) {
        c.width = bmp.width;
        c.height = bmp.height;
      }
      const r = bmp.width / bmp.height;
      c.getContext('2d')?.drawImage(bmp, 0, 0);
      bmp.close();
      frames++;
      if (Math.abs(r - lastRatio) > 0.01) { lastRatio = r; setRatio(r); }
    };

    const stop = startLiveStream(grapi.imageUrl(path), {
      onFrame: bmp => {
        latest?.close();
        latest = bmp;
        if (!raf) raf = requestAnimationFrame(draw);
      },
      onState: s => { setState(s); if (s === 'frames') recordLive({ mode: 'frames' }); else if (s === 'streaming') recordLive({ mode: 'stream' }); },
    });
    recordLive({ renderer: 'canvas' });
    const fpsTimer = setInterval(() => { setFps(frames); recordLive({ fps: frames }); frames = 0; }, 1000);

    return () => {
      stop();
      clearInterval(fpsTimer);
      if (raf) cancelAnimationFrame(raf);
      latest?.close();
      setFps(0);
      setState('connecting');
    };
  }, [renderer, active, path]);

  // ── Native: GrMjpeg plugin draws under the transparent web view ──
  useEffect(() => {
    if (renderer !== 'native' || !active) return;
    const el = pictureRef.current;
    if (!el) return;
    let loggedType = false;

    const handles: Promise<PluginListenerHandle>[] = [
      GrMjpeg.addListener('state', e => {
        if (e.state === 'paused' || e.state === 'stopped') return;
        setState(e.state);
        if (e.state === 'error') recordLive({ lastError: e.message ?? 'error' });
        if (e.state === 'error' || e.state === 'stalled' || e.state === 'frames') logger.warn(`Live view (native): ${e.state}${e.message ? ` — ${e.message}` : ''}`);
      }),
      GrMjpeg.addListener('stats', e => {
        setFps(e.fps);
        if (e.contentType && !loggedType) { loggedType = true; logger.log(`Live view (native): ${e.contentType} · ${e.mode}`); }
        recordLive({ renderer: 'native', fps: e.fps, contentType: e.contentType, mode: e.mode, width: e.width, height: e.height });
        if (e.width && e.height) setRatio(r => (Math.abs(r - e.width / e.height) > 0.01 ? e.width / e.height : r));
      }),
    ];

    const toRect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    let last = toRect();

    document.documentElement.classList.add('native-live');
    nativeStarted.current = false;
    GrMjpeg.start({
      url: grapi.absoluteUrl(useCameraStore.getState().liveSource === 'display' ? 'v1/display' : 'v1/liveview'),
      rect: last,
      stallTimeoutMs: 4000,
      backgroundColor: '#000000',
    }).then(() => { nativeStarted.current = true; })
      .catch(err => logger.error('Native live view failed to start', err));

    // Follow the layout every frame (position can change without a resize, e.g. a banner appears).
    let raf = requestAnimationFrame(function track() {
      const r = toRect();
      if (Math.abs(r.x - last.x) > 0.5 || Math.abs(r.y - last.y) > 0.5 ||
          Math.abs(r.width - last.width) > 0.5 || Math.abs(r.height - last.height) > 0.5) {
        last = r;
        void GrMjpeg.setRect(r).catch(() => {});
      }
      raf = requestAnimationFrame(track);
    });

    return () => {
      cancelAnimationFrame(raf);
      nativeStarted.current = false;
      document.documentElement.classList.remove('native-live');
      void GrMjpeg.stop().catch(() => {});
      handles.forEach(h => void h.then(x => x.remove()));
      setFps(0);
      setState('connecting');
    };
  }, [renderer, active]);

  // Switch LV ↔ LCD without tearing down the native view.
  useEffect(() => {
    if (renderer !== 'native' || !nativeStarted.current) return;
    void GrMjpeg.setUrl({ url: grapi.absoluteUrl(path) }).catch(() => {});
  }, [renderer, path]);

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!connected || source !== 'liveview') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (px < 0 || px > 1 || py < 0 || py > 1) return;
    setFocusPoint({ x: px * 100, y: py * 100 });
    setTimeout(() => setFocusPoint(null), 1200);
    void focusAt(Math.round(px * 100), Math.round(py * 100));
  };

  const readout = [
    exposure.sv && `ISO ${formatValue('sv', exposure.sv)}`,
    exposure.av && `F${exposure.av}`,
    exposure.tv && formatValue('tv', exposure.tv),
    exposure.xv && exposure.xv !== '0.0' && `${exposure.xv} EV`,
  ].filter(Boolean) as string[];

  const transparent = renderer === 'native';
  const showFps = renderer === 'canvas' || renderer === 'native';

  return (
    <div ref={boxRef} className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: transparent ? 'transparent' : '#000' }}>
      <div
        ref={pictureRef}
        className="relative overflow-hidden select-none"
        style={{
          width: size.w || '100%',
          height: size.h || '100%',
          background: transparent ? 'transparent' : '#050505',
          cursor: connected && source === 'liveview' ? 'crosshair' : 'default',
          borderRadius: transparent ? 0 : 4,
        }}
        onClick={handleTap}
      >
        {!connected ? (
          <Placeholder status={status} onConnect={connect} />
        ) : renderer === 'canvas' ? (
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ objectFit: 'contain' }} />
        ) : renderer === 'img' ? (
          <img
            key={`${path}-${imgKey}`}
            src={active ? grapi.imageUrl(path) : ''}
            alt="Live view"
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain"
            onError={() => setTimeout(() => setImgKey(k => k + 1), 2000)}
          />
        ) : null}

        {connected && (
          <>
            <div className="pointer-events-none absolute inset-0" style={{
              backgroundImage: 'linear-gradient(to right, transparent calc(33.33% - .5px), rgba(255,255,255,.12) calc(33.33% - .5px), rgba(255,255,255,.12) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.12) calc(66.66% - .5px), rgba(255,255,255,.12) calc(66.66% + .5px), transparent calc(66.66% + .5px)), linear-gradient(to bottom, transparent calc(33.33% - .5px), rgba(255,255,255,.12) calc(33.33% - .5px), rgba(255,255,255,.12) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.12) calc(66.66% - .5px), rgba(255,255,255,.12) calc(66.66% + .5px), transparent calc(66.66% + .5px))',
            }} />

            <div className="hud pointer-events-none absolute top-0 inset-x-0 flex items-start justify-between p-2 text-[11px] font-bold tnum">
              <div className="flex gap-1.5">
                {mode && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}>{mode}</span>}
                {focusLocked && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(62,207,110,.85)', color: '#000' }}>AF-L</span>}
                {source === 'display' && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(90,169,255,.85)', color: '#000' }}>LCD</span>}
              </div>
              {showFps && (
                <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,.55)', color: stateColor(state, fps) }}>
                  {stateLabel(state, fps)}
                </span>
              )}
            </div>

            {readout.length > 0 && (
              <div className="hud pointer-events-none absolute bottom-0 inset-x-0 flex justify-center gap-3 px-2 py-1.5 text-[12px] font-bold tnum"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,.65), transparent)', color: '#fff' }}>
                {readout.map(r => <span key={r}>{r}</span>)}
              </div>
            )}

            {shutterHeld && (
              <div className="pointer-events-none absolute top-9 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[11px] font-bold held-pulse"
                style={{ background: 'rgba(255,77,79,.9)', color: '#fff' }}>
                ● SHUTTER OPEN
              </div>
            )}

            {focusPoint && (
              <div className="pointer-events-none absolute focus-indicator" style={{ left: `${focusPoint.x}%`, top: `${focusPoint.y}%`, width: 60, height: 60 }}>
                <svg viewBox="0 0 60 60" className="w-full h-full">
                  {[[2, 16, 2, 2, 16, 2], [44, 2, 58, 2, 58, 16], [2, 44, 2, 58, 16, 58], [44, 58, 58, 58, 58, 44]].map((p, i) => (
                    <polyline key={i} points={`${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`} fill="none" stroke="#3ecf6e" strokeWidth="3" />
                  ))}
                </svg>
              </div>
            )}

            {isShooting && <div className="pointer-events-none absolute inset-0 capture-flash" style={{ background: '#fff' }} />}
          </>
        )}
      </div>
    </div>
  );
}

function stateLabel(s: ViewState, fps: number) {
  if (s === 'streaming' || s === 'frames') return `${fps} fps`;
  if (s === 'stalled') return 'reconnecting…';
  if (s === 'error') return 'retrying…';
  return 'connecting…';
}
function stateColor(s: ViewState, fps: number) {
  if (s === 'error' || s === 'stalled') return '#ff8a8a';
  if (s === 'connecting') return '#ccc';
  return fps >= 10 ? '#7ee2a0' : fps >= 5 ? '#f0d479' : '#ff8a8a';
}

function Placeholder({ status, onConnect }: { status: string; onConnect: () => void }) {
  const busy = status === 'discovering';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center" onClick={e => e.stopPropagation()}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-cam-dim)" strokeWidth="1.5">
        <rect x="2" y="6" width="20" height="14" rx="2" /><circle cx="12" cy="13" r="4" /><path d="M8 6l1.5-2h5L16 6" />
      </svg>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-cam-text)' }}>
          {busy ? 'Looking for the camera…' : 'Viewfinder offline'}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-cam-muted)' }}>
          Join the GR II Wi-Fi, then connect.
        </p>
      </div>
      <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  );
}
