import { createMatch, step } from '@deadminton/sim';
import type { MatchConfig, MatchState, PlayerId, SimEvent } from '@deadminton/sim';
import { Bot } from './bot';
import type { BotProfile, Difficulty } from './profiles';

export interface BotMatchResult {
  winner: PlayerId | null;
  score: [number, number];
  ticks: number;
  rallies: number;
  hits: number;
  longestRally: number;
  pointReasons: Record<string, number>;
  shots: Record<string, number>;
  winReason: string | null;
  /** Damage dealt by source (explosion, smash, lead, shock, fall, pit). */
  damage: Record<string, number>;
  /** Weapons used: loaded shots on hits, throws, Revenge Turn picks. */
  weapons: Record<string, number>;
  final: MatchState;
}

/** Plays a full headless bot-vs-bot match. Deterministic for a given seed. */
export function runBotMatch(
  a: BotProfile | Difficulty,
  b: BotProfile | Difficulty,
  seed: number,
  config: Partial<MatchConfig> = {},
  maxTicks = 60 * 60 * 30,
  onEvents?: (events: SimEvent[], state: MatchState) => void,
): BotMatchResult {
  const state = createMatch(config, seed);
  const bots = [new Bot(0, a, seed), new Bot(1, b, seed + 1)] as const;
  const result: BotMatchResult = {
    winner: null,
    score: [0, 0],
    ticks: 0,
    rallies: 0,
    hits: 0,
    longestRally: 0,
    pointReasons: {},
    shots: {},
    winReason: null,
    damage: {},
    weapons: {},
    final: state,
  };
  let rallyHits = 0;
  while (state.phase !== 'matchOver' && state.tick < maxTicks) {
    const events = step(state, [bots[0].think(state), bots[1].think(state)]);
    for (const e of events) {
      if (e.type === 'hit') {
        result.hits++;
        rallyHits++;
        result.shots[e.shot] = (result.shots[e.shot] ?? 0) + 1;
      } else if (e.type === 'loaded') {
        result.weapons[e.weapon] = (result.weapons[e.weapon] ?? 0) + 1;
      } else if (e.type === 'damage') {
        result.damage[e.source] = (result.damage[e.source] ?? 0) + e.amount;
      } else if (e.type === 'throw') {
        result.weapons[e.weapon] = (result.weapons[e.weapon] ?? 0) + 1;
      } else if (e.type === 'revengeFire') {
        const k = e.weapon ?? 'skip';
        result.weapons[k] = (result.weapons[k] ?? 0) + 1;
      } else if (e.type === 'point') {
        result.rallies++;
        result.longestRally = Math.max(result.longestRally, rallyHits);
        rallyHits = 0;
        result.pointReasons[e.reason] = (result.pointReasons[e.reason] ?? 0) + 1;
      }
    }
    onEvents?.(events, state);
  }
  result.winner = state.winner;
  result.winReason = state.winReason;
  result.score = [state.score[0], state.score[1]];
  result.ticks = state.tick;
  return result;
}
