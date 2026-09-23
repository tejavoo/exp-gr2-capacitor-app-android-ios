import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { GrNet } from 'capacitor-gr-net';
import { useCameraStore } from '../store/camera';
import { grapi } from '../lib/grapi';
import { request } from '../lib/transport';
import { liveInfo } from '../lib/diag';
import { isNative, platform } from '../lib/platform';
import { logger } from '../lib/logger';
import { showToast } from './Toast';

interface Row { label: string; value: string; ok?: boolean }

const mark = (r: Row) => (r.ok === false ? '✗' : r.ok ? '✓' : '·');

async function runDiagnostics(status: string, device: { model: string; firmwareVersion: string } | null, onRows: (rows: Row[]) => void): Promise<Row[]> {
    const out: Row[] = [];
    const add = (r: Row) => { out.push(r); onRows([...out]); };

    add({ label: 'Platform', value: `${platform}${isNative ? ' (native app)' : ' (browser)'} · ${navigator.userAgent.match(/(Android [\d.]+|iPhone OS [\d_]+|Mac OS X [\d_]+)/)?.[0] ?? ''}` });

    if (isNative) {
      try {
        const w = await GrNet.getWifiStatus();
        add({
          label: 'Wi-Fi',
          value: `connected: ${w.wifiConnected}${w.platform === 'android' ? ` · pinned: ${w.bound} · internet: ${w.hasInternet}` : ''}`,
          ok: w.wifiConnected && (w.platform !== 'android' || w.bound),
        });
      } catch (e: any) {
        add({ label: 'Wi-Fi', value: e?.message || String(e), ok: false });
      }
    }

    if (status !== 'connected') {
      add({ label: 'Camera', value: 'Not connected — connect first for the camera checks', ok: false });
      return out;
    }
    add({ label: 'Camera', value: `${device?.model} · FW ${device?.firmwareVersion} · ${grapi.getConnectionInfo()}`, ok: true });

    // Ping latency (outside the command queue)
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try {
        const r = await request('GET', grapi.imageUrl('v1/ping'), undefined, 3000);
        if (r.status === 200) times.push(Math.round(performance.now() - t0));
      } catch { /* counted as lost */ }
    }
    times.sort((a, b) => a - b);
    add({
      label: 'Ping ×5',
      value: times.length ? `${times.length}/5 ok · min ${times[0]} ms · median ${times[Math.floor(times.length / 2)]} ms · max ${times[times.length - 1]} ms` : 'all lost',
      ok: times.length === 5,
    });

    // Live view (as observed by the viewfinder)
    add({
      label: 'Live view',
      value: liveInfo.renderer
        ? `${liveInfo.renderer} · ${liveInfo.contentType || 'content-type ?'} · mode ${liveInfo.mode || '?'} · ${liveInfo.fps} fps now / ${liveInfo.maxFps} max · ${liveInfo.width}×${liveInfo.height}${liveInfo.lastError ? ` · last error: ${liveInfo.lastError}` : ''}`
        : 'Open the Shoot tab for a few seconds first',
      ok: liveInfo.maxFps >= 10 ? true : liveInfo.renderer ? false : undefined,
    });

    // Can the web view load camera images directly? (decides the gallery path on iOS)
    const store = useCameraStore.getState();
    await store.loadGallery();
    const first = useCameraStore.getState().gallery.find(f => /\.jpe?g$/i.test(f.name));
    if (!first) {
      add({ label: 'Web view <img>', value: 'No JPEG on the card to test with' });
    } else {
      const url = grapi.imageUrl(`v1/photos/${first.dir}/${first.name}?size=thumb`);
      const t0 = performance.now();
      const ok = await new Promise<boolean>(resolve => {
        const img = new Image();
        const timer = setTimeout(() => resolve(false), 8000);
        img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = url;
      });
      add({
        label: 'Web view <img>',
        value: ok ? `loads camera images directly (${Math.round(performance.now() - t0)} ms)` : 'blocked — gallery uses the native download fallback',
        ok: ok || isNative,
      });

      if (isNative) {
        const t1 = performance.now();
        try {
          const r = await GrNet.download({ url: grapi.absoluteUrl(`v1/photos/${first.dir}/${first.name}?size=view`), fileName: 'diag_view.jpg', timeoutMs: 20000 });
          add({ label: 'Native download', value: `${(r.bytes / 1024).toFixed(0)} KB in ${Math.round(performance.now() - t1)} ms → ${Capacitor.convertFileSrc(r.path).slice(0, 40)}…`, ok: r.bytes > 0 });
        } catch (e: any) {
          add({ label: 'Native download', value: e?.message || String(e), ok: false });
        }
      }
    }

    return out;
}



/**
 * Device spike built into the app: answers the questions that can only be checked on a
 * real phone with a real camera (Wi-Fi binding, latency, stream type, web view image loads).
 */
export function Diagnostics() {
  const status = useCameraStore(s => s.status);
  const device = useCameraStore(s => s.deviceInfo);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out = await runDiagnostics(status, device, r => setRows(r));
    setRunning(false);
    logger.log(`Diagnostics:\n${out.map(r => `  ${mark(r)} ${r.label}: ${r.value}`).join('\n')}`);
  };

  const copy = () => {
    const text = rows.map(r => `${mark(r)} ${r.label}: ${r.value}`).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('Report copied', 'success'), () => showToast('Copy failed', 'error'));
  };

  return (
    <section className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-cam-card)', border: '1px solid var(--color-cam-border)' }}>
      <div className="flex items-center gap-2">
        <p className="label flex-1">Diagnostics</p>
        {rows.length > 0 && !running && <button className="btn" onClick={copy}>Copy report</button>}
        <button className="btn btn-primary" onClick={run} disabled={running}>{running ? 'Running…' : 'Run'}</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-cam-dim)' }}>
          Checks Wi-Fi binding, ping latency, live-view stream type &amp; fps, and how camera images load. Run it after a few seconds on the Shoot tab.
        </p>
      ) : (
        <ul className="space-y-1 text-[12px]">
          {rows.map(r => (
            <li key={r.label} className="flex gap-2">
              <span style={{ color: r.ok === false ? 'var(--color-cam-red)' : r.ok ? 'var(--color-cam-green)' : 'var(--color-cam-dim)' }}>
                {r.ok === false ? '✗' : r.ok ? '✓' : '·'}
              </span>
              <span className="font-semibold shrink-0" style={{ color: 'var(--color-cam-text)' }}>{r.label}</span>
              <span className="break-all" style={{ color: 'var(--color-cam-muted)' }}>{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
