import { SHOULDER_FORWARD, SHOULDER_HEIGHT, WALL_X } from './constants';
import { ARENAS } from './data/arenas';
import { WEAPON_TUNING } from './data/weapons';
import { dragCoefficient } from './physics/shuttle';
import type { FlightEnv } from './physics/shuttle';
import type { MatchState, PlayerId, PlayerState } from './types';

export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** -1 for player 0 (left half), +1 for player 1 (right half). */
export function sideSign(p: PlayerId): -1 | 1 {
  return p === 0 ? -1 : 1;
}

/** Which player's half x is on. */
export function halfOwner(x: number): PlayerId {
  return x < 0 ? 0 : 1;
}

export function shoulderOf(p: PlayerState): { x: number; y: number } {
  return { x: p.x + p.facing * SHOULDER_FORWARD, y: p.y + SHOULDER_HEIGHT };
}

// ---------- Terrain: a 1D heightmap of 0.1 m columns between the walls ----------

export const TERRAIN_STEP = 0.1;
export const TERRAIN_COLUMNS = Math.round((2 * WALL_X) / TERRAIN_STEP);
export const MAX_CRATER_DEPTH = 0.6;
/** Ground height reported for pits (effectively bottomless). */
export const PIT_Y = -50;

export function createTerrain(): number[] {
  return new Array<number>(TERRAIN_COLUMNS).fill(0);
}

export function terrainIndex(x: number): number {
  const i = Math.floor((x + WALL_X) / TERRAIN_STEP);
  return i < 0 ? 0 : i >= TERRAIN_COLUMNS ? TERRAIN_COLUMNS - 1 : i;
}

/** Floor height under x for players and objects. Pits are bottomless. */
export function groundAt(state: MatchState, x: number): number {
  if (x < -WALL_X || x > WALL_X) return ARENAS[state.config.arena].pits ? PIT_Y : 0;
  return state.terrain[terrainIndex(x)]!;
}

/** Floor for the shuttle: over a pit it "lands" at y = 0, i.e. out. */
export function shuttleGroundAt(state: MatchState, x: number): number {
  if (x < -WALL_X || x > WALL_X) return 0;
  return state.terrain[terrainIndex(x)]!;
}

/** Blasts near the floor dig a crater (GAME_DESIGN §4). */
export function carveCrater(state: MatchState, x: number, y: number, radius: number): void {
  if (y - groundAt(state, x) > radius) return;
  const from = terrainIndex(x - radius);
  const to = terrainIndex(x + radius);
  for (let i = from; i <= to; i++) {
    const cx = -WALL_X + (i + 0.5) * TERRAIN_STEP;
    const dx = cx - x;
    if (dx * dx >= radius * radius) continue;
    const bottom = y - Math.sqrt(radius * radius - dx * dx) * 0.45;
    const current = state.terrain[i]!;
    state.terrain[i] = Math.max(-MAX_CRATER_DEPTH, Math.min(current, bottom));
  }
}

export function flightEnv(state: MatchState): FlightEnv {
  const t = state.config.tuning;
  const lead = state.shuttle.weapon === 'lead' ? WEAPON_TUNING.lead.dragMultiplier : 1;
  return {
    gravity: t.shuttle.gravity,
    k: dragCoefficient(t) * lead,
    wind: state.wind,
    ceiling: ARENAS[state.config.arena].ceiling,
    walls: ARENAS[state.config.arena].walls,
    groundAt: (x) => shuttleGroundAt(state, x),
  };
}
