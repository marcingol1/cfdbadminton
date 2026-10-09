import type { RngState } from './math/prng';
import type { ArenaId } from './data/arenas';
import type { SchemeId, WeaponId } from './data/weapons';
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

/**
 * serve → rally → point (pause) → [revenge] → serve …
 * A KO, or the final point, goes point (pause) → matchOver.
 */
export type Phase = 'serve' | 'rally' | 'point' | 'revenge' | 'matchOver';

export type PointReason =
  | 'in' // R-20
  | 'out' // R-21
  | 'ownSide' // R-23 (hit the net and fell back)
  | 'body' // R-22
  | 'ceiling' // R-26
  | 'serveShort' // R-13
  | 'netTouch'; // R-29

export type PointsToWin = 7 | 11 | 21;

export interface MatchConfig {
  arena: ArenaId;
  pointsToWin: PointsToWin;
  /** R-05: single game or best of 3. */
  bestOf: 1 | 3;
  /** Weapon scheme (GAME_DESIGN §7.5). */
  scheme: SchemeId;
  /** R-06: optional time limit in seconds; null = none. */
  timeLimitSec: number | null;
  /** R-42 option: the Revenge Turn target is frozen (pure Worms). */
  classicTargeting: boolean;
  tuning: Tuning;
}

/** Quantized per-tick input. Identical for humans, bots and (later) the network. */
export interface InputFrame {
  /** -127..127, positive = right. */
  moveX: number;
  /** -127..127, positive = up. Picks the shot type; aims in a Revenge Turn. */
  moveY: number;
  /** Bitflags, see Buttons. */
  buttons: number;
}

/** Ammo per weapon; -1 means unlimited. */
export type Ammo = Record<WeaponId, number>;

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
  /** Damage the shield still absorbs (R-55). */
  shield: number;
  dead: boolean;
  /** Ticks of lost control after a Shock Shuttle. */
  stunTicks: number;
  /** Ticks of lost control after a knockback (also arms fall damage and R-29). */
  knockTicks: number;
  /** Highest point of the current knockback flight, for fall damage. */
  airPeak: number;
  /** Ticks left in a throw animation (no swinging, GAME_DESIGN §5). */
  throwTicks: number;
  ammo: Ammo;
  /** Loaded shot or throwable selected for the rally; null = standard shuttle. */
  rallyWeapon: WeaponId | null;
  /** Weapon or utility selected for a Revenge Turn; null = skip the turn. */
  revengeWeapon: WeaponId | null;
  /** Frag Shuttle fuse in seconds, 1..5. */
  fuse: number;
}

/** held: in the server's hand. flight: live. dead: falling after the rally ended. gone: blown up. */
export type ShuttleMode = 'held' | 'flight' | 'dead' | 'grounded' | 'gone';

export type ShuttleWeapon = 'frag' | 'shock' | 'lead' | 'cluster' | 'ghost';

export interface ShuttleState {
  mode: ShuttleMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Weapon the shuttle carries (GAME_DESIGN §7.1), or null for a standard shuttle. */
  weapon: ShuttleWeapon | null;
  /** Frag fuse countdown in ticks (only for 'frag'). */
  fuseTicks: number;
  /** Ghost Shuttle invisibility countdown in ticks. */
  ghostTicks: number;
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

export type ProjectileKind =
  'rocket' | 'mortar' | 'mortarBomb' | 'homing' | 'airMissile' | 'clusterBomb' | 'mineThrown';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Homing lock point / airstrike target. */
  targetX: number;
  targetY: number;
}

export interface Mine {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  /** Ticks until armed. */
  armTicks: number;
  /** Countdown after triggering, or -1 while waiting. */
  fuseTicks: number;
}

export type CrateContents = 'weapon' | 'health' | 'shield';

export interface Crate {
  id: number;
  x: number;
  y: number;
  landed: boolean;
  contents: CrateContents;
  /** For weapon crates: which weapon gets +1 ammo. */
  weapon: WeaponId | null;
}

export interface RevengeState {
  shooter: PlayerId;
  target: PlayerId;
  /** R-41 turn timer in ticks. */
  ticksLeft: number;
  /** Launch angle in degrees above horizontal, toward the opponent. */
  angle: number;
  /** Charge 0..1 while FIRE is held. */
  power: number;
  charging: boolean;
  /** Air Strike target, meters from the net into the opponent's half. */
  cursor: number;
  fired: boolean;
  /** R-43 resolution ticks after firing (or after the turn ends). */
  resolveTicks: number;
}

export type DamageSource = 'smash' | 'lead' | 'shock' | 'explosion' | 'fall' | 'pit';

export type WinReason = 'points' | 'ko';

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
  /** R-05: games won (best of 3). */
  games: [number, number];
  server: PlayerId;
  /** Horizontal wind in m/s, positive = blowing right. Re-rolled every rally. */
  wind: number;
  lastPoint: PointRecord | null;
  winner: PlayerId | null;
  winReason: WinReason | null;
  /** Rallies played this game; drives weapon delay (R-52). */
  rallyCount: number;
  /** Ticks of play (serve, rally, revenge) for the R-06 time limit. */
  playTicks: number;
  /** R-04 / R-06: everyone at 1 HP, the next point wins. */
  suddenDeath: boolean;
  /** Floor height per 0.1 m column across the arena (0 = flat, negative = crater). */
  terrain: number[];
  projectiles: Projectile[];
  mines: Mine[];
  crates: Crate[];
  revenge: RevengeState | null;
  /** Who gets a Revenge Turn after the current point pause (R-40), if anyone. */
  pendingRevenge: PlayerId | null;
  /** A game was won but not the match (R-05): reset the field after the pause. */
  pendingGame: boolean;
  nextId: number;
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
      weapon: ShuttleWeapon | null;
    }
  | { type: 'net'; x: number; y: number }
  | { type: 'land'; x: number; inBounds: boolean }
  | { type: 'bodyHit'; player: PlayerId; x: number; y: number }
  | { type: 'point'; winner: PlayerId; reason: PointReason; score: [number, number] }
  | { type: 'newRally'; server: PlayerId; wind: number }
  | { type: 'gameOver'; winner: PlayerId; games: [number, number] }
  | { type: 'matchOver'; winner: PlayerId; reason: WinReason }
  | { type: 'damage'; player: PlayerId; amount: number; source: DamageSource; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; radius: number; source: string }
  | { type: 'ko'; player: PlayerId }
  | { type: 'suddenDeath' }
  | { type: 'shocked'; player: PlayerId }
  | { type: 'select'; player: PlayerId; weapon: WeaponId | null }
  | { type: 'fuse'; player: PlayerId; seconds: number }
  | { type: 'throw'; player: PlayerId; weapon: WeaponId }
  | { type: 'loaded'; player: PlayerId; weapon: ShuttleWeapon }
  | { type: 'mineArmed'; x: number }
  | { type: 'mineTriggered'; x: number }
  | { type: 'revengeStart'; shooter: PlayerId; target: PlayerId }
  | { type: 'revengeFire'; player: PlayerId; weapon: WeaponId | null; power: number }
  | { type: 'revengeEnd' }
  | { type: 'heal'; player: PlayerId; amount: number }
  | { type: 'shieldUp'; player: PlayerId; amount: number }
  | { type: 'crateDrop'; x: number }
  | { type: 'crateCollect'; player: PlayerId; contents: CrateContents; weapon: WeaponId | null };
