import { Capacitor } from '@capacitor/core';

// The iOS and Android apps are this same web build inside Capacitor. Everything native
// (status bar, orientation lock, back button, splash screen) is set up here, and only in
// the app: the plugins are loaded on demand, so the web build never pays for them.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export interface NativeHooks {
  /** Android back button. Returns false when there is nothing to go back to (exit). */
  onBack(): boolean;
  /** The app went to the background. */
  onPause(): void;
}

export async function initNative(hooks: NativeHooks): Promise<void> {
  if (!isNative()) return;
  const [{ App }, { StatusBar }, { SplashScreen }, { ScreenOrientation }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/screen-orientation'),
  ]);
  await StatusBar.hide().catch(() => undefined);
  await ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => undefined);
  await App.addListener('backButton', () => {
    if (!hooks.onBack()) void App.exitApp();
  });
  await App.addListener('pause', () => hooks.onPause());
  await SplashScreen.hide();
}

let lock: WakeLockSentinel | null = null;
let pending = false;

/** Keeps the screen on during matches (no dimming mid-rally). */
export function keepAwake(on: boolean): void {
  if (!('wakeLock' in navigator)) return;
  if (on && !lock && !pending) {
    pending = true;
    navigator.wakeLock
      .request('screen')
      .finally(() => (pending = false))
      .then((l) => {
        lock = l;
        l.addEventListener('release', () => {
          if (lock === l) lock = null;
        });
      })
      .catch(() => undefined);
  } else if (!on && lock) {
    void lock.release();
    lock = null;
  }
}
