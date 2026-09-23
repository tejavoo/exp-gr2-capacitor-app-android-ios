import type { PluginListenerHandle } from '@capacitor/core';

/** Rectangle in CSS pixels, relative to the web view's viewport (use getBoundingClientRect()). */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartOptions {
  /** MJPEG (multipart) or single-JPEG URL, e.g. http://192.168.0.1/v1/liveview */
  url: string;
  rect: ViewRect;
  /** Extra request headers (auth tokens etc.). The GR II needs none. */
  headers?: Record<string, string>;
  /** No frame for this long → reconnect. Default 4000 ms. */
  stallTimeoutMs?: number;
  /** Colour behind the native view and around the letterboxed picture. Default '#000000'. */
  backgroundColor?: string;
}

export type StreamState = 'connecting' | 'streaming' | 'frames' | 'stalled' | 'error' | 'paused' | 'stopped';

export interface StateEvent {
  state: StreamState;
  message?: string;
}

export interface StatsEvent {
  /** Frames drawn in the last second. */
  fps: number;
  /** Frames decoded but replaced by a newer one before they could be drawn. */
  dropped: number;
  width: number;
  height: number;
  /** Response Content-Type of the stream, e.g. multipart/x-mixed-replace; boundary=… */
  contentType: string;
  /** 'stream' = one long response, 'frames' = one JPEG per request (chained). */
  mode: 'stream' | 'frames';
}

/**
 * Native MJPEG viewer. Frames never cross the JS bridge: they are read, parsed and decoded
 * on native background threads and drawn into a native image view placed UNDER the
 * (transparent) web view, at the rectangle you give it. HTML drawn on top stays interactive.
 */
export interface GrMjpegPlugin {
  start(options: StartOptions): Promise<void>;
  /** Move / resize the native view to follow the web layout. */
  setRect(options: ViewRect): Promise<void>;
  /** Switch the stream URL (e.g. liveview ↔ display) without tearing down the view. */
  setUrl(options: { url: string }): Promise<void>;
  /** Close the connection but keep the last frame on screen. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Close the connection and remove the native view. */
  stop(): Promise<void>;

  addListener(eventName: 'state', listener: (e: StateEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'stats', listener: (e: StatsEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
