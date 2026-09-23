import { WebPlugin } from '@capacitor/core';

import type {
  DownloadOptions,
  DownloadResult,
  GrNetPlugin,
  HttpResponse,
  JoinWifiOptions,
  RequestOptions,
  WifiStatus,
} from './definitions';

// Browser fallback: plain fetch (subject to CORS — the app uses the dev proxy in the browser).
export class GrNetWeb extends WebPlugin implements GrNetPlugin {
  async request(o: RequestOptions): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10_000);
    try {
      const res = await fetch(o.url, {
        method: o.method,
        body: o.body,
        headers: o.headers,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { status: res.status, data: await res.text(), headers };
    } finally {
      clearTimeout(t);
    }
  }

  async bindToWifi(): Promise<WifiStatus> { return this.getWifiStatus(); }
  async unbindWifi(): Promise<void> { /* nothing to do */ }
  async getWifiStatus(): Promise<WifiStatus> {
    return { platform: 'web', bound: false, wifiConnected: navigator.onLine };
  }

  async download(o: DownloadOptions): Promise<DownloadResult> {
    const a = document.createElement('a');
    a.href = o.url;
    a.download = o.fileName;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    return { path: o.url, bytes: 0, savedToGallery: false, galleryMessage: 'Browser download' };
  }

  async setKeepAwake(): Promise<void> { /* not available on web */ }

  async joinWifi(_o: JoinWifiOptions): Promise<{ joined: boolean; message?: string }> {
    throw this.unavailable('Joining Wi-Fi is only available in the iOS / Android app.');
  }

  async openAppSettings(): Promise<void> {
    throw this.unavailable('Not available on web.');
  }
}
