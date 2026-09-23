import { WebPlugin } from '@capacitor/core';

import type { GrMjpegPlugin } from './definitions';

// In the browser there is no native layer to draw under the page; the app uses its
// fetch + canvas viewer instead (see src/lib/liveStream.ts).
export class GrMjpegWeb extends WebPlugin implements GrMjpegPlugin {
  private fail(): never {
    throw this.unavailable('GrMjpeg is native-only. Use the canvas viewer in the browser.');
  }
  async start(): Promise<void> { this.fail(); }
  async setRect(): Promise<void> { this.fail(); }
  async setUrl(): Promise<void> { this.fail(); }
  async pause(): Promise<void> { this.fail(); }
  async resume(): Promise<void> { this.fail(); }
  async stop(): Promise<void> { /* nothing to stop */ }
}
