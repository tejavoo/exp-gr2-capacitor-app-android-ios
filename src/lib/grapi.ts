import { GrNet } from 'capacitor-gr-net';
import { logger } from './logger';
import { isNative } from './platform';
import { request, TransportError } from './transport';
import type { Method } from './transport';

export interface GRResponse {
  errCode: number;
  errMsg: string;
  retCode?: number;
  retStr?: string;
  [key: string]: any;
}

export interface DeviceInfo {
  model: string;
  firmwareVersion: string;
}

export interface GRError extends Error {
  code: string;
  statusCode?: number;
  response?: any;
}

const DEFAULT_HOST = 'http://192.168.0.1';
const PING_TIMEOUT = 3000;
const CMD_TIMEOUT = 10_000;
const LIST_TIMEOUT = 30_000;

/**
 * GR II client. All rules from llms_protocol.md Part 0 apply:
 *  - bodies verbatim (R2), one command per request, serial (R3)
 *  - success = errMsg "OK" (R5)
 *  - exposure in the PUT body, one parameter at a time (R1)
 */
class GRAPIClient {
  // null = not connected, '' = same-origin proxy (browser dev), absolute = direct (native / camera CORS)
  private activeHost: string | null = null;
  private directHost = DEFAULT_HOST;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private keepAlivePaused = false;
  private onDisconnect: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  setDirectHost(host: string) {
    if (host && !host.startsWith('http')) host = `http://${host}`;
    this.directHost = (host || DEFAULT_HOST).replace(/\/+$/, '');
    logger.log(`Camera host set to: ${this.directHost}`);
  }

  setOnDisconnect(fn: () => void) {
    this.onDisconnect = fn;
  }

  async discover(): Promise<DeviceInfo> {
    logger.log('Starting camera discovery...');

    if (isNative) {
      try {
        const s = await GrNet.bindToWifi();
        logger.log(`Wi-Fi: ${s.wifiConnected ? 'connected' : 'not connected'}${s.platform === 'android' ? `, app bound to Wi-Fi: ${s.bound}` : ''}`);
      } catch (e: any) {
        logger.warn(`Wi-Fi binding failed: ${e?.message || e}`);
      }
      const hosts = Array.from(new Set([this.directHost, DEFAULT_HOST]));
      for (const host of hosts) {
        try {
          logger.debug(`Trying ${host}/v1/ping ...`);
          await this.ping(`${host}/v1/ping`);
          this.activeHost = host;
          logger.log(`✓ Connected to ${host}`);
          return this.getDeviceInfo();
        } catch (err: any) {
          logger.debug(`${host} failed: ${err?.message || err}`);
        }
      }
      throw this.makeError('NOT_CONNECTED',
        'Cannot reach the camera. Join the GR II Wi-Fi (and on iPhone allow Local Network access for GR Remote).');
    }

    try {
      logger.debug('Trying proxy route /v1/ping ...');
      await this.ping('/v1/ping');
      this.activeHost = '';
      logger.log('✓ Connected via dev proxy');
      return this.getDeviceInfo();
    } catch (proxyErr: any) {
      logger.debug(`Proxy route failed: ${proxyErr?.message || proxyErr}`);
    }
    try {
      logger.debug(`Trying direct: ${this.directHost}/v1/ping ...`);
      await this.ping(`${this.directHost}/v1/ping`);
      this.activeHost = this.directHost;
      logger.log(`✓ Connected directly to ${this.directHost}`);
      return this.getDeviceInfo();
    } catch (directErr: any) {
      logger.debug(`Direct connection failed: ${directErr?.message || directErr}`);
    }
    throw this.makeError('NOT_CONNECTED',
      `Cannot reach camera. Is this device on the camera Wi-Fi? Camera should be at ${this.directHost}.`);
  }

  private async ping(url: string): Promise<void> {
    const res = await request('GET', url, undefined, PING_TIMEOUT);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  }

  private url(path: string): string {
    const clean = path.replace(/^\//, '');
    return this.activeHost === '' ? `/${clean}` : `${this.activeHost ?? this.directHost}/${clean}`;
  }

  /** Serialised: the camera handles one command at a time. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async send(method: Method, path: string, body?: string, timeoutMs = CMD_TIMEOUT): Promise<GRResponse> {
    if (this.activeHost === null) throw this.makeError('NOT_CONNECTED', 'Camera not connected');
    const url = this.url(path);
    logger.api(method, path, body ?? null);
    const t0 = Date.now();
    try {
      const res = await request(method, url, body, timeoutMs);
      let data: GRResponse;
      try {
        data = JSON.parse(res.text);
      } catch {
        throw this.makeError('BAD_RESPONSE', `HTTP ${res.status}: not JSON`, res.status);
      }
      logger.apiResponse(path, res.status, data, Date.now() - t0);
      this.checkOK(data, res.status);
      return data;
    } catch (err: any) {
      logger.apiError(path, err, Date.now() - t0);
      if (err instanceof TransportError) throw this.makeError(err.code, err.message);
      throw err;
    }
  }

  get(path: string, timeoutMs = CMD_TIMEOUT): Promise<GRResponse> {
    return this.send('GET', path, undefined, timeoutMs);
  }

  post(path: string, body?: string): Promise<GRResponse> {
    return this.enqueue(() => this.send('POST', path, body));
  }

  put(path: string, body?: string): Promise<GRResponse> {
    return this.enqueue(() => this.send('PUT', path, body));
  }

  /** URL for <img src> / native downloads / the MJPEG plugin. */
  imageUrl(path: string): string {
    if (this.activeHost === null) return '';
    return this.url(path);
  }

  /** Absolute URL for native code (never relative). */
  absoluteUrl(path: string): string {
    const u = this.imageUrl(path);
    return u.startsWith('/') ? `${location.origin}${u}` : u;
  }

  startKeepAlive(interval = 10_000, maxFailures = 3): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    let failures = 0;
    let inFlight = false;
    this.pingTimer = setInterval(async () => {
      if (inFlight || this.keepAlivePaused || this.activeHost === null) return;
      inFlight = true;
      try {
        await this.ping(this.url('v1/ping'));
        if (failures > 0) logger.debug('Keep-alive ping recovered');
        failures = 0;
      } catch {
        failures++;
        logger.warn(`Keep-alive ping failed (${failures}/${maxFailures})`);
        if (failures >= maxFailures) {
          logger.error('Camera unreachable — disconnecting');
          this.stop();
          this.onDisconnect?.();
        }
      } finally {
        inFlight = false;
      }
    }, interval);
  }

  /** Background: stop pinging (the OS may suspend networking anyway). */
  setKeepAlivePaused(paused: boolean) {
    this.keepAlivePaused = paused;
  }

  stop(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.activeHost = null;
  }

  isConnected(): boolean { return this.activeHost !== null; }

  /** Browser only: same-origin through the dev proxy, so fetch() can read the stream. */
  isProxied(): boolean { return this.activeHost === ''; }

  getConnectionInfo(): string {
    if (this.activeHost === null) return 'Not connected';
    if (this.activeHost === '') return 'via proxy (same-LAN)';
    return isNative ? `${this.activeHost} (native)` : this.activeHost;
  }

  // ───────────── Camera API ─────────────

  async getDeviceInfo(): Promise<DeviceInfo> {
    const res = await this.get('v1/constants/device');
    return { model: res.model || 'GR II', firmwareVersion: String(res.firmwareVersion ?? '?') };
  }

  getImageList(): Promise<GRResponse> { return this.get('_gr/objs', LIST_TIMEOUT); }

  // 'single' = one frame taken; 'held' = camera needed shoot/start (bulb/T/continuous)
  // and the shutter stays open until shootFinish() is called.
  async shoot(): Promise<'single' | 'held'> {
    try {
      await this.post('v1/camera/shoot?af=camera');
      return 'single';
    } catch (err: any) {
      const precondition = err?.response?.errMsg === 'Precondition Failed' || err?.statusCode === 412;
      if (!precondition) throw err;
      await this.post('v1/camera/shoot/start?af=camera');
      return 'held';
    }
  }

  async shootFinish(): Promise<void> { await this.post('v1/camera/shoot/finish'); }

  // Without a position this is a half-press at the camera's current AF point.
  async focusLock(x?: number, y?: number): Promise<void> {
    await this.post('v1/lens/focus/lock', x == null || y == null ? undefined : `pos=${x},${y}`);
  }

  async focusUnlock(): Promise<void> { await this.post('v1/lens/focus/unlock'); }

  async setMode(mode: string): Promise<void> {
    await this.post('_gr', `cmd=bdial ${mode}`);
  }

  // Exposure is read from the PUT BODY, one parameter per request, verbatim ("xv=+0.3").
  // Query-string params return 200 OK but are ignored. No mode refresh after ISO (original app).
  async setExposureParam(key: 'sv' | 'av' | 'tv' | 'xv', value: string): Promise<void> {
    await this.put('v1/params/camera', `${key}=${value}`);
    if (key !== 'sv') await this.modeRefresh();
  }

  // Original settings panel: non-pset commands first, all pset pairs in one mpset, then mode refresh.
  async applyCommands(commands: string[]): Promise<void> {
    const props: string[] = [];
    for (const c of commands) {
      const m = /^pset=(.*)$/i.exec(c);
      if (m) props.push(m[1]);
      else await this.post('_gr', c);
    }
    if (props.length) await this.post('_gr', `mpset=${props.join(' ')}`);
    await this.modeRefresh();
  }

  getProperties(...keys: string[]): Promise<GRResponse> {
    return this.post('_gr', `mpget=${keys.join(' ')}`);
  }

  async modeRefresh(): Promise<void> { await this.post('_gr', 'cmd=mode refresh'); }

  async powerOff(): Promise<void> { await this.post('v1/device/finish'); }

  // ───────────── CORS (browser, direct mode only) ─────────────

  private corsTarget(): string {
    const host = this.activeHost === '' ? '' : (this.activeHost ?? this.directHost);
    return host ? `${host}/_gr` : '/_gr';
  }

  async corsGenPasscode(): Promise<void> {
    await request('POST', this.corsTarget(), 'cmd=cors genpasscode', CMD_TIMEOUT);
  }

  async enableCORS(origin: string, passcode: string): Promise<void> {
    const res = await request('POST', this.corsTarget(), `cmd=cors set Access-Control-Allow-Origin ${origin} ${passcode}`, CMD_TIMEOUT);
    const data = JSON.parse(res.text || '{}');
    if (data.retCode !== 0) throw this.makeError('CORS_FAILED', `retCode=${data.retCode}`);
    logger.log('✓ CORS enabled');
  }

  // ───────────── helpers ─────────────

  private checkOK(data: GRResponse, status: number): void {
    if (data.errMsg !== 'OK') {
      throw this.makeError('API_ERROR', data.errMsg || `HTTP ${status}`, status, data);
    }
  }

  private makeError(code: string, message: string, statusCode?: number, response?: any): GRError {
    const err = new Error(message) as GRError;
    err.code = code;
    err.statusCode = statusCode;
    err.response = response;
    return err;
  }
}

export const grapi = new GRAPIClient();
