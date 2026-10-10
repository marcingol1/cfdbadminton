import { RALLY_WEAPONS, REVENGE_WEAPONS, SCHEMES, WEAPONS } from '../data/weapons';
import type { WeaponId } from '../data/weapons';
import type { MatchState, PlayerState } from '../types';

/** R-52: heavy weapons unlock after a number of rallies this game. */
export function isUnlocked(state: MatchState, id: WeaponId): boolean {
  return !SCHEMES[state.config.scheme].delays || state.rallyCount >= WEAPONS[id].delay;
}

/** R-54: ammo is limited per match; -1 means unlimited. */
export function isAvailable(state: MatchState, p: PlayerState, id: WeaponId): boolean {
  return p.ammo[id] !== 0 && isUnlocked(state, id);
}

export function consumeAmmo(p: PlayerState, id: WeaponId): void {
  if (p.ammo[id] > 0) p.ammo[id]--;
}

/** Rally cycle: standard shuttle (null) first, then loaded shots and throwables. */
export function rallyOptions(state: MatchState, p: PlayerState): (WeaponId | null)[] {
  return [null, ...RALLY_WEAPONS.filter((id) => isAvailable(state, p, id))];
}

/** Revenge cycle: weapons and utilities, then "skip" (null). */
export function revengeOptions(state: MatchState, p: PlayerState): (WeaponId | null)[] {
  return [...REVENGE_WEAPONS.filter((id) => isAvailable(state, p, id)), null];
}

export function cycle<T>(options: T[], current: T, dir: 1 | -1): T {
  const i = options.indexOf(current);
  const n = options.length;
  return options[(((i < 0 ? 0 : i + dir) % n) + n) % n]!;
}
