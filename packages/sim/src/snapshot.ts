import { hashValue } from './math/hash';
import type { MatchState } from './types';

/** MatchState is plain data, so a snapshot is a deep copy. Used for rollback and replays. */
export function snapshot(state: MatchState): MatchState {
  return structuredClone(state);
}

export function restore(snap: MatchState): MatchState {
  return structuredClone(snap);
}

/** Bit-exact hash of the whole match state (desync detection, determinism tests). */
export function hashState(state: MatchState): number {
  return hashValue(state);
}
