/** Last known live-view facts, written by LiveView and read by the Diagnostics panel. */
export const liveInfo = {
  renderer: '' as '' | 'native' | 'canvas' | 'img',
  contentType: '',
  mode: '' as '' | 'stream' | 'frames',
  fps: 0,
  maxFps: 0,
  width: 0,
  height: 0,
  lastError: '',
};

export function recordLive(patch: Partial<typeof liveInfo>) {
  Object.assign(liveInfo, patch);
  if (patch.fps !== undefined && patch.fps > liveInfo.maxFps) liveInfo.maxFps = patch.fps;
}
