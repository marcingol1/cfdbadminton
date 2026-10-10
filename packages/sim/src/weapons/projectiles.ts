import { DT, NET_HEIGHT, WALL_X } from '../constants';
import { explode } from '../combat';
import type { Blast } from '../combat';
import { ARENAS } from '../data/arenas';
import { WEAPONS, WEAPON_TUNING } from '../data/weapons';
import { cos, degToRad, hypot2, sin } from '../math/dmath';
import type { MatchState, PlayerId, Projectile, ProjectileKind, SimEvent } from '../types';
import { groundAt, shoulderOf } from '../world';

const SUBSTEPS = 2;
const SUB_DT = DT / SUBSTEPS;
const GRAVITY = 9.81;
/** A projectile can't hit its own thrower right after launch. */
const OWNER_GRACE_TICKS = 12;
const MAX_AGE_TICKS = 600;

/** How strongly the wind pushes each projectile (Rockets feel it most, Worms-style). */
const WIND_FACTOR: Record<ProjectileKind, number> = {
  rocket: 1,
  mortar: 1,
  homing: 0.5,
  mortarBomb: 0.6,
  clusterBomb: 0.4,
  airMissile: 0.3,
  mineThrown: 0,
};

export function blastFor(kind: ProjectileKind): Blast {
  switch (kind) {
    case 'rocket':
      return WEAPONS.rocket;
    case 'homing':
      return WEAPONS.homing;
    case 'mortar':
    case 'mortarBomb':
      return WEAPONS.mortar;
    case 'airMissile':
      return WEAPONS.airstrike;
    case 'clusterBomb':
      return WEAPONS.cluster;
    case 'mineThrown':
      return WEAPONS.mine;
  }
}

export function spawnProjectile(
  state: MatchState,
  kind: ProjectileKind,
  owner: PlayerId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetX = 0,
  targetY = 0,
): Projectile {
  const p: Projectile = { id: state.nextId++, kind, owner, x, y, vx, vy, age: 0, targetX, targetY };
  state.projectiles.push(p);
  return p;
}

/** Launch point and velocity of an aimed Revenge Turn shot (angle in degrees toward the opponent). */
export function revengeLaunch(
  state: MatchState,
  shooter: PlayerId,
  angleDeg: number,
  power: number,
): { x: number; y: number; vx: number; vy: number } {
  const p = state.players[shooter];
  const t = WEAPON_TUNING.revenge;
  const speed = t.minSpeed + (power < 0 ? 0 : power > 1 ? 1 : power) * (t.maxSpeed - t.minSpeed);
  const a = degToRad(angleDeg);
  const sh = shoulderOf(p);
  return { x: sh.x, y: sh.y, vx: p.facing * speed * cos(a), vy: speed * sin(a) };
}

type Outcome =
  | { kind: 'impact'; x: number; y: number }
  | { kind: 'split' }
  | { kind: 'land'; x: number; y: number }
  | { kind: 'gone' };

function move(state: MatchState, p: Projectile): void {
  const h = WEAPON_TUNING.homing;
  if (p.kind === 'homing' && p.age >= h.lockDelayTicks) {
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const d = hypot2(dx, dy) || 1;
    p.vx += (dx / d) * h.accel * SUB_DT;
    p.vy += (dy / d) * h.accel * SUB_DT;
    const v = hypot2(p.vx, p.vy);
    if (v > h.maxSpeed) {
      p.vx *= h.maxSpeed / v;
      p.vy *= h.maxSpeed / v;
    }
  } else {
    p.vx += state.wind * WEAPON_TUNING.revenge.windAccel * WIND_FACTOR[p.kind] * SUB_DT;
    p.vy -= GRAVITY * SUB_DT;
  }
  p.x += p.vx * SUB_DT;
  p.y += p.vy * SUB_DT;
}

/** Collisions after one substep. `px`/`py` is the position before it. */
function collide(state: MatchState, p: Projectile, px: number, py: number): Outcome | null {
  const arena = ARENAS[state.config.arena];
  const thrown = p.kind === 'mineThrown';

  if (p.kind === 'mortar' && p.vy <= 0 && p.age > 3) return { kind: 'split' };

  if (px < 0 !== p.x < 0) {
    const t = px / (px - p.x);
    const yCross = py + (p.y - py) * t;
    if (yCross <= NET_HEIGHT && yCross >= 0) {
      if (!thrown) return { kind: 'impact', x: 0, y: yCross };
      p.x = px;
      p.vx = -p.vx * 0.2;
    }
  }

  const ground = groundAt(state, p.x);
  if (p.y <= ground) {
    if (thrown) return { kind: 'land', x: p.x, y: ground };
    return { kind: 'impact', x: p.x, y: ground };
  }
  if (p.y < -WEAPON_TUNING.pitDepth) return { kind: 'gone' };

  if (arena.ceiling !== null && p.y >= arena.ceiling) {
    if (!thrown) return { kind: 'impact', x: p.x, y: arena.ceiling };
    p.vy = -Math.abs(p.vy) * 0.3;
  }
  if (arena.walls && (p.x <= -WALL_X || p.x >= WALL_X)) {
    if (!thrown) return { kind: 'impact', x: p.x, y: p.y };
    p.x = px;
    p.vx = -p.vx * 0.3;
  } else if (!arena.walls && (p.x < -WALL_X - 8 || p.x > WALL_X + 8)) {
    return { kind: 'gone' };
  }

  for (const pl of state.players) {
    if (pl.dead) continue;
    if (pl.id === p.owner && p.age < OWNER_GRACE_TICKS) continue;
    if (p.x >= pl.x - 0.3 && p.x <= pl.x + 0.3 && p.y >= pl.y && p.y <= pl.y + 1.75) {
      if (!thrown) return { kind: 'impact', x: p.x, y: p.y };
      p.vx = 0;
    }
  }

  if (p.age > MAX_AGE_TICKS)
    return thrown ? { kind: 'land', x: p.x, y: ground } : { kind: 'impact', x: p.x, y: p.y };
  return null;
}

function split(state: MatchState, p: Projectile): void {
  const m = WEAPON_TUNING.mortar;
  for (let i = 0; i < m.bomblets; i++) {
    const offset = (i - (m.bomblets - 1) / 2) * m.spread;
    spawnProjectile(state, 'mortarBomb', p.owner, p.x, p.y, p.vx + offset, 0);
  }
}

/** Advances every projectile by one tick and applies impacts. */
export function stepProjectiles(state: MatchState, events: SimEvent[]): void {
  const list = state.projectiles.slice();
  for (const p of list) {
    let outcome: Outcome | null = null;
    for (let i = 0; i < SUBSTEPS && !outcome; i++) {
      const px = p.x;
      const py = p.y;
      move(state, p);
      outcome = collide(state, p, px, py);
    }
    p.age++;
    if (!outcome) continue;
    state.projectiles = state.projectiles.filter((q) => q !== p);
    switch (outcome.kind) {
      case 'impact':
        explode(state, outcome.x, outcome.y, blastFor(p.kind), p.kind, events);
        break;
      case 'split':
        split(state, p);
        break;
      case 'land':
        state.mines.push({
          id: state.nextId++,
          owner: p.owner,
          x: outcome.x,
          y: outcome.y,
          armTicks: WEAPON_TUNING.mine.armTicks,
          fuseTicks: -1,
        });
        break;
      case 'gone':
        break;
    }
  }
}

export interface Impact {
  x: number;
  y: number;
  ticks: number;
  blast: Blast;
}

/**
 * Where a projectile launched now would explode, without changing the match. Players are
 * treated as standing still. Mortars report each bomblet. Used by bots to aim and to dodge.
 */
export function simulateProjectile(
  state: MatchState,
  kind: ProjectileKind,
  owner: PlayerId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetX = 0,
  targetY = 0,
  startAge = 0,
): Impact[] {
  const impacts: Impact[] = [];
  let live: Projectile[] = [{ id: -1, kind, owner, x, y, vx, vy, age: startAge, targetX, targetY }];
  for (let tick = 1; tick <= MAX_AGE_TICKS && live.length > 0; tick++) {
    const next: Projectile[] = [];
    for (const p of live) {
      let outcome: Outcome | null = null;
      for (let i = 0; i < SUBSTEPS && !outcome; i++) {
        const px = p.x;
        const py = p.y;
        move(state, p);
        outcome = collide(state, p, px, py);
      }
      p.age++;
      if (!outcome) next.push(p);
      else if (outcome.kind === 'impact' || outcome.kind === 'land')
        impacts.push({ x: outcome.x, y: outcome.y, ticks: tick, blast: blastFor(p.kind) });
      else if (outcome.kind === 'split') {
        const m = WEAPON_TUNING.mortar;
        for (let i = 0; i < m.bomblets; i++) {
          const offset = (i - (m.bomblets - 1) / 2) * m.spread;
          next.push({ ...p, kind: 'mortarBomb', vx: p.vx + offset, vy: 0 });
        }
      }
    }
    live = next;
  }
  return impacts;
}
