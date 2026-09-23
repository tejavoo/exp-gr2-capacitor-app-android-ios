import { registerPlugin } from '@capacitor/core';

import type { GrMjpegPlugin } from './definitions';

const GrMjpeg = registerPlugin<GrMjpegPlugin>('GrMjpeg', {
  web: () => import('./web').then(m => new m.GrMjpegWeb()),
});

export * from './definitions';
export { GrMjpeg };
