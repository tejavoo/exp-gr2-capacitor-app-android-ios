import { useEffect, useRef, useState } from 'react';
import { useCameraStore } from '../store/camera';
import type { ExposureField } from '../store/camera';
import { FIELD_LABEL, MODES, OPTIONS, formatValue, ignoredInMode, modeHint } from '../lib/exposure';

type Param = 'mode' | ExposureField;
const PARAMS: Param[] = ['mode', 'sv', 'av', 'tv', 'xv'];

export function ExposureBar() {
  const status = useCameraStore(s => s.status);
  const mode = useCameraStore(s => s.mode);
  const exposure = useCameraStore(s => s.exposure);
  const setMode = useCameraStore(s => s.setMode);
  const setExposure = useCameraStore(s => s.setExposure);
  const [param, setParam] = useState<Param>('mode');
  const disabled = status !== 'connected';

  const values: readonly string[] = param === 'mode' ? MODES : OPTIONS[param];
  const current = param === 'mode' ? mode : exposure[param];
  const ignored = param !== 'mode' && ignoredInMode(param, mode);

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [param, current]);

  const pick = (v: string) => {
    if (param === 'mode') void setMode(v);
    else void setExposure(param, v);
  };

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Parameter selector — shows current values */}
      <div className="grid grid-cols-5 gap-1.5 px-3">
        {PARAMS.map(p => {
          const isActive = p === param;
          const val = p === 'mode' ? (mode || '—') : formatValue(p, exposure[p]);
          const warn = p !== 'mode' && !!exposure[p] && ignoredInMode(p, mode);
          return (
            <button
              key={p}
              onClick={() => setParam(p)}
              className="flex flex-col items-center justify-center rounded-xl py-1.5 transition-colors"
              style={{
                background: isActive ? 'var(--color-cam-card)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--color-cam-accent)' : 'var(--color-cam-border)'}`,
                minHeight: 50,
              }}
              aria-pressed={isActive}
            >
              <span className="text-[10px] font-bold tracking-wider" style={{ color: isActive ? 'var(--color-cam-accent)' : 'var(--color-cam-dim)' }}>
                {p === 'mode' ? 'MODE' : FIELD_LABEL[p]}{warn ? ' ⚠' : ''}
              </span>
              <span className="text-[15px] font-bold tnum leading-tight" style={{ color: warn ? 'var(--color-cam-dim)' : 'var(--color-cam-text)' }}>
                {val}
              </span>
            </button>
          );
        })}
      </div>

      {/* Value strip */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto no-scrollbar px-3 py-0.5" style={{ scrollSnapType: 'x proximity' }}>
        {values.map(v => (
          <button
            key={v}
            className="chip"
            data-active={v === current}
            disabled={disabled}
            onClick={() => pick(v)}
            style={{ scrollSnapAlign: 'center' }}
          >
            {param === 'mode' ? v : param === 'av' ? `f/${v}` : formatValue(param, v)}
          </button>
        ))}
      </div>

      <p className="px-3 text-[11px] min-h-[16px]" style={{ color: ignored ? 'var(--color-cam-yellow)' : 'var(--color-cam-dim)' }}>
        {disabled
          ? 'Connect to change exposure.'
          : param === 'mode'
            ? (mode ? `Dial set to ${mode} from this app.` : 'Camera mode unknown — the API can’t read it. Pick one to sync.')
            : ignored
              ? modeHint(param, mode)
              : param === 'tv' ? 'T = time exposure: shutter opens on first tap, closes on second.' : ' '}
      </p>
    </div>
  );
}
