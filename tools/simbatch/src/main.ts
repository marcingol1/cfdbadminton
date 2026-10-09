import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DIFFICULTIES, runBotMatch } from '@deadminton/bots';
import type { Difficulty } from '@deadminton/bots';
import { TICK_RATE } from '@deadminton/sim';
import type { PointsToWin } from '@deadminton/sim';

const { values } = parseArgs({
  options: {
    a: { type: 'string', default: 'medium' },
    b: { type: 'string', default: 'medium' },
    n: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    points: { type: 'string', default: '11' },
    out: { type: 'string' },
  },
});

function difficulty(name: string): Difficulty {
  if (!(name in DIFFICULTIES))
    throw new Error(`Unknown bot "${name}". Use: ${Object.keys(DIFFICULTIES).join(', ')}`);
  return name as Difficulty;
}

const a = difficulty(values.a);
const b = difficulty(values.b);
const n = Number(values.n);
const seed = Number(values.seed);
const pointsToWin = Number(values.points) as PointsToWin;

const wins = [0, 0];
let unfinished = 0;
let totalTicks = 0;
let totalRallies = 0;
let totalHits = 0;
let longest = 0;
const reasons: Record<string, number> = {};
const shots: Record<string, number> = {};
const started = performance.now();

for (let i = 0; i < n; i++) {
  const r = runBotMatch(a, b, seed + i * 7919, { pointsToWin });
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
  matchup: `${a} (P1) vs ${b} (P2)`,
  matches: n,
  wins: { p1: wins[0], p2: wins[1], unfinished },
  avgMatchMinutes: +(totalTicks / n / TICK_RATE / 60).toFixed(2),
  avgRallies: +(totalRallies / n).toFixed(1),
  avgHitsPerRally: +(totalHits / Math.max(1, totalRallies)).toFixed(2),
  longestRally: longest,
  pointReasons: Object.fromEntries(
    Object.entries(reasons).map(([k, v]) => [k, pct(v, totalRallies)]),
  ),
  shots: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, pct(v, totalHits)])),
  wallClockSeconds: +((performance.now() - started) / 1000).toFixed(2),
};
console.log(JSON.stringify(report, null, 2));
if (values.out) {
  mkdirSync('reports', { recursive: true });
  writeFileSync(values.out, JSON.stringify(report, null, 2));
}
if (unfinished > 0) process.exitCode = 1;
