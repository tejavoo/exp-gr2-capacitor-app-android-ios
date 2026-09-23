import { useCameraStore } from '../store/camera';

export function ShutterDock({ compact = false }: { compact?: boolean }) {
  const status = useCameraStore(s => s.status);
  const shoot = useCameraStore(s => s.shoot);
  const isShooting = useCameraStore(s => s.isShooting);
  const held = useCameraStore(s => s.shutterHeld);
  const focusLocked = useCameraStore(s => s.focusLocked);
  const toggleFocus = useCameraStore(s => s.toggleFocus);
  const source = useCameraStore(s => s.liveSource);
  const setSource = useCameraStore(s => s.setLiveSource);
  const disabled = status !== 'connected';
  const size = compact ? 64 : 76;

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-2.5 mx-auto w-full max-w-sm">
      <SideButton
        label="AF-L"
        sub={focusLocked ? 'locked' : 'focus'}
        active={focusLocked}
        activeColor="var(--color-cam-green)"
        disabled={disabled || held}
        onClick={toggleFocus}
        title="Half-press: lock / unlock focus (F)"
      />

      <button
        onClick={shoot}
        disabled={disabled || isShooting}
        aria-label={held ? 'Stop exposure' : 'Take picture'}
        title={held ? 'Stop (shoot/finish)' : 'Shoot (Space)'}
        className={`relative rounded-full flex items-center justify-center transition-transform active:scale-95 ${isShooting ? 'shutter-active' : ''}`}
        style={{
          width: size, height: size,
          border: '4px solid rgba(255,255,255,.9)',
          background: 'transparent',
          opacity: disabled ? 0.35 : 1,
        }}
      >
        <span
          className={held ? 'held-pulse' : ''}
          style={{
            width: held ? size * 0.36 : size - 16,
            height: held ? size * 0.36 : size - 16,
            borderRadius: held ? 6 : '50%',
            background: held ? 'var(--color-cam-red)' : 'var(--color-cam-accent)',
            transition: 'all .18s ease',
          }}
        />
      </button>

      <SideButton
        label={source === 'display' ? 'LCD' : 'LV'}
        sub={source === 'display' ? 'screen' : 'viewfinder'}
        active={source === 'display'}
        activeColor="var(--color-cam-blue)"
        disabled={disabled}
        onClick={() => setSource(source === 'display' ? 'liveview' : 'display')}
        title="Switch between live view and the camera's rear screen (for menu navigation)"
      />
    </div>
  );
}

function SideButton({ label, sub, active, activeColor, disabled, onClick, title }: {
  label: string; sub: string; active: boolean; activeColor: string; disabled: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-col items-center justify-center rounded-2xl transition-colors"
      style={{
        width: 64, height: 52,
        background: active ? activeColor : 'var(--color-cam-card)',
        color: active ? '#000' : 'var(--color-cam-text)',
        border: `1px solid ${active ? activeColor : 'var(--color-cam-border)'}`,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <span className="text-[13px] font-extrabold tracking-wide">{label}</span>
      <span className="text-[10px] font-medium" style={{ opacity: 0.7 }}>{sub}</span>
    </button>
  );
}
