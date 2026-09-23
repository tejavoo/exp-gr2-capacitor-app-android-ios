import { GrNet } from 'capacitor-gr-net';
import { isNative } from './platform';

export type Method = 'GET' | 'POST' | 'PUT';

export interface RawResponse {
  status: number;
  text: string;
}

export class TransportError extends Error {
  code: 'TIMEOUT' | 'NETWORK';
  constructor(message: string, code: 'TIMEOUT' | 'NETWORK') {
    super(message);
    this.code = code;
  }
}

const FORM = 'application/x-www-form-urlencoded; charset=UTF-8';

/**
 * One HTTP request to the camera. Bodies are sent verbatim (llms_protocol R2).
 * Native: GrNet plugin (no CORS, Wi-Fi-bound on Android). Browser: fetch (via the dev proxy).
 */
export async function request(method: Method, url: string, body?: string, timeoutMs = 10_000): Promise<RawResponse> {
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
  if (body !== undefined) headers['Content-Type'] = FORM;

  if (isNative) {
    try {
      const res = await GrNet.request({ method, url, body, headers, timeoutMs });
      return { status: res.status, text: res.data };
    } catch (err: any) {
      throw new TransportError(err?.message || String(err), err?.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK');
    }
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, body, headers, signal: ctrl.signal, cache: 'no-store' });
    return { status: res.status, text: await res.text() };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new TransportError(`Timed out after ${timeoutMs} ms`, 'TIMEOUT');
    throw new TransportError(err?.message || String(err), 'NETWORK');
  } finally {
    clearTimeout(t);
  }
}
