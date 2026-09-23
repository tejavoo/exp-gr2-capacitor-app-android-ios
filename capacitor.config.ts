import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.grremote.gr2',
  appName: 'GR Remote',
  webDir: 'dist',
  backgroundColor: '#0b0b0d',

  server: {
    // The page runs at http://localhost on Android, so <img src="http://192.168.0.1/…">
    // (gallery thumbnails) is not blocked as mixed content. API calls go through the
    // GrNet native plugin and the live view through GrMjpeg, neither of which uses the WebView network.
    androidScheme: 'http',
  },

  ios: {
    // Viewport starts at the web view's top edge; safe areas are handled in CSS (env()).
    // The native MJPEG view relies on this for its coordinates.
    contentInset: 'never',
  },

  plugins: {
    SystemBars: {
      // Android: inject --safe-area-inset-* CSS variables and honour viewport-fit=cover.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0b0b0d',
      showSpinner: false,
    },
  },
};

export default config;
