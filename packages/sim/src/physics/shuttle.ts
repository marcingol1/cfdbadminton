import { DT, HALF_COURT, NET_HEIGHT, SHUTTLE_SUBSTEPS, WALL_X } from '../constants';
import type { Tuning } from '../data/tuning';

export const SUBSTEP_DT = DT / SHUTTLE_SUBSTEPS;

export interface FlightBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FlightEnv {
  gravity: number;
  /** Quadratic drag coefficient, k = g / vt^2. */
  k: number;
  /** Horizontal wind, m/s. */
  wind: number;
  ceiling: number | null;
  /** Arena walls end the flight at ±WALL_X; without them the shuttle flies on (and lands out). */
  walls?: boolean;
  /** Floor height under x (craters); flat floor at 0 when omitted. */
  groundAt?: (x: number) => number;
}

export type FlightEvent =
  | { kind: 'net'; y: number }
  | { kind: 'floor'; x: number }
  | { kind: 'ceiling'; x: number }
  | { kind: 'wall'; x: number };

export function dragCoefficient(tuning: Tuning): number {
  const vt = tuning.shuttle.terminalVelocity;
  return tuning.shuttle.gravity / (vt * vt);
}

/** Semi-implicit Euler with quadratic drag against the air (which moves with the wind). */
export function integrate(b: FlightBody, env: FlightEnv, dt: number): void {
  const rvx = b.vx - env.wind;
  const rvy = b.vy;
  const drag = env.k * Math.sqrt(rvx * rvx + rvy * rvy);
  b.vx -= drag * rvx * dt;
  b.vy -= (env.gravity + drag * rvy) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/**
 * Advances one substep and resolves collisions with the net, floor, ceiling and walls.
 * Uses swept tests against the previous position, so fast smashes can't tunnel.
 */
export function advanceFlight(b: FlightBody, env: FlightEnv, dt = SUBSTEP_DT): FlightEvent | null {
  const px = b.x;
  const py = b.y;
  integrate(b, env, dt);

  if (px < 0 !== b.x < 0) {
    const t = px / (px - b.x);
    const yCross = py + (b.y - py) * t;
    if (yCross <= NET_HEIGHT) {
      // Dead-net: kill most of the horizontal speed and drop on the side it came from.
      b.x = px < 0 ? -0.02 : 0.02;
      b.y = yCross > 0 ? yCross : 0.01;
      b.vx = -b.vx * 0.15;
      b.vy = b.vy > 0 ? 0 : b.vy * 0.5;
      return { kind: 'net', y: yCross };
    }
  }
  const floor = env.groundAt ? env.groundAt(b.x) : 0;
  if (b.y <= floor) {
    const t = py - b.y > 0 ? (py - floor) / (py - b.y) : 1;
    b.x = px + (b.x - px) * (t < 0 ? 0 : t > 1 ? 1 : t);
    b.y = floor;
    return { kind: 'floor', x: b.x };
  }
  if (env.ceiling !== null && b.y >= env.ceiling) {
    b.y = env.ceiling;
    return { kind: 'ceiling', x: b.x };
  }
  if (env.walls !== false && (b.x <= -WALL_X || b.x >= WALL_X)) {
    b.x = b.x < 0 ? -WALL_X : WALL_X;
    return { kind: 'wall', x: b.x };
  }
  return null;
}

export interface FlightSummary {
  /** Where the shuttle first touches the floor (ignoring the net), or NaN if it never does. */
  landX: number;
  /** Height when crossing the net plane, or null if it never crosses. */
  netCrossY: number | null;
  /** Highest point of the flight. */
  apex: number;
}

/** Free flight from a launch state until the floor, ignoring the net. Used by the shot solver. */
export function summarizeFlight(start: FlightBody, env: FlightEnv, maxSeconds = 8): FlightSummary {
  const b = { ...start };
  let netCrossY: number | null = null;
  let apex = b.y;
  const steps = Math.ceil(maxSeconds / SUBSTEP_DT);
  for (let i = 0; i < steps; i++) {
    const px = b.x;
    const py = b.y;
    integrate(b, env, SUBSTEP_DT);
    if (b.y > apex) apex = b.y;
    if (netCrossY === null && px < 0 !== b.x < 0) {
      netCrossY = py + (b.y - py) * (px / (px - b.x));
    }
    if (b.y <= 0) {
      const t = py / (py - b.y);
      return { landX: px + (b.x - px) * t, netCrossY, apex };
    }
  }
  return { landX: NaN, netCrossY, apex };
}

export function isInBounds(x: number): boolean {
  return x >= -HALF_COURT && x <= HALF_COURT;
}
