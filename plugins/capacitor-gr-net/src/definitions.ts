export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface RequestOptions {
  method: HttpMethod;
  url: string;
  /**
   * Sent as the exact UTF-8 bytes of this string — never re-encoded.
   * The GR II needs bodies like `cmd=bdial P` or `xv=+0.7` verbatim.
   */
  body?: string;
  headers?: Record<string, string>;
  /** Default 10000 ms. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Response body decoded as UTF-8. */
  data: string;
  headers: Record<string, string>;
}

export interface WifiStatus {
  platform: 'android' | 'ios' | 'web';
  /** Android: this app's traffic is pinned to the Wi-Fi network. */
  bound: boolean;
  /** A Wi-Fi network is currently connected (best effort). */
  wifiConnected: boolean;
  /** The Wi-Fi network is validated as having internet (camera Wi-Fi: false). Android only. */
  hasInternet?: boolean;
}

export interface DownloadOptions {
  url: string;
  fileName: string;
  /** Also add the file to Photos (iOS) / the Pictures gallery (Android 10+). */
  saveToGallery?: boolean;
  /** Default 120000 ms. */
  timeoutMs?: number;
}

export interface DownloadResult {
  /** Absolute native path of the downloaded file (pass to Capacitor.convertFileSrc for <img>). */
  path: string;
  bytes: number;
  savedToGallery: boolean;
  /** Why the gallery save was skipped or failed, if it was. */
  galleryMessage?: string;
}

export interface JoinWifiOptions {
  ssid: string;
  passphrase: string;
}

export interface GrNetPlugin {
  /** One HTTP request with a verbatim body. Never throws for HTTP error statuses; rejects on network errors / timeout. */
  request(options: RequestOptions): Promise<HttpResponse>;

  /**
   * Android: pin this app's traffic to the current Wi-Fi network. The camera Wi-Fi has no
   * internet, so Android would otherwise keep sending requests over mobile data.
   * iOS / web: no-op (routing to the camera's subnet already uses Wi-Fi).
   */
  bindToWifi(): Promise<WifiStatus>;
  unbindWifi(): Promise<void>;
  getWifiStatus(): Promise<WifiStatus>;

  /** Download a file natively (not through the JS bridge) into the app cache, optionally saving it to the gallery. */
  download(options: DownloadOptions): Promise<DownloadResult>;

  /** Keep the screen on while shooting. */
  setKeepAwake(options: { enabled: boolean }): Promise<void>;

  /**
   * Join the camera's Wi-Fi from inside the app.
   * Android 10+: app-scoped connection (system dialog). iOS: NEHotspotConfiguration
   * (needs the Hotspot Configuration capability on the App ID).
   */
  joinWifi(options: JoinWifiOptions): Promise<{ joined: boolean; message?: string }>;

  /** Open this app's page in the system Settings (e.g. to allow Local Network access on iOS). */
  openAppSettings(): Promise<void>;
}
