import type { ShotType } from '../types';

// Every gameplay number lives here (and in the arena / weapon data), never in logic code,
// so balancing is a data change. Tuning is part of MatchConfig, so replays stay exact.

export interface ShotSpec {
  /**
   * 'speed': fixed launch angle, solve the speed that lands at the target depth.
   * 'angle': fixed speed, solve the launch angle (used for smashes).
   */
  mode: 'speed' | 'angle';
  /** Launch angle above horizontal, degrees ('speed' mode). */
  angle: number;
  /** Launch speed in m/s ('angle' mode). */
  speed: number;
  /** Target landing depth as a fraction of the opponent's half, measured from the net. */
  depth: number;
  /** Depth error at the worst timing quality, as a fraction of the half court. */
  depthError: number;
  /** Launch angle error at the worst timing quality, degrees. */
  angleError: number;
  /** Clearance over the net tape the solver aims for; overrides tuning.shuttle.netMargin. */
  netMargin?: number;
}

export interface Tuning {
  shuttle: {
    gravity: number;
    /** Terminal velocity in still air; drag k = g / vt^2. A real feather shuttle is ~6.8 m/s. */
    terminalVelocity: number;
    /** Fraction of the wind the shot solver aims for; the rest pushes the shuttle off target. */
    windCompensation: number;
    /** Minimum clearance over the net tape the solver aims for, meters. */
    netMargin: number;
  };
  player: {
    runSpeed: number;
    groundAccel: number;
    airAccel: number;
    jumpVelocity: number;
    gravity: number;
    /** Racket reach radius from the shoulder. */
    reach: number;
    /** Distance from the shoulder that gives perfect contact. */
    sweetSpot: number;
  };
  swing: {
    totalTicks: number;
    activeStart: number;
    activeEnd: number;
    idealTick: number;
    /** Ticks after a hit during which the hitter's own body ignores the shuttle. */
    selfHitGrace: number;
    /** How long a HIT press waits for the racket to be free (pressing a little early). */
    bufferTicks: number;
    /** Launch speed multiplier for smashes hit in the air. */
    jumpSmashSpeed: number;
  };
  serve: {
    serverX: number;
    receiverX: number;
    /** R-14 serve clock in ticks. */
    clockTicks: number;
    /** Timing quality used for serves (serves have no swing timing). */
    quality: number;
  };
  pointPauseTicks: number;
  shots: Record<ShotType, ShotSpec>;
}

const shot = (s: Partial<ShotSpec> & Pick<ShotSpec, 'mode' | 'depth'>): ShotSpec => ({
  angle: 0,
  speed: 0,
  depthError: 0.2,
  angleError: 3,
  ...s,
});

export const DEFAULT_TUNING: Tuning = {
  shuttle: { gravity: 9.81, terminalVelocity: 6.8, windCompensation: 0.7, netMargin: 0.2 },
  player: {
    runSpeed: 5.0,
    groundAccel: 45,
    airAccel: 18,
    jumpVelocity: 5.2,
    gravity: 19,
    reach: 0.95,
    sweetSpot: 0.65,
  },
  swing: {
    totalTicks: 16,
    activeStart: 2,
    activeEnd: 10,
    idealTick: 5,
    selfHitGrace: 15,
    bufferTicks: 6,
    jumpSmashSpeed: 1.15,
  },
  serve: { serverX: 2.6, receiverX: 3.4, clockTicks: 300, quality: 0.92 },
  pointPauseTicks: 80,
  shots: {
    clear: shot({ mode: 'speed', angle: 42, depth: 0.88, depthError: 0.32, angleError: 3 }),
    lift: shot({ mode: 'speed', angle: 48, depth: 0.86, depthError: 0.32, angleError: 3 }),
    drop: shot({
      mode: 'speed',
      angle: 12,
      depth: 0.25,
      depthError: 0.25,
      angleError: 4,
      netMargin: 0.12,
    }),
    netShot: shot({
      mode: 'speed',
      angle: 40,
      depth: 0.12,
      depthError: 0.15,
      angleError: 4,
      netMargin: 0.06,
    }),
    drive: shot({ mode: 'speed', angle: 4, depth: 0.72, depthError: 0.32, angleError: 3 }),
    smash: shot({ mode: 'angle', speed: 50, depth: 0.62, depthError: 0.35, angleError: 2.5 }),
    serveHigh: shot({ mode: 'speed', angle: 50, depth: 0.92, depthError: 0.1, angleError: 2 }),
    serveShort: shot({ mode: 'speed', angle: 30, depth: 0.38, depthError: 0.08, angleError: 2 }),
    serveFlick: shot({ mode: 'speed', angle: 36, depth: 0.88, depthError: 0.1, angleError: 2 }),
  },
};
