import type { Difficulty, Personality } from '@deadminton/bots';
import type { MatchConfig } from '@deadminton/sim';
import type { MatchSession } from './session';

/** A fixed match against a bot with a goal to reach. Progress is kept in the browser. */
export interface Challenge {
  id: string;
  title: string;
  goal: string;
  bot: Difficulty;
  style: Personality;
  config: Partial<MatchConfig>;
  /** Judged when the match ends (player 0 is you). */
  passed(session: MatchSession): boolean;
}

const won = (s: MatchSession) => s.state.winner === 0;

export const CHALLENGES: Challenge[] = [
  {
    id: 'first-win',
    title: 'FIRST WIN',
    goal: 'Beat an Easy bot (7 points).',
    bot: 'easy',
    style: 'balanced',
    config: { pointsToWin: 7, scheme: 'standard', arena: 'hall' },
    passed: won,
  },
  {
    id: 'purist',
    title: 'PURE BADMINTON',
    goal: 'Beat a Medium Purist with weapons off.',
    bot: 'medium',
    style: 'purist',
    config: { pointsToWin: 7, scheme: 'purist', arena: 'hall' },
    passed: won,
  },
  {
    id: 'untouchable',
    title: 'UNTOUCHABLE',
    goal: 'Beat a Medium bot without losing any HP.',
    bot: 'medium',
    style: 'balanced',
    config: { pointsToWin: 7, scheme: 'standard', arena: 'hall' },
    passed: (s) => won(s) && s.stats.damageTaken[0] === 0,
  },
  {
    id: 'demolition',
    title: 'DEMOLITION',
    goal: 'Knock out a Medium Berserker in Chaos.',
    bot: 'medium',
    style: 'berserker',
    config: { pointsToWin: 11, scheme: 'chaos', arena: 'hall' },
    passed: (s) => won(s) && s.state.winReason === 'ko',
  },
  {
    id: 'rooftop',
    title: 'ROOFTOP RUMBLE',
    goal: 'Win on the Rooftop: strong wind, and pits at both ends.',
    bot: 'medium',
    style: 'balanced',
    config: { pointsToWin: 7, scheme: 'standard', arena: 'rooftop' },
    passed: won,
  },
  {
    id: 'smasher',
    title: 'SMASH MACHINE',
    goal: 'Beat a Medium bot with 10 or more smashes.',
    bot: 'medium',
    style: 'purist',
    config: { pointsToWin: 11, scheme: 'purist', arena: 'hall' },
    passed: (s) => won(s) && s.stats.smashes[0] >= 10,
  },
  {
    id: 'marathon',
    title: 'MARATHON',
    goal: 'Play a rally of 20 shots or more (win or lose).',
    bot: 'hard',
    style: 'purist',
    config: { pointsToWin: 11, scheme: 'purist', arena: 'hall' },
    passed: (s) => s.stats.longestRally >= 20,
  },
  {
    id: 'giant',
    title: 'GIANT SLAYER',
    goal: 'Beat a Hard bot (11 points).',
    bot: 'hard',
    style: 'balanced',
    config: { pointsToWin: 11, scheme: 'standard', arena: 'hall' },
    passed: won,
  },
  {
    id: 'bane',
    title: "BERSERKER'S BANE",
    goal: 'Beat a Hard Berserker in Chaos with Revenge Turns on.',
    bot: 'hard',
    style: 'berserker',
    config: { pointsToWin: 11, scheme: 'chaos', arena: 'hall', revengeTurns: true },
    passed: won,
  },
];

const KEY = 'deadminton.challenges';
/** Also kept in memory, so progress survives blocked storage until the page closes. */
const memory = new Set<string>();

export function loadCompleted(): Set<string> {
  const done = new Set(memory);
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(ids)) for (const x of ids) if (typeof x === 'string') done.add(x);
  } catch {
    // Unreadable storage: memory only.
  }
  return done;
}

export function markCompleted(id: string): void {
  memory.add(id);
  const done = loadCompleted();
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    // Storage blocked: the in-memory copy still counts.
  }
}
