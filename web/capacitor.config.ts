import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.nikolajchristensen.ncosis',
  appName: 'ncosis',
  webDir: 'dist',
  // Routes MVSEP calls through native Android networking instead of the WebView's
  // fetch, since mvsep.com sends no CORS headers at all.
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
