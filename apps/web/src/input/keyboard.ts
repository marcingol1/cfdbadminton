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

/** The three remappable keyboard layouts. */
export type BindingSet = 'solo' | 'p1' | 'p2';
export type KeyAction = keyof KeyMap;
export type KeyOverrides = Partial<Record<BindingSet, Partial<KeyMap>>>;

export const DEFAULT_KEYS: Record<BindingSet, KeyMap> = {
  solo: SOLO_KEYS,
  p1: P1_SPLIT_KEYS,
  p2: P2_SPLIT_KEYS,
};

export const KEY_ACTIONS: { action: KeyAction; label: string }[] = [
  { action: 'left', label: 'MOVE LEFT' },
  { action: 'right', label: 'MOVE RIGHT' },
  { action: 'up', label: 'UP · CLEAR · AIM' },
  { action: 'down', label: 'DOWN · DROP · AIM' },
  { action: 'jump', label: 'JUMP' },
  { action: 'hit', label: 'SWING / SERVE' },
  { action: 'fire', label: 'FIRE · THROW' },
  { action: 'prev', label: 'WEAPON ◀' },
  { action: 'next', label: 'WEAPON ▶' },
  { action: 'fuse', label: 'FRAG FUSE' },
];

/** The default layout with the player's changes applied. */
export function resolveKeys(set: BindingSet, overrides: KeyOverrides | undefined): KeyMap {
  return { ...DEFAULT_KEYS[set], ...(overrides?.[set] ?? {}) };
}

/**
 * Binds `code` to `action` (replacing its keys). If another action used that key, it gets
 * this action's old key instead, so no action is ever left without a key.
 */
export function rebind(
  overrides: KeyOverrides,
  set: BindingSet,
  action: KeyAction,
  code: string,
): void {
  const map = resolveKeys(set, overrides);
  const old = map[action];
  const next: Partial<KeyMap> = { ...(overrides[set] ?? {}), [action]: [code] };
  for (const { action: other } of KEY_ACTIONS) {
    if (other === action || !map[other].includes(code)) continue;
    const rest = map[other].filter((c) => c !== code);
    next[other] = rest.length ? rest : old.filter((c) => c !== code).slice(0, 1);
  }
  overrides[set] = next;
}

const NAMED: Record<string, string> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  Tab: 'TAB',
  Backspace: 'BKSP',
  CapsLock: 'CAPS',
};

/** Short on-screen name for a key code ('KeyA' → 'A', 'ShiftLeft' → 'L-SHIFT'). */
export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM${code.slice(6).toUpperCase()}`;
  return code.toUpperCase();
}

const held = new Set<string>();
/** Keys pressed since they were last sampled, so taps shorter than one tick still count. */
const tapped = new Set<string>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    // Typing in a text field (the locker's name) is not game input.
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
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

  /** A fixed map, or a getter so remapping in the pause menu applies at once. */
  constructor(private readonly keys: KeyMap | (() => KeyMap)) {
    listen();
  }

  private get map(): KeyMap {
    return typeof this.keys === 'function' ? this.keys() : this.keys;
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
