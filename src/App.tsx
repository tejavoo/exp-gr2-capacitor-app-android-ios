import { useEffect, useSyncExternalStore } from 'react';
import { useCameraStore } from './store/camera';
import type { PanelTab, Tab } from './store/camera';
import { TopBar } from './components/TopBar';
import { LiveView } from './components/LiveView';
import { ExposureBar } from './components/ExposureBar';
import { ShutterDock } from './components/ShutterDock';
import { SettingsPanel } from './components/SettingsPanel';
import { ButtonsPanel } from './components/ButtonsPanel';
import { Gallery } from './components/Gallery';
import { LogsViewer } from './components/LogsViewer';
import { ToastContainer } from './components/Toast';

const DESKTOP_QUERY = '(min-width: 1024px)';
function useIsDesktop() {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(DESKTOP_QUERY); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(DESKTOP_QUERY).matches,
  );
}

export default function App() {
  const status = useCameraStore(s => s.status);
  const model = useCameraStore(s => s.deviceInfo?.model);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    document.title = status === 'connected' ? `GR Remote · ${model ?? 'Connected'}` : 'GR Remote';
  }, [status, model]);

  useShortcuts(isDesktop);

  return (
    <div className="app-root h-screen-dvh flex flex-col safe-x" style={{ background: 'var(--color-cam-bg)' }}>
      <TopBar />
      {isDesktop ? <DesktopLayout /> : <MobileLayout />}
      <ToastContainer />
    </div>
  );
}

/* ───────────── Mobile / tablet: viewfinder on top, bottom tab bar ───────────── */

const MOBILE_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'shoot',    label: 'Shoot',    icon: <IconShoot /> },
  { id: 'settings', label: 'Settings', icon: <IconSliders /> },
  { id: 'buttons',  label: 'Buttons',  icon: <IconPad /> },
  { id: 'gallery',  label: 'Gallery',  icon: <IconGrid /> },
  { id: 'logs',     label: 'Logs',     icon: <IconList /> },
];

function MobileLayout() {
  const tab = useCameraStore(s => s.tab);
  const setTab = useCameraStore(s => s.setTab);
  const showViewfinder = tab === 'shoot' || tab === 'settings' || tab === 'buttons';

  return (
    <>
      {showViewfinder && (
        <div className="viewfinder-shell shrink-0 bg-black" style={{ height: 'min(66.7vw, 46vh)' }}>
          <LiveView />
        </div>
      )}

      <main className="flex-1 min-h-0 panel-scroll" style={{ background: 'var(--color-cam-bg)' }}>
        <div className="mx-auto max-w-2xl h-full">
          {tab === 'shoot' && <ExposureBar />}
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'buttons' && <ButtonsPanel />}
          {tab === 'gallery' && <Gallery />}
          {tab === 'logs' && <LogsViewer />}
        </div>
      </main>

      {showViewfinder && (
        <div className="shrink-0" style={{ background: 'var(--color-cam-surface)', borderTop: '1px solid var(--color-cam-border)' }}>
          <ShutterDock compact={tab !== 'shoot'} />
        </div>
      )}

      <nav className="shrink-0 safe-bottom" style={{ background: 'var(--color-cam-surface)', borderTop: '1px solid var(--color-cam-border)' }} aria-label="Sections">
        <div className="grid grid-cols-5 mx-auto max-w-2xl">
          {MOBILE_TABS.map(t => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex flex-col items-center justify-center gap-0.5 h-14 text-[10px] font-semibold"
                style={{ color: active ? 'var(--color-cam-accent)' : 'var(--color-cam-muted)' }}
                aria-current={active ? 'page' : undefined}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/* ───────────── Desktop: big viewfinder + controls, side panel ───────────── */

const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'buttons',  label: 'Buttons' },
  { id: 'gallery',  label: 'Gallery' },
  { id: 'logs',     label: 'Logs' },
];

function DesktopLayout() {
  const panel = useCameraStore(s => s.panel);
  const setPanel = useCameraStore(s => s.setPanel);

  return (
    <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
      <section className="min-h-0 flex flex-col">
        <div className="viewfinder-shell flex-1 min-h-0 p-4 pb-2" style={{ background: 'var(--color-cam-bg)' }}>
          <LiveView />
        </div>
        <div className="shrink-0 w-full" style={{ background: 'var(--color-cam-bg)' }}>
         <div className="mx-auto w-full max-w-4xl">
          <ExposureBar />
          <ShutterDock />
          <p className="text-center text-[11px] pb-2" style={{ color: 'var(--color-cam-dim)' }}>
            <kbd>Space</kbd> shoot · <kbd>F</kbd> focus lock · tap the viewfinder to focus there
          </p>
         </div>
        </div>
      </section>

      <aside className="min-h-0 flex flex-col" style={{ background: 'var(--color-cam-surface)', borderLeft: '1px solid var(--color-cam-border)' }}>
        <div className="shrink-0 p-2" style={{ borderBottom: '1px solid var(--color-cam-border)' }}>
          <div className="seg" role="tablist">
            {PANEL_TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={panel === t.id} data-active={panel === t.id} onClick={() => setPanel(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 panel-scroll">
          {panel === 'settings' && <SettingsPanel />}
          {panel === 'buttons' && <ButtonsPanel />}
          {panel === 'gallery' && <Gallery />}
          {panel === 'logs' && <LogsViewer />}
        </div>
      </aside>
    </div>
  );
}

/* ───────────── Keyboard shortcuts (desktop) ───────────── */

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest('input, select, textarea, [role="dialog"]')) return;
      const s = useCameraStore.getState();
      if (e.code === 'Space') { e.preventDefault(); void s.shoot(); }
      else if (e.key === 'f' || e.key === 'F') void s.toggleFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/* ───────────── Icons ───────────── */

function Svg({ children }: { children: React.ReactNode }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
}
function IconShoot()   { return <Svg><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M9 7l1.5-2h3L15 7" /></Svg>; }
function IconSliders() { return <Svg><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>; }
function IconPad()     { return <Svg><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></Svg>; }
function IconGrid()    { return <Svg><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>; }
function IconList()    { return <Svg><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>; }
