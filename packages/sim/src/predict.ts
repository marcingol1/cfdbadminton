import { SHUTTLE_SUBSTEPS } from './constants';
import { advanceFlight } from './physics/shuttle';
import type { FlightEvent } from './physics/shuttle';
import { flightEnv } from './world';
import type { MatchState } from './types';

export interface TrajectoryPoint {
  /** Ticks from now. */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Trajectory {
  points: TrajectoryPoint[];
  end: FlightEvent | null;
}

/**
 * Where the live shuttle will be on each upcoming tick if nobody touches it. Uses the exact
 * same physics as the sim (including wind and the net), and only public information, so
 * bots may use it: it is what a skilled human reads from the flight.
 */
export function predictShuttle(state: MatchState, maxTicks = 360): Trajectory {
  const env = flightEnv(state);
  const b = { x: state.shuttle.x, y: state.shuttle.y, vx: state.shuttle.vx, vy: state.shuttle.vy };
  const points: TrajectoryPoint[] = [];
  if (state.shuttle.mode !== 'flight') return { points, end: null };
  for (let t = 1; t <= maxTicks; t++) {
    for (let i = 0; i < SHUTTLE_SUBSTEPS; i++) {
      const ev = advanceFlight(b, env);
      if (ev && ev.kind !== 'net') {
        points.push({ t, ...b });
        return { points, end: ev };
      }
    }
    points.push({ t, ...b });
  }
  return { points, end: null };
}
