import { create } from 'zustand';
import { grapi } from '../lib/grapi';
import type { DeviceInfo } from '../lib/grapi';
import { logger } from '../lib/logger';
import { showToast } from '../components/Toast';
import { hapticShutter, onAppActive, setKeepAwake } from '../lib/platform';

// Don't ping the camera while the app is in the background.
onAppActive(active => grapi.setKeepAlivePaused(!active));

export type ConnectionStatus = 'idle' | 'discovering' | 'connected' | 'disconnected' | 'error';
export type Tab = 'shoot' | 'settings' | 'buttons' | 'gallery' | 'logs';
export type PanelTab = Exclude<Tab, 'shoot'>;
export type ExposureField = 'sv' | 'av' | 'tv' | 'xv';
export type ExposureParams = Record<ExposureField, string>;
export type LiveSource = 'liveview' | 'display';

export interface GalleryFile { dir: string; name: string; hasThumb: boolean; date: string }

const EXPOSURE_LABEL: Record<ExposureField, string> = { sv: 'ISO', av: 'Aperture', tv: 'Shutter', xv: 'EV' };

function readLS(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLS(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

interface CameraStore {
  status: ConnectionStatus;
  error: string | null;
  deviceInfo: DeviceInfo | null;
  connectionInfo: string;
  batteryLevel: string | null;
  isShooting: boolean;
  shutterHeld: boolean;
  focusLocked: boolean;
  customHost: string;
  tab: Tab;
  panel: PanelTab;
  mode: string;
  exposure: ExposureParams;
  settings: Record<string, string>;
  liveSource: LiveSource;
  gallery: GalleryFile[];
  galleryState: 'idle' | 'loading' | 'loaded' | 'error';

  setCustomHost: (host: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  shoot: () => Promise<void>;
  focusAt: (x: number, y: number) => Promise<void>;
  toggleFocus: () => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  setExposure: (field: ExposureField, value: string) => Promise<void>;
  applySetting: (key: string, value: string, commands: string[], label: string) => Promise<boolean>;
  pressKey: (cmd: string) => Promise<void>;
  setLiveSource: (s: LiveSource) => void;
  loadGallery: (force?: boolean) => Promise<void>;
  setTab: (tab: Tab) => void;
  setPanel: (tab: PanelTab) => void;
}

let galleryRequest: Promise<void> | null = null;

export const useCameraStore = create<CameraStore>((set, get) => ({
  status: 'idle',
  error: null,
  deviceInfo: null,
  connectionInfo: '',
  batteryLevel: null,
  isShooting: false,
  shutterHeld: false,
  focusLocked: false,
  customHost: readLS('grLastHost', ''),
  tab: 'shoot',
  panel: 'settings',
  mode: readLS('grLastMode', ''),
  exposure: { sv: '', av: '', tv: '', xv: '' },
  settings: {},
  liveSource: 'liveview',
  gallery: [],
  galleryState: 'idle',

  setCustomHost: (host) => {
    writeLS('grLastHost', host);
    set({ customHost: host });
  },

  connect: async () => {
    const { customHost } = get();
    if (customHost) grapi.setDirectHost(customHost);

    grapi.setOnDisconnect(() => {
      set({ status: 'disconnected', error: 'Camera connection lost', connectionInfo: '', shutterHeld: false, focusLocked: false });
      setKeepAwake(false);
      showToast('Camera disconnected', 'error');
    });

    set({ status: 'discovering', error: null });

    try {
      const info = await grapi.discover();
      set({
        status: 'connected',
        deviceInfo: info,
        connectionInfo: grapi.getConnectionInfo(),
        error: null,
      });

      grapi.startKeepAlive();
      setKeepAwake(true);

      grapi.getProperties('BATTERY_LEVEL').then((props) => {
        const raw = props.BATTERY_LEVEL || '';
        const match = raw.match(/BATTERY_LEVEL_(.+)/);
        set({ batteryLevel: match ? match[1] : raw || 'Unknown' });
      }).catch(() => {});

    } catch (err: any) {
      set({ status: 'error', error: err.message || 'Failed to connect' });
      logger.error('Connection failed', err);
    }
  },

  disconnect: () => {
    grapi.stop();
    setKeepAwake(false);
    galleryRequest = null;
    set({
      status: 'disconnected', error: null, deviceInfo: null, batteryLevel: null, connectionInfo: '',
      shutterHeld: false, focusLocked: false, gallery: [], galleryState: 'idle',
    });
  },

  shoot: async () => {
    const { status, shutterHeld, isShooting } = get();
    if (status !== 'connected' || isShooting) return;
    set({ isShooting: true });
    hapticShutter();
    try {
      if (shutterHeld) {
        await grapi.shootFinish();
        set({ shutterHeld: false });
        showToast('Shutter released', 'success');
      } else {
        const result = await grapi.shoot();
        set({ focusLocked: false });
        if (result === 'held') {
          set({ shutterHeld: true });
          showToast('Shutter held open — tap again to stop', 'warning');
        } else {
          showToast('Shot captured', 'success');
          if (get().galleryState === 'loaded') set({ galleryState: 'idle' });
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Shoot failed', 'error');
    } finally {
      setTimeout(() => set({ isShooting: false }), 350);
    }
  },

  focusAt: async (x, y) => {
    if (get().status !== 'connected') return;
    try {
      await grapi.focusLock(Math.round(x), Math.round(y));
      set({ focusLocked: true });
    } catch (err: any) {
      logger.error('Focus failed', err);
      showToast(err.message || 'Focus failed', 'error');
    }
  },

  toggleFocus: async () => {
    if (get().status !== 'connected') return;
    const locked = get().focusLocked;
    try {
      if (locked) await grapi.focusUnlock();
      else await grapi.focusLock();
      set({ focusLocked: !locked });
    } catch (err: any) {
      showToast(err.message || 'Focus failed', 'error');
    }
  },

  setMode: async (mode) => {
    if (get().status !== 'connected') return;
    const prev = get().mode;
    set({ mode });
    writeLS('grLastMode', mode);
    try {
      await grapi.setMode(mode);
    } catch (err: any) {
      set({ mode: prev });
      showToast(err.message || 'Mode change failed', 'error');
    }
  },

  setExposure: async (field, value) => {
    if (get().status !== 'connected' || !value) return;
    const prev = get().exposure[field];
    set({ exposure: { ...get().exposure, [field]: value } });
    try {
      await grapi.setExposureParam(field, value);
    } catch (err: any) {
      set({ exposure: { ...get().exposure, [field]: prev } });
      showToast(err.message || `${EXPOSURE_LABEL[field]} update failed`, 'error');
    }
  },

  applySetting: async (key, value, commands, label) => {
    if (get().status !== 'connected') return false;
    try {
      await grapi.applyCommands(commands);
      set({ settings: { ...get().settings, [key]: value } });
      showToast(label, 'success', 1800);
      return true;
    } catch (err: any) {
      showToast(err.message || 'Setting update failed', 'error');
      return false;
    }
  },

  pressKey: async (cmd) => {
    if (get().status !== 'connected') return;
    try {
      await grapi.post('_gr', `cmd=${cmd}`);
    } catch (err: any) {
      showToast(err.message || `${cmd} failed`, 'error');
    }
  },

  setLiveSource: (liveSource) => set({ liveSource }),

  loadGallery: async (force = false) => {
    const { status, galleryState } = get();
    if (status !== 'connected') return;
    if (!force && (galleryState === 'loaded' || galleryState === 'loading')) return galleryRequest ?? undefined;
    set({ galleryState: 'loading' });
    galleryRequest = (async () => {
      try {
        const data = await grapi.getImageList();
        const flat: GalleryFile[] = [];
        for (const dir of (data.dirs || []) as { name: string; files: { n: string; s?: string; d: string }[] }[]) {
          for (const f of dir.files) {
            flat.push({ dir: dir.name, name: f.n, hasThumb: !!f.s && f.s[0] !== ' ', date: f.d });
          }
        }
        flat.reverse();
        set({ gallery: flat, galleryState: 'loaded' });
        logger.log(`Gallery: ${flat.length} files`);
      } catch (err: any) {
        set({ galleryState: 'error' });
        showToast(err.message || 'Could not load file list', 'error');
      } finally {
        galleryRequest = null;
      }
    })();
    return galleryRequest;
  },

  setTab: (tab) => set({ tab, ...(tab !== 'shoot' ? { panel: tab } : {}) }),
  setPanel: (panel) => set({ panel, tab: get().tab === 'shoot' ? 'shoot' : panel }),
}));
