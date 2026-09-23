import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import { GrNet } from 'capacitor-gr-net';
import { logger } from './logger';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();

/** Foreground / background changes (native only). */
export function onAppActive(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function initPlatform() {
  document.documentElement.classList.add(isNative ? 'native' : 'web', `platform-${platform}`);
  if (!isNative) return;

  App.addListener('appStateChange', ({ isActive }) => {
    logger.debug(`App ${isActive ? 'foreground' : 'background'}`);
    listeners.forEach(fn => fn(isActive));
  });

  // Let the first paint happen before hiding the splash.
  requestAnimationFrame(() => { void SplashScreen.hide({ fadeOutDuration: 200 }); });
}

export function hapticShutter() {
  if (isNative) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

export function hapticTick() {
  if (isNative) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function setKeepAwake(enabled: boolean) {
  if (isNative) void GrNet.setKeepAwake({ enabled }).catch(() => {});
}
