import type { InputFrame } from '@deadminton/sim';

/** A physical input source (keyboard half, gamepad, touch overlay). */
export interface InputDevice {
  sample(): InputFrame;
}
