import type { RngState } from './math/prng';
import type { ArenaId } from './data/arenas';
import type { Tuning } from './data/tuning';

export type PlayerId = 0 | 1;

/** Shot direction the player held when starting a swing (GAME_DESIGN §10). */
export type ShotIntent = 'neutral' | 'up' | 'down' | 'forward';

export type ShotType =
  | 'clear'
  | 'lift'
  | 'drop'
  | 'netShot'
  | 'drive'
  | 'smash'
  | 'serveHigh'
  | 'serveShort'
  | 'serveFlick';

export type Phase = 'serve' | 'rally' | 'point' | 'matchOver';

export type PointReason =
  | 'in' // R-20
  | 'out' // R-21
  | 'ownSide' // R-23 (hit the net and fell back)
  | 'body' // R-22
  | 'ceiling' // R-26
  | 'serveShort'; // R-13

export type PointsToWin = 7 | 11 | 21;

export interface MatchConfig {
  arena: ArenaId;
  pointsToWin: PointsToWin;
  tuning: Tuning;
}

/** Quantized per-tick input. Identical for humans, bots and (later) the network. */
export interface InputFrame {
  /** -127..127, positive = right. */
  moveX: number;
  /** -127..127, positive = up. Picks the shot type. */
  moveY: number;
  /** Bitflags, see Buttons. */
  buttons: number;
}

export interface PlayerState {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** +1 faces right (player 0), -1 faces left (player 1). */
  facing: 1 | -1;
  /** Ticks since the swing started, or -1 when not swinging. */
  swingTick: number;
  swingIntent: ShotIntent;
  swingContact: boolean;
  prevButtons: number;
  hp: number;
}

/** held: in the server's hand. flight: live. dead: falling after the rally ended. */
export type ShuttleMode = 'held' | 'flight' | 'dead' | 'grounded';

export interface ShuttleState {
  mode: ShuttleMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface RallyState {
  hits: number;
  /** True until the receiver touches the served shuttle (R-13 applies). */
  isServe: boolean;
  lastHitter: PlayerId;
  ticksSinceHit: number;
  /** Ticks spent in the current serve phase (R-14 serve clock). */
  serveClock: number;
}

export interface PointRecord {
  winner: PlayerId;
  reason: PointReason;
  x: number;
}

export interface MatchState {
  tick: number;
  config: MatchConfig;
  rng: RngState;
  phase: Phase;
  phaseTicks: number;
  players: [PlayerState, PlayerState];
  shuttle: ShuttleState;
  rally: RallyState;
  score: [number, number];
  server: PlayerId;
  /** Horizontal wind in m/s, positive = blowing right. Re-rolled every rally. */
  wind: number;
  lastPoint: PointRecord | null;
  winner: PlayerId | null;
}

export type SimEvent =
  | { type: 'serve'; player: PlayerId; shot: ShotType }
  | { type: 'swing'; player: PlayerId }
  | {
      type: 'hit';
      player: PlayerId;
      shot: ShotType;
      quality: number;
      x: number;
      y: number;
      speed: number;
    }
  | { type: 'net'; x: number; y: number }
  | { type: 'land'; x: number; inBounds: boolean }
  | { type: 'bodyHit'; player: PlayerId; x: number; y: number }
  | { type: 'point'; winner: PlayerId; reason: PointReason; score: [number, number] }
  | { type: 'newRally'; server: PlayerId; wind: number }
  | { type: 'matchOver'; winner: PlayerId; reason: 'points' };
