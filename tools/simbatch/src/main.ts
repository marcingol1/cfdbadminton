import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseBotSpec, runBotMatch } from '@deadminton/bots';
import { ARENAS, SCHEMES, TICK_RATE } from '@deadminton/sim';
import type { ArenaId, PointsToWin, SchemeId } from '@deadminton/sim';

const { values } = parseArgs({
  options: {
    a: { type: 'string', default: 'medium' },
    b: { type: 'string', default: 'medium' },
    n: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    points: { type: 'string', default: '11' },
    scheme: { type: 'string', default: 'standard' },
    arena: { type: 'string', default: 'hall' },
    revenge: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

// "hard" or "hard:berserker" (difficulty:personality; personality defaults to balanced).
const a = parseBotSpec(values.a);
const b = parseBotSpec(values.b);
const n = Number(values.n);
const seed = Number(values.seed);
const pointsToWin = Number(values.points) as PointsToWin;
const scheme = values.scheme as SchemeId;
const arena = values.arena as ArenaId;
if (!(scheme in SCHEMES))
  throw new Error(`Unknown scheme "${scheme}". Use: ${Object.keys(SCHEMES).join(', ')}`);
if (!(arena in ARENAS))
  throw new Error(`Unknown arena "${arena}". Use: ${Object.keys(ARENAS).join(', ')}`);

const wins = [0, 0];
let unfinished = 0;
let totalTicks = 0;
let totalRallies = 0;
let totalHits = 0;
let longest = 0;
const reasons: Record<string, number> = {};
const shots: Record<string, number> = {};
const winReasons: Record<string, number> = {};
const damage: Record<string, number> = {};
const weapons: Record<string, number> = {};
const started = performance.now();

for (let i = 0; i < n; i++) {
  const r = runBotMatch(a, b, seed + i * 7919, {
    pointsToWin,
    scheme,
    arena,
    revengeTurns: values.revenge,
  });
  if (r.winReason) winReasons[r.winReason] = (winReasons[r.winReason] ?? 0) + 1;
  for (const [k, v] of Object.entries(r.damage)) damage[k] = (damage[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.weapons)) weapons[k] = (weapons[k] ?? 0) + v;
  if (r.winner === null) unfinished++;
  else wins[r.winner]!++;
  totalTicks += r.ticks;
  totalRallies += r.rallies;
  totalHits += r.hits;
  longest = Math.max(longest, r.longestRally);
  for (const [k, v] of Object.entries(r.pointReasons)) reasons[k] = (reasons[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.shots)) shots[k] = (shots[k] ?? 0) + v;
}

const pct = (v: number, total: number) => `${((100 * v) / total).toFixed(1)}%`;
const report = {
  matchup: `${a.difficulty}:${a.personality} (P1) vs ${b.difficulty}:${b.personality} (P2)`,
  scheme,
  arena,
  revengeTurns: values.revenge,
  matches: n,
  wins: { p1: wins[0], p2: wins[1], unfinished },
  // GAME_DESIGN §2 target for evenly matched bots: 35–65 % of matches end by KO.
  winBy: Object.fromEntries(Object.entries(winReasons).map(([k, v]) => [k, pct(v, n)])),
  avgMatchMinutes: +(totalTicks / n / TICK_RATE / 60).toFixed(2),
  avgRallies: +(totalRallies / n).toFixed(1),
  avgHitsPerRally: +(totalHits / Math.max(1, totalRallies)).toFixed(2),
  longestRally: longest,
  pointReasons: Object.fromEntries(
    Object.entries(reasons).map(([k, v]) => [k, pct(v, totalRallies)]),
  ),
  shots: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, pct(v, totalHits)])),
  damagePerMatch: Object.fromEntries(
    Object.entries(damage).map(([k, v]) => [k, +(v / n).toFixed(1)]),
  ),
  weaponUsesPerMatch: Object.fromEntries(
    Object.entries(weapons).map(([k, v]) => [k, +(v / n).toFixed(2)]),
  ),
  wallClockSeconds: +((performance.now() - started) / 1000).toFixed(2),
};
console.log(JSON.stringify(report, null, 2));
if (values.out) {
  mkdirSync('reports', { recursive: true });
  writeFileSync(values.out, JSON.stringify(report, null, 2));
}
if (unfinished > 0) process.exitCode = 1;
