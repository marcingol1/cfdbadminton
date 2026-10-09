import { Buttons, quantizeAxis } from '@deadminton/sim';
import type { InputFrame } from '@deadminton/sim';
import type { InputDevice } from './device';

const DEADZONE = 0.25;

/** Standard-mapping gamepad: left stick / d-pad, A or LB jump, X or RB swing. */
export class GamepadDevice implements InputDevice {
  constructor(private readonly index: number) {}

  private pad(): Gamepad | null {
    return navigator.getGamepads?.()[this.index] ?? null;
  }

  connected(): boolean {
    return this.pad() !== null;
  }

  startPressed(): boolean {
    return this.pad()?.buttons[9]?.pressed ?? false;
  }

  sample(): InputFrame {
    const pad = this.pad();
    if (!pad) return { moveX: 0, moveY: 0, buttons: 0 };
    const b = (i: number) => pad.buttons[i]?.pressed ?? false;
    let x = pad.axes[0] ?? 0;
    let y = -(pad.axes[1] ?? 0);
    if (Math.abs(x) < DEADZONE) x = 0;
    if (Math.abs(y) < DEADZONE) y = 0;
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    if (b(12)) y = 1;
    if (b(13)) y = -1;
    let buttons = 0;
    if (b(0) || b(4)) buttons |= Buttons.JUMP;
    if (b(2) || b(5) || b(7)) buttons |= Buttons.HIT;
    return { moveX: quantizeAxis(x), moveY: quantizeAxis(y), buttons };
  }
}
