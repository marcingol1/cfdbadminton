import { Buttons, quantizeAxis } from '@deadminton/sim';
import type { InputFrame } from '@deadminton/sim';
import type { InputDevice } from './device';

const DEADZONE = 0.25;

/** Standard mapping: stick / d-pad move, A jump, X swing, Y or RT fire, LB/RB weapons, B fuse. */
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
    if (b(0)) buttons |= Buttons.JUMP;
    if (b(2)) buttons |= Buttons.HIT;
    if (b(3) || b(7)) buttons |= Buttons.FIRE;
    if (b(4)) buttons |= Buttons.WEAPON_PREV;
    if (b(5)) buttons |= Buttons.WEAPON_NEXT;
    if (b(1)) buttons |= Buttons.FUSE;
    return { moveX: quantizeAxis(x), moveY: quantizeAxis(y), buttons };
  }
}
