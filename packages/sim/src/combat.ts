import { WEAPON_TUNING } from './data/weapons';
import { hypot2 } from './math/dmath';
import type { DamageSource, MatchState, PlayerState, SimEvent } from './types';
import { carveCrater, groundAt } from './world';

export const MAX_HP = 100;
/** Body segment used for blast distance, measured up from the feet. */
const BODY_LOW = 0.2;
const BODY_HIGH = 1.6;
const KNOCK_TICKS = 30;
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
  p.vx += vx;
  p.vy += vy;
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
    const by = y < p.y + BODY_LOW ? p.y + BODY_LOW : y > p.y + BODY_HIGH ? p.y + BODY_HIGH : y;
    const dx = p.x - x;
    const dy = by - y;
    const d = hypot2(dx, dy);
    if (d >= r) continue;
    const f = 1 - d / r;
    applyDamage(p, blast.damage * f, 'explosion', events);
    // Push away from the blast, always with some lift.
    const len = d > 0.001 ? d : 1;
    let nx = d > 0.001 ? dx / len : 0;
    let ny = (d > 0.001 ? dy / len : 1) + 0.7;
    const n = hypot2(nx, ny);
    nx /= n;
    ny /= n;
    knockback(p, nx * blast.knockback * f, ny * blast.knockback * f);
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
