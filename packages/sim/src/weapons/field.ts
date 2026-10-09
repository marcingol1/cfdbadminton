import { DT, WALL_X } from '../constants';
import { explode, heal, raiseShield } from '../combat';
import { SCHEMES, WEAPONS, WEAPON_TUNING } from '../data/weapons';
import type { WeaponId } from '../data/weapons';
import { nextFloat, nextInt, nextRange } from '../math/prng';
import type { CrateContents, MatchState, SimEvent } from '../types';
import { PIT_Y, groundAt, halfOwner, sideSign } from '../world';

/** Mines arm, wait for someone to step close (R-53), blink, and explode. */
export function stepMines(state: MatchState, events: SimEvent[]): void {
  const t = WEAPON_TUNING.mine;
  for (const m of state.mines.slice()) {
    const ground = groundAt(state, m.x);
    if (ground <= PIT_Y) {
      state.mines = state.mines.filter((q) => q !== m);
      continue;
    }
    m.y = ground;
    if (m.fuseTicks > 0) {
      if (--m.fuseTicks === 0) {
        state.mines = state.mines.filter((q) => q !== m);
        explode(state, m.x, m.y + 0.1, WEAPONS.mine, 'mine', events);
      }
      continue;
    }
    if (m.armTicks > 0) {
      if (--m.armTicks === 0) events.push({ type: 'mineArmed', x: m.x });
      continue;
    }
    for (const p of state.players) {
      if (p.dead) continue;
      if (Math.abs(p.x - m.x) < t.triggerRadius && p.y - m.y < 1 && p.y > m.y - 0.4) {
        m.fuseTicks = t.fuseTicks;
        events.push({ type: 'mineTriggered', x: m.x });
        break;
      }
    }
  }
}

/** Mines on the field plus mines still in the air, per owner (R-53). */
export function activeMines(state: MatchState, owner: 0 | 1): number {
  return (
    state.mines.filter((m) => m.owner === owner).length +
    state.projectiles.filter((p) => p.kind === 'mineThrown' && p.owner === owner).length
  );
}

const CRATE_WEAPONS: WeaponId[] = [
  'frag',
  'shock',
  'lead',
  'cluster',
  'ghost',
  'mine',
  'mortar',
  'homing',
  'airstrike',
  'medkit',
  'shield',
];

/** §8: after a rally, maybe parachute a crate onto a random half (one per half at most). */
export function maybeDropCrate(state: MatchState, events: SimEvent[]): void {
  const chance = SCHEMES[state.config.scheme].crateChance;
  if (chance <= 0 || nextFloat(state.rng) >= chance) return;
  const side = nextFloat(state.rng) < 0.5 ? 0 : 1;
  if (state.crates.some((c) => halfOwner(c.x) === side)) return;
  const x = sideSign(side) * nextRange(state.rng, 1, 6.2);
  const roll = nextFloat(state.rng);
  const contents: CrateContents = roll < 0.6 ? 'weapon' : roll < 0.85 ? 'health' : 'shield';
  const weapon =
    contents === 'weapon' ? CRATE_WEAPONS[nextInt(state.rng, 0, CRATE_WEAPONS.length - 1)]! : null;
  state.crates.push({ id: state.nextId++, x, y: 11, landed: false, contents, weapon });
  events.push({ type: 'crateDrop', x });
}

/** Crates float down, land, and are collected by walking into them. */
export function stepCrates(state: MatchState, events: SimEvent[]): void {
  const t = WEAPON_TUNING.crate;
  for (const c of state.crates.slice()) {
    const ground = groundAt(state, c.x);
    if (!c.landed) {
      c.y -= t.fallSpeed * DT;
      if (c.y <= ground) {
        c.y = ground;
        c.landed = ground > PIT_Y;
      }
    } else {
      c.y = Math.max(ground, c.y - t.fallSpeed * DT);
    }
    if (c.y < -WEAPON_TUNING.pitDepth || Math.abs(c.x) > WALL_X + 2) {
      state.crates = state.crates.filter((q) => q !== c);
      continue;
    }
    for (const p of state.players) {
      if (p.dead || Math.abs(p.x - c.x) > 0.5 || Math.abs(p.y - c.y) > 1.2) continue;
      state.crates = state.crates.filter((q) => q !== c);
      if (c.contents === 'weapon' && c.weapon) {
        if (p.ammo[c.weapon] >= 0) p.ammo[c.weapon]++;
      } else if (c.contents === 'health') {
        heal(p, t.health, events);
      } else {
        raiseShield(p, t.shield, events);
      }
      events.push({ type: 'crateCollect', player: p.id, contents: c.contents, weapon: c.weapon });
      break;
    }
  }
}

/** Shooting a crate makes it explode (Worms-style); used by tests and the blast chain. */
export function detonateCrate(state: MatchState, id: number, events: SimEvent[]): void {
  const c = state.crates.find((q) => q.id === id);
  if (!c) return;
  state.crates = state.crates.filter((q) => q !== c);
  const t = WEAPON_TUNING.crate;
  explode(
    state,
    c.x,
    c.y + 0.3,
    { radius: t.radius, damage: t.damage, knockback: t.knockback },
    'crate',
    events,
  );
}
