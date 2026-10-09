import type { InputFrame, ShotIntent } from './types';

export const Buttons = {
  JUMP: 1,
  HIT: 2,
  /** Throw a mine (rally) or fire / confirm (Revenge Turn). */
  FIRE: 4,
  WEAPON_NEXT: 8,
  WEAPON_PREV: 16,
  /** Cycle the Frag Shuttle fuse, 1..5 s. */
  FUSE: 32,
} as const;

export const AXIS_MAX = 127;
const INTENT_THRESHOLD = 48;

export const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze({
  moveX: 0,
  moveY: 0,
  buttons: 0,
});

export function quantizeAxis(v: number): number {
  const q = Math.round(v * AXIS_MAX);
  return q < -AXIS_MAX ? -AXIS_MAX : q > AXIS_MAX ? AXIS_MAX : q;
}

/** GAME_DESIGN §10: up = clear/lift, down = drop/net shot, toward the net = smash/drive. */
export function intentFromInput(input: InputFrame, facing: 1 | -1): ShotIntent {
  if (input.moveY > INTENT_THRESHOLD) return 'up';
  if (input.moveY < -INTENT_THRESHOLD) return 'down';
  if (input.moveX * facing > INTENT_THRESHOLD) return 'forward';
  return 'neutral';
}
