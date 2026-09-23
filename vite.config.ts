import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const cameraHost = env.VITE_CAMERA_HOST || 'http://192.168.0.1'

  // Same-origin proxy to the camera: the browser only ever talks to this server,
  // so there is no CORS, on desktop or on a phone.
  const proxy = {
    '/v1': { target: cameraHost, changeOrigin: true },
    '/_gr': { target: cameraHost, changeOrigin: true },
  }

  return {
    plugins: [react()],
    // Native web views: iOS 15 WKWebView (fixed per OS version) and older Android System WebViews.
    build: { target: ['es2020', 'chrome87', 'safari15'] },
    // host: true listens on the LAN so a phone on the same Wi-Fi can open http://<this-computer-ip>:<port>
    server: { host: true, proxy },
    preview: { host: true, proxy },
  }
})
