import { useEffect, useState } from 'react';
import { useCameraStore } from '../store/camera';
import { GrNet } from 'capacitor-gr-net';
import type { WifiStatus } from 'capacitor-gr-net';
import { grapi } from '../lib/grapi';
import { isNative, platform } from '../lib/platform';
import { showToast } from './Toast';

export function TopBar() {
  const status = useCameraStore(s => s.status);
  const error = useCameraStore(s => s.error);
  const device = useCameraStore(s => s.deviceInfo);
  const battery = useCameraStore(s => s.batteryLevel);
  const connect = useCameraStore(s => s.connect);
  const disconnect = useCameraStore(s => s.disconnect);
  const [menu, setMenu] = useState(false);

  const connected = status === 'connected';
  const busy = status === 'discovering';

  return (
    <>
      <header className="safe-top shrink-0 z-20" style={{ background: 'var(--color-cam-surface)', borderBottom: '1px solid var(--color-cam-border)' }}>
        <div className="flex items-center gap-2 h-12 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <Logo />
            <span className="font-bold tracking-tight text-[15px] hidden sm:inline">GR Remote</span>
          </div>

          <StatusPill status={status} model={device?.model} />

          {connected && (
            <div className="hidden md:flex items-center gap-3 text-xs tnum" style={{ color: 'var(--color-cam-muted)' }}>
              <span>FW {device?.firmwareVersion}</span>
              <span>{grapi.getConnectionInfo()}</span>
            </div>
          )}

          <div className="flex-1" />

          {connected && battery && <Battery level={battery} />}

          {connected ? (
            <button className="btn" onClick={disconnect}>Disconnect</button>
          ) : (
            <button className="btn btn-primary" onClick={() => connect()} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}

          <button className="btn btn-ghost" style={{ minWidth: 36, padding: 0 }} onClick={() => setMenu(true)} aria-label="Menu" title="Connection & help">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </div>

        {status === 'error' && error && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ background: 'rgba(255,77,79,.08)', borderTop: '1px solid rgba(255,77,79,.25)', color: '#ff9a9b' }}>
            <span className="flex-1">{error}</span>
            <button className="btn" onClick={() => setMenu(true)}>Help</button>
            <button className="btn btn-primary" onClick={() => connect()}>Retry</button>
          </div>
        )}
      </header>

      {menu && <MenuSheet onClose={() => setMenu(false)} />}
    </>
  );
}

function MenuSheet({ onClose }: { onClose: () => void }) {
  const store = useCameraStore();
  const [host, setHost] = useState(store.customHost);
  const [wifi, setWifi] = useState<WifiStatus | null>(null);
  const [ssid, setSsid] = useState(() => { try { return localStorage.getItem('grSsid') ?? ''; } catch { return ''; } });
  const [wifiKey, setWifiKey] = useState('');
  const [joining, setJoining] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const connected = store.status === 'connected';

  useEffect(() => {
    if (isNative) GrNet.getWifiStatus().then(setWifi).catch(() => {});
  }, []);

  const joinWifi = async () => {
    if (!ssid.trim()) return showToast('Enter the camera SSID (shown on the camera’s Wi-Fi screen)', 'warning');
    try { localStorage.setItem('grSsid', ssid.trim()); } catch { /* ignore */ }
    setJoining(true);
    try {
      const r = await GrNet.joinWifi({ ssid: ssid.trim(), passphrase: wifiKey });
      if (r.joined) {
        showToast('Joined camera Wi-Fi', 'success');
        setWifi(await GrNet.getWifiStatus());
        onClose();
        void store.connect();
      } else {
        showToast(r.message || 'Could not join', 'warning', 5000);
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not join Wi-Fi', 'error', 5000);
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveAndConnect = async () => {
    store.setCustomHost(host.trim());
    onClose();
    await store.connect();
  };

  const genPasscode = () =>
    grapi.corsGenPasscode()
      .then(() => showToast('Look at the camera’s Wi-Fi info screen for the passcode', 'info', 5000))
      .catch(() => showToast('Couldn’t reach the camera to request a passcode', 'error'));

  const enableCors = async () => {
    if (!passcode.trim()) return showToast('Enter the passcode shown on the camera', 'warning');
    try {
      await grapi.enableCORS(window.location.origin, passcode.trim());
      showToast('CORS enabled for this page', 'success');
      setPasscode('');
      onClose();
      void store.connect();
    } catch {
      showToast('CORS not enabled — check the passcode (or the reply was blocked; try Connect)', 'error', 5000);
    }
  };

  const powerOff = async () => {
    try {
      await grapi.powerOff();
      showToast('Camera powering off', 'info');
    } catch { /* camera drops the connection as it shuts down */ }
    store.disconnect();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.55)' }} onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto sm:max-w-lg max-h-[85vh] overflow-y-auto panel-scroll rounded-t-2xl safe-bottom lg:mx-0 lg:inset-x-auto lg:bottom-auto lg:top-14 lg:right-4 lg:w-[380px] lg:rounded-2xl"
        style={{ background: 'var(--color-cam-surface)', border: '1px solid var(--color-cam-border)' }}
      >
        <div className="flex justify-center pt-2 lg:hidden"><span className="w-10 h-1 rounded-full" style={{ background: 'var(--color-cam-border)' }} /></div>
        <div className="p-4 space-y-6">
          <section className="space-y-2">
            <p className="label">Connection</p>
            <p className="text-xs" style={{ color: 'var(--color-cam-muted)' }}>
              {connected ? `Connected ${grapi.getConnectionInfo()}` : isNative ? 'Join the camera’s Wi-Fi first (below or in system Settings). Leave the address blank for 192.168.0.1.' : 'Join the camera’s Wi-Fi first. Leave the address blank to use the built-in proxy.'}
            </p>
            <div className="flex gap-2">
              <input
                value={host}
                onChange={e => setHost(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveAndConnect()}
                placeholder="Auto · 192.168.0.1"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                className="flex-1 min-w-0 rounded-[10px] px-3 text-sm"
                style={{ minHeight: 36, background: 'var(--color-cam-bg)', border: '1px solid var(--color-cam-border)', color: 'var(--color-cam-text)' }}
                aria-label="Camera address"
              />
              {connected
                ? <button className="btn" onClick={() => { store.disconnect(); onClose(); }}>Disconnect</button>
                : <button className="btn btn-primary" onClick={saveAndConnect}>Connect</button>}
            </div>
          </section>

          {isNative ? (
            <section className="space-y-2">
              <p className="label">Camera Wi-Fi</p>
              {wifi && (
                <p className="text-xs" style={{ color: 'var(--color-cam-muted)' }}>
                  Wi-Fi {wifi.wifiConnected ? 'connected' : 'not connected'}
                  {wifi.platform === 'android' && ` · app pinned to Wi-Fi: ${wifi.bound ? 'yes' : 'no'}`}
                  {wifi.platform === 'android' && wifi.hasInternet === false && ' · no internet (expected for the camera)'}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={ssid}
                  onChange={e => setSsid(e.target.value)}
                  placeholder="SSID e.g. RICOH_1A2B3C"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="min-w-0 rounded-[10px] px-3 text-sm"
                  style={{ minHeight: 36, background: 'var(--color-cam-bg)', border: '1px solid var(--color-cam-border)', color: 'var(--color-cam-text)' }}
                  aria-label="Camera Wi-Fi SSID"
                />
                <input
                  value={wifiKey}
                  onChange={e => setWifiKey(e.target.value)}
                  placeholder="Wi-Fi key"
                  type="password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="min-w-0 rounded-[10px] px-3 text-sm"
                  style={{ minHeight: 36, background: 'var(--color-cam-bg)', border: '1px solid var(--color-cam-border)', color: 'var(--color-cam-text)' }}
                  aria-label="Camera Wi-Fi key"
                />
              </div>
              <button className="btn btn-primary w-full" onClick={joinWifi} disabled={joining}>
                {joining ? 'Joining…' : 'Join camera Wi-Fi'}
              </button>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-cam-dim)' }}>
                SSID and key are on the camera’s Wi-Fi info screen. The key is not stored.
                {platform === 'android' && ' If Android asks “Wi-Fi has no internet — stay connected?”, choose Yes.'}
              </p>
              {platform === 'ios' && (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-cam-muted)' }}>
                  <span className="flex-1">Can’t connect on iPhone? Allow <b>Local Network</b> for GR Remote in Settings.</span>
                  <button className="btn" onClick={() => void GrNet.openAppSettings()}>Settings</button>
                </div>
              )}
            </section>
          ) : (
            <section className="space-y-2">
              <p className="label">CORS (only when not using the proxy)</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-cam-muted)' }}>
                If this page talks to <code>http://192.168.0.1</code> directly, the camera must allow this origin.
              </p>
              <div className="flex gap-2">
                <button className="btn" onClick={genPasscode}>1 · Show passcode</button>
                <input
                  value={passcode}
                  onChange={e => setPasscode(e.target.value)}
                  placeholder="2 · passcode"
                  inputMode="numeric"
                  className="flex-1 min-w-0 rounded-[10px] px-3 text-sm"
                  style={{ minHeight: 36, background: 'var(--color-cam-bg)', border: '1px solid var(--color-cam-border)', color: 'var(--color-cam-text)' }}
                  aria-label="CORS passcode"
                />
                <button className="btn" onClick={enableCors}>3 · Allow</button>
              </div>
            </section>
          )}

          {connected && (
            <section className="space-y-2">
              <p className="label">Camera</p>
              {confirmOff ? (
                <div className="flex gap-2">
                  <button className="btn flex-1" onClick={() => setConfirmOff(false)}>Cancel</button>
                  <button className="btn flex-1" style={{ background: 'var(--color-cam-red)', borderColor: 'var(--color-cam-red)', color: '#fff' }} onClick={powerOff}>Power off now</button>
                </div>
              ) : (
                <button className="btn w-full" onClick={() => setConfirmOff(true)}>Power off camera…</button>
              )}
            </section>
          )}

          <button className="btn w-full lg:hidden" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, model }: { status: string; model?: string }) {
  const cfg: Record<string, { color: string; text: string }> = {
    idle:         { color: 'var(--color-cam-dim)',    text: 'Offline' },
    discovering:  { color: 'var(--color-cam-yellow)', text: 'Searching…' },
    connected:    { color: 'var(--color-cam-green)',  text: model || 'Connected' },
    disconnected: { color: 'var(--color-cam-dim)',    text: 'Disconnected' },
    error:        { color: 'var(--color-cam-red)',    text: 'Not found' },
  };
  const c = cfg[status] ?? cfg.idle;
  return (
    <span className="flex items-center gap-1.5 px-2 h-7 rounded-full text-xs font-semibold" style={{ background: 'var(--color-cam-card)', border: '1px solid var(--color-cam-border)' }}>
      <span className={`inline-block w-2 h-2 rounded-full ${status === 'discovering' ? 'held-pulse' : ''}`} style={{ background: c.color, boxShadow: status === 'connected' ? `0 0 6px ${c.color}` : 'none' }} />
      <span style={{ color: 'var(--color-cam-text)' }}>{c.text}</span>
    </span>
  );
}

function Battery({ level }: { level: string }) {
  const l = level.toLowerCase();
  const pct = l.includes('full') ? 1 : l.includes('half') ? 0.5 : l.includes('low') || l.includes('empty') ? 0.15 : 0.75;
  const color = pct <= 0.15 ? 'var(--color-cam-red)' : pct <= 0.5 ? 'var(--color-cam-yellow)' : 'var(--color-cam-green)';
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-cam-muted)' }} title={`Battery: ${level}`}>
      <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden>
        <rect x="0.5" y="0.5" width="18" height="11" rx="2" fill="none" stroke="currentColor" />
        <rect x="19.5" y="3.5" width="2" height="5" rx="1" fill="currentColor" />
        <rect x="2" y="2" width={15 * pct} height="8" rx="1" fill={color} />
      </svg>
      <span className="hidden sm:inline">{level}</span>
    </span>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1c1c20" />
      <circle cx="32" cy="34" r="15" fill="none" stroke="#ff6a13" strokeWidth="5" />
      <circle cx="32" cy="34" r="6" fill="#ededf0" />
      <rect x="12" y="13" width="12" height="5" rx="2" fill="#ededf0" />
    </svg>
  );
}
