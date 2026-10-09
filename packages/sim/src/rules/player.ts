import { DT, NET_CLEARANCE, PLAYER_HALF_WIDTH, WALL_X } from '../constants';
import { NO_FALL, applyDamage, landFromKnock } from '../combat';
import { ARENAS } from '../data/arenas';
import { WEAPON_TUNING } from '../data/weapons';
import { Buttons, intentFromInput } from '../input';
import { clamp, cos, degToRad, sin } from '../math/dmath';
import { nextRange } from '../math/prng';
import type { InputFrame, MatchState, PlayerState, SimEvent } from '../types';
import { activeMines } from '../weapons/field';
import { spawnProjectile } from '../weapons/projectiles';
import { consumeAmmo, cycle, isAvailable, rallyOptions } from '../weapons/selection';
import { groundAt, other, shoulderOf, sideSign } from '../world';

/** How far a grounded player can step down without leaving the ground (crater slopes). */
const STEP_DOWN = 0.35;

export interface MoveOptions {
  /** No running or jumping (the server before serving, a frozen Revenge target). */
  locked: boolean;
  canSwing: boolean;
}

export function canAct(p: PlayerState): boolean {
  return !p.dead && p.stunTicks <= 0;
}

/**
 * Movement, jumping, knockback flight, terrain, pits and swings for one tick.
 * Returns true if the player was knocked into the net (R-29).
 */
export function updatePlayer(
  state: MatchState,
  p: PlayerState,
  input: InputFrame,
  pressed: number,
  opts: MoveOptions,
  events: SimEvent[],
): boolean {
  const t = state.config.tuning.player;
  const arena = ARENAS[state.config.arena];
  const control = canAct(p) && p.knockTicks <= 0 && !opts.locked;
  const axis = Math.abs(input.moveX) > 12 ? input.moveX / 127 : 0;

  if (control) {
    const accel = (p.grounded ? t.groundAccel : t.airAccel) * DT;
    p.vx += clamp(axis * t.runSpeed - p.vx, -accel, accel);
    if (p.grounded && pressed & Buttons.JUMP) {
      p.vy = t.jumpVelocity;
      p.grounded = false;
    }
  } else if (p.grounded) {
    // Sliding to a stop after a knockback, or standing still.
    const friction = t.groundAccel * 0.5 * DT;
    p.vx += clamp(-p.vx, -friction, friction);
  }
  if (!p.grounded) p.vy -= t.gravity * DT;

  p.x += p.vx * DT;
  p.y += p.vy * DT;

  // Players never cross the net plane; the outer limit is a wall or the far side of a pit.
  const outer = arena.walls ? WALL_X - PLAYER_HALF_WIDTH : WALL_X + 1.5;
  const lo = p.id === 0 ? -outer : NET_CLEARANCE;
  const hi = p.id === 0 ? -NET_CLEARANCE : outer;
  let netTouch = false;
  if (p.x < lo || p.x > hi) {
    const atNet = p.id === 0 ? p.x > hi : p.x < lo;
    if (atNet && p.knockTicks > 0) netTouch = true;
    p.x = clamp(p.x, lo, hi);
    p.vx = 0;
  }

  const ground = groundAt(state, p.x);
  if (p.y <= ground) {
    p.y = ground;
    p.vy = 0;
    if (!p.grounded) {
      p.grounded = true;
      landFromKnock(p, events);
    }
  } else if (p.grounded) {
    if (p.y - ground <= STEP_DOWN) p.y = ground;
    else p.grounded = false;
  }
  if (!p.grounded && p.airPeak > NO_FALL) p.airPeak = Math.max(p.airPeak, p.y);
  // A knockback that never left the ground arms no fall damage.
  if (p.grounded && p.knockTicks <= 0) p.airPeak = NO_FALL;

  if (p.y < -WEAPON_TUNING.pitDepth && !p.dead) {
    p.shield = 0;
    applyDamage(p, p.hp, 'pit', events);
  }

  if (p.knockTicks > 0) p.knockTicks--;
  if (p.stunTicks > 0) p.stunTicks--;
  if (p.throwTicks > 0) p.throwTicks--;

  if (p.swingTick >= 0) {
    p.swingTick++;
    if (p.swingTick >= state.config.tuning.swing.totalTicks) p.swingTick = -1;
  }
  if (opts.canSwing && canAct(p) && p.throwTicks <= 0 && p.swingTick < 0 && pressed & Buttons.HIT) {
    p.swingTick = 0;
    p.swingIntent = intentFromInput(input, p.facing);
    p.swingContact = false;
    events.push({ type: 'swing', player: p.id });
  }
  return netTouch;
}

/** Weapon cycling, Frag fuse, and mine throws outside Revenge Turns. */
export function rallyWeaponControls(
  state: MatchState,
  p: PlayerState,
  pressed: number,
  allowThrow: boolean,
  events: SimEvent[],
): void {
  if (!canAct(p)) return;
  const options = rallyOptions(state, p);
  if (!options.includes(p.rallyWeapon)) p.rallyWeapon = null;
  if (pressed & (Buttons.WEAPON_NEXT | Buttons.WEAPON_PREV)) {
    p.rallyWeapon = cycle(options, p.rallyWeapon, pressed & Buttons.WEAPON_NEXT ? 1 : -1);
    events.push({ type: 'select', player: p.id, weapon: p.rallyWeapon });
  }
  if (pressed & Buttons.FUSE) {
    const f = WEAPON_TUNING.frag;
    p.fuse = p.fuse >= f.maxFuse ? f.minFuse : p.fuse + 1;
    events.push({ type: 'fuse', player: p.id, seconds: p.fuse });
  }
  if (
    allowThrow &&
    pressed & Buttons.FIRE &&
    p.rallyWeapon === 'mine' &&
    p.throwTicks <= 0 &&
    p.swingTick < 0 &&
    isAvailable(state, p, 'mine') &&
    activeMines(state, p.id) < WEAPON_TUNING.mine.maxActive
  ) {
    throwMine(state, p, events);
  }
}

/** Lob a mine onto the opponent's half (GAME_DESIGN §7.2). */
function throwMine(state: MatchState, p: PlayerState, events: SimEvent[]): void {
  const sh = shoulderOf(p);
  const targetX = sideSign(other(p.id)) * nextRange(state.rng, 2, 5.5);
  const a = degToRad(55);
  const d = Math.abs(targetX - sh.x);
  const v = Math.sqrt((9.81 * d) / sin(2 * a));
  spawnProjectile(state, 'mineThrown', p.id, sh.x, sh.y, p.facing * v * cos(a), v * sin(a));
  consumeAmmo(p, 'mine');
  p.throwTicks = WEAPON_TUNING.mine.throwTicks;
  events.push({ type: 'throw', player: p.id, weapon: 'mine' });
  if (!isAvailable(state, p, 'mine')) p.rallyWeapon = null;
}
