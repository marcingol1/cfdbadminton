import { NEUTRAL_INPUT, createMatch, step } from '../src';
import type { InputFrame, MatchState, PlayerId, SimEvent } from '../src';

export const idle: readonly [InputFrame, InputFrame] = [NEUTRAL_INPUT, NEUTRAL_INPUT];

/** A match frozen mid-rally with the shuttle in flight, last hit by `lastHitter`. */
export function rallyState(
  shuttle: { x: number; y: number; vx: number; vy: number },
  lastHitter: PlayerId,
  seed = 1,
): MatchState {
  const s = createMatch({}, seed);
  s.phase = 'rally';
  s.wind = 0;
  s.shuttle = { mode: 'flight', ...shuttle };
  s.rally = { hits: 2, isServe: false, lastHitter, ticksSinceHit: 30, serveClock: 0 };
  return s;
}

/** Steps with idle inputs until an event of the given type happens (or the tick budget runs out). */
export function runUntil<T extends SimEvent['type']>(
  s: MatchState,
  type: T,
  maxTicks = 600,
  inputs: (s: MatchState) => readonly [InputFrame, InputFrame] = () => idle,
): Extract<SimEvent, { type: T }> | null {
  for (let i = 0; i < maxTicks; i++) {
    for (const e of step(s, inputs(s)))
      if (e.type === type) return e as Extract<SimEvent, { type: T }>;
  }
  return null;
}
