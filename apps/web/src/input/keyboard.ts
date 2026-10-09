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
  /** Throw a mine / fire in a Revenge Turn (hold to charge). */
  fire: string[];
  prev: string[];
  next: string[];
  fuse: string[];
}

/** Single player: WASD or arrows, Space jump, J swing, K fire, Q/E weapons, R fuse. */
export const SOLO_KEYS: KeyMap = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  hit: ['KeyJ'],
  fire: ['KeyK'],
  prev: ['KeyQ'],
  next: ['KeyE'],
  fuse: ['KeyR'],
};

/** Local 2P, left player: WASD, L-Shift jump, Space swing, F fire, Q/E weapons, R fuse. */
export const P1_SPLIT_KEYS: KeyMap = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  jump: ['ShiftLeft'],
  hit: ['Space'],
  fire: ['KeyF'],
  prev: ['KeyQ'],
  next: ['KeyE'],
  fuse: ['KeyR'],
};

/** Local 2P, right player: arrows, R-Shift jump, Enter swing, / fire, [ ] weapons, \\ fuse. */
export const P2_SPLIT_KEYS: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  jump: ['ShiftRight'],
  hit: ['Enter'],
  fire: ['Slash'],
  prev: ['BracketLeft'],
  next: ['BracketRight'],
  fuse: ['Backslash'],
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
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Slash') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

export class KeyboardDevice implements InputDevice {
  /** Extra "hit" source, e.g. a mouse click on the canvas. */
  externalHit = false;
  /** Extra "fire" source held down, e.g. the right mouse button. */
  externalFire = false;

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
    if (this.pressed(m.fire) || this.externalFire) buttons |= Buttons.FIRE;
    if (this.pressed(m.prev)) buttons |= Buttons.WEAPON_PREV;
    if (this.pressed(m.next)) buttons |= Buttons.WEAPON_NEXT;
    if (this.pressed(m.fuse)) buttons |= Buttons.FUSE;
    this.externalHit = false;
    return { moveX, moveY, buttons };
  }
}

export function isKeyHeld(code: string): boolean {
  return held.has(code);
}
