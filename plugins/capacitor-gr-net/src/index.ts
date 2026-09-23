import { registerPlugin } from '@capacitor/core';

import type { GrNetPlugin } from './definitions';

const GrNet = registerPlugin<GrNetPlugin>('GrNet', {
  web: () => import('./web').then(m => new m.GrNetWeb()),
});

export * from './definitions';
export { GrNet };
