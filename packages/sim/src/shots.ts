import { HALF_COURT, NET_HEIGHT } from './constants';
import type { ShotSpec, Tuning } from './data/tuning';
import { atan2, clamp, cos, degToRad, hypot2, sin } from './math/dmath';
import { nextRange } from './math/prng';
import type { RngState } from './math/prng';
import { summarizeFlight } from './physics/shuttle';
import type { FlightEnv } from './physics/shuttle';
import type { ShotIntent, ShotType } from './types';

/** Contact height above which a forward swing becomes a smash. */
export const SMASH_MIN_HEIGHT = 2.25;
/** Contact height above which a neutral or up swing is an overhead clear (else an underhand lift). */
export const OVERHEAD_MIN_HEIGHT = 1.9;
/** Distance from the net beyond which a down swing is a drop (else a net shot). */
export const DROP_MIN_DISTANCE = 2.6;

export function chooseShot(
  intent: ShotIntent,
  contactY: number,
  distToNet: number,
  isServe: boolean,
): ShotType {
  if (isServe) {
    if (intent === 'up') return 'serveHigh';
    if (intent === 'forward') return 'serveFlick';
    return 'serveShort';
  }
  switch (intent) {
    case 'down':
      return distToNet > DROP_MIN_DISTANCE ? 'drop' : 'netShot';
    case 'forward':
      return contactY >= SMASH_MIN_HEIGHT ? 'smash' : 'drive';
    case 'up':
    case 'neutral':
      return contactY >= OVERHEAD_MIN_HEIGHT ? 'clear' : 'lift';
  }
}

const MIN_SPEED = 2;
const MAX_SPEED = 95;
const ITERATIONS = 22;
const CEILING_MARGIN = 1.5;
const MIN_DEPTH = 0.08;
const MAX_DEPTH = 1.2;

/** Launch angles to try: the spec angle, then steeper (to clear the net), then flatter (ceiling). */
function angleCandidates(base: number): number[] {
  const out: number[] = [];
  for (let a = base; a <= 80; a += 6) out.push(a);
  for (let a = base - 5; a >= 10; a -= 5) out.push(a);
  return out;
}

interface Launch {
  vx: number;
  vy: number;
  clearsNet: boolean;
  clearsCeiling: boolean;
}

function launch(
  x: number,
  y: number,
  speed: number,
  angleRad: number,
  dir: 1 | -1,
  env: FlightEnv,
  margin: number,
) {
  const vx = dir * speed * cos(angleRad);
  const vy = speed * sin(angleRad);
  const f = summarizeFlight({ x, y, vx, vy }, env);
  const clearsNet = f.netCrossY === null || f.netCrossY >= NET_HEIGHT + margin;
  const clearsCeiling = env.ceiling === null || f.apex <= env.ceiling - CEILING_MARGIN;
  // Distance travelled toward the opponent; NaN (never lands) counts as very far.
  const dist = Number.isNaN(f.landX) ? Infinity : (f.landX - x) * dir;
  return { vx, vy, clearsNet, clearsCeiling, dist };
}

/** Bisection on a monotonic "distance(param)" to hit targetDist. */
function bisect(lo: number, hi: number, distAt: (p: number) => number, targetDist: number): number {
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (distAt(mid) < targetDist) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Finds a launch velocity from (x, y) that lands at targetX, flying toward `dir`.
 * Speed-mode shots steepen until they clear the net; angle-mode shots (smashes) aim deeper.
 */
export function solveShot(
  spec: ShotSpec,
  x: number,
  y: number,
  dir: 1 | -1,
  targetDepth: number,
  env: FlightEnv,
  netMargin: number,
): Launch {
  targetDepth = clamp(targetDepth, MIN_DEPTH, MAX_DEPTH);
  let fallback: Launch | null = null;
  if (spec.mode === 'speed') {
    // Try the target depth first; if no angle clears both the net and the ceiling, the shot
    // falls progressively shorter (a deep lift from a low contact can't go full length).
    for (let depth = targetDepth; depth >= MIN_DEPTH; depth -= 0.12) {
      const targetDist = (dir * depth * HALF_COURT - x) * dir;
      for (const angle of angleCandidates(spec.angle)) {
        const a = degToRad(angle);
        const speed = bisect(
          MIN_SPEED,
          MAX_SPEED,
          (v) => launch(x, y, v, a, dir, env, netMargin).dist,
          targetDist,
        );
        const l = launch(x, y, speed, a, dir, env, netMargin);
        if (l.clearsNet && l.clearsCeiling) return l;
        if (!fallback || (l.clearsNet && !fallback.clearsNet)) fallback = l;
      }
    }
    return fallback!;
  }
  for (let depth = targetDepth; depth <= MAX_DEPTH; depth += 0.1) {
    const targetDist = (dir * depth * HALF_COURT - x) * dir;
    const angle = bisect(
      degToRad(-75),
      degToRad(25),
      (a) => launch(x, y, spec.speed, a, dir, env, netMargin).dist,
      targetDist,
    );
    const l = launch(x, y, spec.speed, angle, dir, env, netMargin);
    if (l.clearsNet) return l;
    fallback ??= l;
  }
  return fallback!;
}

/**
 * Full shot: perturbs the target depth and launch angle by timing quality (q in [0, 1]),
 * then solves. Poor timing can send the shuttle long, short or into the net.
 */
export function playShot(
  type: ShotType,
  quality: number,
  x: number,
  y: number,
  dir: 1 | -1,
  wind: number,
  k: number,
  tuning: Tuning,
  ceiling: number | null,
  rng: RngState,
): { vx: number; vy: number } {
  const spec = tuning.shots[type];
  const err = 1 - clamp(quality, 0, 1);
  const depth = spec.depth + err * spec.depthError * nextRange(rng, -1, 1);
  const angleErr = degToRad(err * spec.angleError * nextRange(rng, -1, 1));
  // The solver only partly compensates for wind; the rest pushes the shuttle off target.
  const env: FlightEnv = {
    gravity: tuning.shuttle.gravity,
    k,
    wind: wind * tuning.shuttle.windCompensation,
    ceiling,
  };
  const l = solveShot(spec, x, y, dir, depth, env, spec.netMargin ?? tuning.shuttle.netMargin);
  const speed = hypot2(l.vx, l.vy);
  const angle = atan2(l.vy, l.vx) + angleErr * dir;
  return { vx: speed * cos(angle), vy: speed * sin(angle) };
}
