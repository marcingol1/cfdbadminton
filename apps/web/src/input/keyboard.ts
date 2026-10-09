import { Buttons } from '@deadminton/sim';
import type { InputFrame } from '@deadminton/sim';
import type { InputDevice } from './device';

export interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  jump: string[];
  hit: string[];
}

/** Single player: WASD or arrows, Space to jump, J / K to swing. */
export const SOLO_KEYS: KeyMap = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  hit: ['KeyJ', 'KeyK'],
};

/** Local 2P, left player: WASD, Left Shift to jump, Space to swing. */
export const P1_SPLIT_KEYS: KeyMap = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  jump: ['ShiftLeft'],
  hit: ['Space'],
};

/** Local 2P, right player: arrows, Right Shift to jump, Enter to swing. */
export const P2_SPLIT_KEYS: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  jump: ['ShiftRight', 'Slash'],
  hit: ['Enter', 'Period'],
};

const held = new Set<string>();
/** Keys pressed since they were last sampled, so taps shorter than one tick still count. */
const tapped = new Set<string>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    held.add(e.code);
    tapped.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

export class KeyboardDevice implements InputDevice {
  /** Extra "hit" source, e.g. a mouse click on the canvas. */
  externalHit = false;

  constructor(private readonly map: KeyMap) {
    listen();
  }

  private down(codes: string[]): boolean {
    return codes.some((c) => held.has(c));
  }

  private pressed(codes: string[]): boolean {
    let any = false;
    for (const c of codes) {
      if (tapped.has(c) || held.has(c)) any = true;
      tapped.delete(c);
    }
    return any;
  }

  sample(): InputFrame {
    const m = this.map;
    const moveX = (this.down(m.right) ? 127 : 0) - (this.down(m.left) ? 127 : 0);
    const moveY = (this.down(m.up) ? 127 : 0) - (this.down(m.down) ? 127 : 0);
    let buttons = 0;
    if (this.pressed(m.jump)) buttons |= Buttons.JUMP;
    if (this.pressed(m.hit) || this.externalHit) buttons |= Buttons.HIT;
    this.externalHit = false;
    return { moveX, moveY, buttons };
  }
}

export function isKeyHeld(code: string): boolean {
  return held.has(code);
}
