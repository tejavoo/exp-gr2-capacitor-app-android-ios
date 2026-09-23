import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { GrNet } from 'capacitor-gr-net';
import { useCameraStore } from '../store/camera';
import type { GalleryFile } from '../store/camera';
import { grapi } from '../lib/grapi';
import { isNative } from '../lib/platform';
import { logger } from '../lib/logger';
import { showToast } from './Toast';

const PAGE = 120;

const isJpeg = (f: GalleryFile) => /\.jpe?g$/i.test(f.name);
const photoPath = (f: GalleryFile, size: 'thumb' | 'view' | 'full') =>
  `v1/photos/${f.dir}/${f.name}?size=${size === 'thumb' && (!f.hasThumb || !isJpeg(f)) ? 'view' : size}`;
const photoUrl = (f: GalleryFile, size: 'thumb' | 'view' | 'full') => grapi.imageUrl(photoPath(f, size));

// Native fallback when the web view can't load camera images directly:
// download into the app cache natively (max 4 at a time) and show the local file.
const nativeCache = new Map<string, Promise<string>>();
let active = 0;
const waiting: (() => void)[] = [];
async function nativeImage(f: GalleryFile, size: 'thumb' | 'view'): Promise<string> {
  const key = `${f.dir}/${f.name}/${size}`;
  const hit = nativeCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    if (active >= 4) await new Promise<void>(r => waiting.push(r));
    active++;
    try {
      const res = await GrNet.download({
        url: grapi.absoluteUrl(photoPath(f, size)),
        fileName: `${size}_${f.dir}_${f.name.replace(/\.(dng|mov)$/i, '.jpg')}`,
        timeoutMs: 30_000,
      });
      return Capacitor.convertFileSrc(res.path);
    } finally {
      active--;
      waiting.shift()?.();
    }
  })();
  nativeCache.set(key, job);
  job.catch(() => nativeCache.delete(key));
  return job;
}

function CameraImage({ file, size, className, alt }: { file: GalleryFile; size: 'thumb' | 'view'; className: string; alt: string }) {
  const [src, setSrc] = useState(() => photoUrl(file, size));
  const [failed, setFailed] = useState(false);
  const triedNative = useRef(false);

  const onError = () => {
    if (isNative && !triedNative.current) {
      triedNative.current = true;
      nativeImage(file, size).then(setSrc).catch(err => {
        logger.warn(`Image ${file.name} (${size}) failed: ${err?.message || err}`);
        setFailed(true);
      });
    } else {
      setFailed(true);
    }
  };

  if (failed) return <div className={className} style={{ background: 'var(--color-cam-card)' }} />;
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={className} onError={onError} />;
}

export function Gallery() {
  const status = useCameraStore(s => s.status);
  const files = useCameraStore(s => s.gallery);
  const state = useCameraStore(s => s.galleryState);
  const load = useCameraStore(s => s.loadGallery);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { if (status === 'connected') void load(); }, [status, load]);

  if (status !== 'connected') {
    return <Empty text="Connect to the camera to browse photos." />;
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="label">{state === 'loaded' ? `${files.length} files · newest first` : 'Photos'}</p>
        <button className="btn btn-ghost" onClick={() => load(true)} disabled={state === 'loading'}>
          {state === 'loading' ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {state === 'loading' && files.length === 0 && (
        <Empty text="Reading the card… large cards take a few seconds." />
      )}
      {state === 'loaded' && files.length === 0 && <Empty text="No photos on the card." />}
      {state === 'error' && <Empty text="Couldn’t read the file list." />}

      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
        {files.slice(0, shown).map((f, i) => (
          <button
            key={`${f.dir}/${f.name}`}
            onClick={() => setOpen(i)}
            className="relative aspect-square overflow-hidden rounded-md group"
            style={{ background: 'var(--color-cam-card)' }}
            title={`${f.name} · ${f.date}`}
          >
            <CameraImage file={f} size="thumb" alt={f.name} className="w-full h-full object-cover transition-opacity group-hover:opacity-80" />
            {!isJpeg(f) && (
              <span className="absolute bottom-1 right-1 px-1 rounded text-[9px] font-bold" style={{ background: 'rgba(0,0,0,.7)', color: '#fff' }}>
                {f.name.split('.').pop()}
              </span>
            )}
          </button>
        ))}
      </div>

      {files.length > shown && (
        <div className="flex justify-center mt-3">
          <button className="btn" onClick={() => setShown(n => n + PAGE)}>Show more ({files.length - shown} left)</button>
        </div>
      )}

      {open !== null && files[open] && (
        <Lightbox files={files} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Lightbox({ files, index, onIndex, onClose }: {
  files: GalleryFile[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const f = files[index];
  const touchX = useRef<number | null>(null);
  const go = (d: number) => onIndex(Math.min(files.length - 1, Math.max(0, index + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const download = async (size: 'view' | 'full') => {
    if (isNative) {
      showToast(size === 'full' ? `Saving ${f.name}…` : 'Saving preview…', 'info', 2000);
      try {
        const res = await GrNet.download({
          url: grapi.absoluteUrl(photoPath(f, size)),
          fileName: size === 'full' ? f.name : `VGA_${f.name.replace(/\.(dng|mov)$/i, '.jpg')}`,
          saveToGallery: true,
        });
        const mb = (res.bytes / 1048576).toFixed(1);
        if (res.savedToGallery) showToast(`Saved to ${Capacitor.getPlatform() === 'ios' ? 'Photos' : 'Gallery'} (${mb} MB)`, 'success');
        else showToast(`Downloaded (${mb} MB) — ${res.galleryMessage ?? 'not added to gallery'}`, 'warning', 5000);
      } catch (err: any) {
        showToast(err?.message || 'Download failed', 'error');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = photoUrl(f, size);
    a.download = f.name;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    showToast(size === 'full' ? `Downloading ${f.name}` : 'Downloading preview', 'info', 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col safe-top safe-bottom" style={{ background: 'rgba(0,0,0,.96)' }} role="dialog" aria-modal="true" aria-label={f.name}>
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{f.name}</p>
          <p className="text-[11px] tnum" style={{ color: 'var(--color-cam-muted)' }}>
            {f.dir} · {f.date.replace('T', ' ')} · {index + 1}/{files.length}
          </p>
        </div>
        <button className="btn" onClick={() => download('view')}>{isNative ? 'Save VGA' : 'VGA'}</button>
        <button className="btn btn-primary" onClick={() => download('full')}>{isNative ? 'Save original' : 'Original'}</button>
      </div>

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        <CameraImage key={`${f.dir}/${f.name}`} file={f} size="view" alt={f.name} className="max-w-full max-h-full object-contain" />
        {index > 0 && <NavArrow side="left" onClick={() => go(-1)} />}
        {index < files.length - 1 && <NavArrow side="right" onClick={() => go(1)} />}
      </div>
    </div>
  );
}

function NavArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      className="absolute top-1/2 -translate-y-1/2 hidden md:flex items-center justify-center rounded-full"
      style={{ [side]: 16, width: 44, height: 44, background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: 20 }}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-center py-12 px-4" style={{ color: 'var(--color-cam-muted)' }}>{text}</p>;
}
