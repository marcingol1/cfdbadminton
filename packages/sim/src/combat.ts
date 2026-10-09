import { WEAPON_TUNING } from './data/weapons';
import { clamp, hypot2 } from './math/dmath';
import type { DamageSource, MatchState, PlayerState, SimEvent } from './types';
import { carveCrater, groundAt } from './world';

export const MAX_HP = 100;
/** Body segment used for blast distance, measured up from the feet. */
const BODY_LOW = 0.2;
const BODY_HIGH = 1.6;
const KNOCK_TICKS = 30;
/** Horizontal share of blast knockback. */
const SIDEWAYS_KNOCK = 0.6;
const MAX_KNOCK_VX = 6;
const MAX_KNOCK_VY = 10;
/** `airPeak` value meaning "not in a knockback flight" (no fall damage). */
export const NO_FALL = -1000;

export interface Blast {
  radius: number;
  damage: number;
  knockback: number;
}

/** Shields absorb first (R-55); HP never goes below 0. KOs are resolved at the end of the tick. */
export function applyDamage(
  p: PlayerState,
  amount: number,
  source: DamageSource,
  events: SimEvent[],
): void {
  if (p.dead || amount <= 0) return;
  let rest = Math.round(amount);
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, rest);
    p.shield -= absorbed;
    rest -= absorbed;
  }
  p.hp = Math.max(0, p.hp - rest);
  events.push({ type: 'damage', player: p.id, amount: rest, source, x: p.x, y: p.y + 1.8 });
}

/** R-55: healing never exceeds MAX_HP. */
export function heal(p: PlayerState, amount: number, events: SimEvent[]): void {
  if (p.dead) return;
  const before = p.hp;
  p.hp = Math.min(MAX_HP, p.hp + amount);
  events.push({ type: 'heal', player: p.id, amount: p.hp - before });
}

/** R-55: a new shield replaces the old one; shields don't stack. */
export function raiseShield(p: PlayerState, amount: number, events: SimEvent[]): void {
  if (p.dead) return;
  p.shield = amount;
  events.push({ type: 'shieldUp', player: p.id, amount });
}

/** Launches a player; they lose control briefly and fall damage is armed. */
export function knockback(p: PlayerState, vx: number, vy: number): void {
  // Blasts add to the current motion, but stacked hits (Air Strike, chains) are capped.
  p.vx = clamp(p.vx + vx, -MAX_KNOCK_VX, MAX_KNOCK_VX);
  p.vy = clamp(p.vy + vy, -MAX_KNOCK_VY, MAX_KNOCK_VY);
  if (vy > 0.5) p.grounded = false;
  p.knockTicks = Math.max(p.knockTicks, KNOCK_TICKS);
  p.airPeak = p.airPeak <= NO_FALL ? p.y : Math.max(p.airPeak, p.y);
}

/** Fall damage after a knockback flight (GAME_DESIGN §9). */
export function landFromKnock(p: PlayerState, events: SimEvent[]): void {
  if (p.airPeak <= NO_FALL) return;
  const drop = p.airPeak - p.y;
  p.airPeak = NO_FALL;
  const f = WEAPON_TUNING.fall;
  if (drop > f.safeHeight) applyDamage(p, (drop - f.safeHeight) * f.damagePerMeter, 'fall', events);
}

/** Falloff factor (0..1) and push direction of a blast on a player, or null if out of range. */
function blastHit(
  p: PlayerState,
  x: number,
  y: number,
  r: number,
): { f: number; nx: number; ny: number } | null {
  const by = y < p.y + BODY_LOW ? p.y + BODY_LOW : y > p.y + BODY_HIGH ? p.y + BODY_HIGH : y;
  const dx = p.x - x;
  const dy = by - y;
  const d = hypot2(dx, dy);
  if (d >= r) return null;
  // Push away from the blast, always with some lift.
  let nx = d > 0.001 ? dx / d : 0;
  let ny = (d > 0.001 ? dy / d : 1) + 0.7;
  const n = hypot2(nx, ny);
  nx /= n;
  ny /= n;
  return { f: 1 - d / r, nx, ny };
}

/** Damage a blast at (x, y) would deal to p, before shields. Used by bots to aim and to dodge. */
export function blastDamage(p: PlayerState, x: number, y: number, blast: Blast): number {
  const hit = blastHit(p, x, y, blast.radius);
  return hit ? blast.damage * hit.f : 0;
}

/**
 * Damage and knockback fall off linearly from the center to the radius (GAME_DESIGN §9).
 * Also pushes the shuttle, digs a crater, sets off mines and blows up crates in range.
 */
export function explode(
  state: MatchState,
  x: number,
  y: number,
  blast: Blast,
  source: string,
  events: SimEvent[],
): void {
  events.push({ type: 'explosion', x, y, radius: blast.radius, source });
  const r = blast.radius;

  for (const p of state.players) {
    const hit = blastHit(p, x, y, r);
    if (!hit) continue;
    applyDamage(p, blast.damage * hit.f, 'explosion', events);
    // More of an upward pop than a sideways shove, so a single blast rarely carries
    // someone off the Rooftop from mid-court.
    knockback(
      p,
      hit.nx * blast.knockback * hit.f * SIDEWAYS_KNOCK,
      hit.ny * blast.knockback * hit.f,
    );
  }

  const s = state.shuttle;
  if (s.mode === 'flight' || s.mode === 'dead' || s.mode === 'grounded') {
    const dx = s.x - x;
    const dy = s.y - y;
    const d = hypot2(dx, dy);
    if (d < r && d > 0.001) {
      const push = blast.knockback * 2 * (1 - d / r);
      s.vx += (dx / d) * push;
      s.vy += (dy / d) * push + push * 0.5;
      if (s.mode === 'grounded') s.mode = 'dead';
    }
  }

  carveCrater(state, x, y, r);

  // Chain reactions: mines go off shortly, crates blow up right away.
  for (const m of state.mines) {
    if (hypot2(m.x - x, m.y - y) < r + 0.2)
      m.fuseTicks = m.fuseTicks < 0 ? 6 : Math.min(m.fuseTicks, 6);
  }
  const hitCrates = state.crates.filter((c) => hypot2(c.x - x, c.y + 0.3 - y) < r + 0.3);
  if (hitCrates.length > 0) {
    state.crates = state.crates.filter((c) => !hitCrates.includes(c));
    const cb = WEAPON_TUNING.crate;
    for (const c of hitCrates) {
      explode(
        state,
        c.x,
        c.y + 0.3,
        { radius: cb.radius, damage: cb.damage, knockback: cb.knockback },
        'crate',
        events,
      );
    }
  }

  // Anything resting on the floor follows a new crater down.
  for (const m of state.mines) m.y = Math.min(m.y, groundAt(state, m.x));
}
