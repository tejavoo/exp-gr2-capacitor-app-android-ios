import { useCameraStore } from '../store/camera';

export function ButtonsPanel() {
  const status = useCameraStore(s => s.status);
  const press = useCameraStore(s => s.pressKey);
  const source = useCameraStore(s => s.liveSource);
  const setSource = useCameraStore(s => s.setLiveSource);
  const disabled = status !== 'connected';

  const kp = { disabled, onPress: press };

  return (
    <div className="p-4 space-y-6">
      {source !== 'display' && !disabled && (
        <div className="flex items-center justify-between gap-3 rounded-xl p-3 text-xs"
          style={{ background: 'rgba(90,169,255,.08)', border: '1px solid rgba(90,169,255,.25)', color: 'var(--color-cam-muted)' }}>
          <span>Driving menus? Show the camera’s rear screen in the viewfinder.</span>
          <button className="btn" onClick={() => setSource('display')}>Show LCD</button>
        </div>
      )}

      <section className="flex flex-col items-center gap-3">
        <p className="label self-start">Cross keys</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 56px)', gridTemplateRows: 'repeat(3, 56px)' }}>
          <span /><Key {...kp} c="bup">▲</Key><span />
          <Key {...kp} c="bleft">◀</Key><Key {...kp} c="bok">OK</Key><Key {...kp} c="bright">▶</Key>
          <span /><Key {...kp} c="bdown">▼</Key><span />
        </div>
      </section>

      <section className="space-y-2">
        <p className="label">ADJ lever &amp; dial</p>
        <div className="grid grid-cols-5 gap-2">
          <Key {...kp} c="badjleft">ADJ ◀</Key>
          <Key {...kp} c="badjok">ADJ</Key>
          <Key {...kp} c="badjright">ADJ ▶</Key>
          <Key {...kp} c="bjogleft" title="Rear dial left">⟲</Key>
          <Key {...kp} c="bjogright" title="Rear dial right">⟳</Key>
        </div>
      </section>

      <section className="space-y-2">
        <p className="label">Body buttons</p>
        <div className="grid grid-cols-4 gap-2">
          <Key {...kp} c="bdisp">DISP</Key>
          <Key {...kp} c="beffect">EFFECT</Key>
          <Key {...kp} c="bplay">PLAY</Key>
          <Key {...kp} c="bwide" title="Zoom out (playback)">W</Key>
          <Key {...kp} c="btele" title="Zoom in (playback)">T</Key>
          <Key {...kp} c="bafc" title="AF lever → C-AF">C-AF</Key>
          <Key {...kp} c="bafl" title="AF lever → AFL">AFL</Key>
        </div>
      </section>
    </div>
  );
}

function Key({ c, children, title, disabled, onPress }: {
  c: string; children: React.ReactNode; title?: string; disabled: boolean; onPress: (c: string) => void;
}) {
  return (
    <button className="key" disabled={disabled} onClick={() => onPress(c)} title={title ?? `cmd=${c}`}>
      {children}
    </button>
  );
}
