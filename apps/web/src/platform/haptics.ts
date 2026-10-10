import type * as HapticsModule from '@capacitor/haptics';
import { isNative } from './native';

// Vibration feedback. In the app it uses the phone's haptic engine (Capacitor Haptics);
// in a mobile browser it falls back to navigator.vibrate (Android only; iOS Safari has none).

export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'ko';

const VIBRATE_MS: Record<HapticKind, number | number[]> = {
  tick: 6,
  light: 12,
  medium: 25,
  heavy: 45,
  ko: [60, 40, 120],
};

let plugin: Promise<typeof HapticsModule> | null = null;

export function haptic(kind: HapticKind): void {
  if (isNative()) {
    plugin ??= import('@capacitor/haptics');
    void plugin.then(({ Haptics, ImpactStyle }) => {
      if (kind === 'ko') {
        void Haptics.vibrate({ duration: 220 });
        return;
      }
      const style =
        kind === 'heavy'
          ? ImpactStyle.Heavy
          : kind === 'medium'
            ? ImpactStyle.Medium
            : ImpactStyle.Light;
      void Haptics.impact({ style });
    });
    return;
  }
  navigator.vibrate?.(VIBRATE_MS[kind]);
}
