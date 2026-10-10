import type { CapacitorConfig } from '@capacitor/cli';

// The iOS and Android apps wrap the same web build (dist/). See docs/MOBILE.md.
const config: CapacitorConfig = {
  // The store identity. It can't change after the first store release.
  appId: 'com.marcingol.deadminton',
  appName: 'Deadminton',
  webDir: 'dist',
  backgroundColor: '#181425',
  android: {
    // Game audio and input should never wait for a WebView zoom gesture.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: false,
      backgroundColor: '#181425',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
