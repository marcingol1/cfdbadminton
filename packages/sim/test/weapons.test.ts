import { describe, expect, it } from 'vitest';
import {
  Buttons,
  MAX_HP,
  NEUTRAL_INPUT,
  WEAPONS,
  WEAPON_TUNING,
  createMatch,
  explode,
  flightEnv,
  isAvailable,
  rallyOptions,
  shoulderOf,
  simulateProjectile,
  step,
  summarizeFlight,
} from '../src';
import type { InputFrame, MatchConfig, MatchState, PlayerId, SimEvent } from '../src';
import { idle, rallyState, runUntil } from './helpers';

const STANDARD: Partial<MatchConfig> = { scheme: 'standard' };

function press(player: PlayerId, frame: Partial<InputFrame>): readonly [InputFrame, InputFrame] {
  const f = { ...NEUTRAL_INPUT, ...frame };
  return player === 0 ? [f, NEUTRAL_INPUT] : [NEUTRAL_INPUT, f];
}

/** Puts the shuttle at player p's sweet spot and swings once; returns the events. */
function swingAt(s: MatchState, p: PlayerId, frame: Partial<InputFrame> = {}): SimEvent[] {
  const pl = s.players[p];
  const sh = shoulderOf(pl);
  Object.assign(s.shuttle, {
    mode: 'flight',
    x: sh.x + pl.facing * 0.6,
    y: sh.y + 0.2,
    vx: 0,
    vy: 0,
  });
  const out: SimEvent[] = [];
  for (let i = 0; i < 8 && !out.some((e) => e.type === 'hit'); i++) {
    out.push(...step(s, press(p, { ...frame, buttons: i === 0 ? Buttons.HIT : 0 })));
    if (!out.some((e) => e.type === 'hit')) {
      Object.assign(s.shuttle, { x: sh.x + pl.facing * 0.6, y: sh.y + 0.2, vx: 0, vy: 0 });
    }
  }
  return out;
}

/** A rally where player 1 just hit and player 0 is about to play, with `weapon` selected. */
function loadedRally(
  weapon: MatchState['players'][0]['rallyWeapon'],
  config = STANDARD,
): MatchState {
  const s = rallyState({ x: 0, y: 0, vx: 0, vy: 0 }, 1, 1, config);
  s.rallyCount = 10;
  s.players[0].x = -3;
  s.players[0].rallyWeapon = weapon;
  return s;
}

describe('weapon selection, ammo and delays', () => {
  it('cycles through the available rally weapons, starting from the standard shuttle', () => {
    const s = createMatch(STANDARD, 1);
    s.rallyCount = 10;
    const p = s.players[0];
    expect(rallyOptions(s, p)).toEqual([null, 'frag', 'shock', 'lead', 'cluster', 'ghost', 'mine']);
    step(s, press(0, { buttons: Buttons.WEAPON_NEXT }));
    expect(p.rallyWeapon).toBe('frag');
    step(s, idle);
    step(s, press(0, { buttons: Buttons.WEAPON_PREV }));
    expect(p.rallyWeapon).toBeNull();
  });

  it('R-52: heavy weapons stay locked until enough rallies are played', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[0];
    expect(isAvailable(s, p, 'cluster')).toBe(false);
    expect(isAvailable(s, p, 'mine')).toBe(false);
    s.rallyCount = WEAPONS.cluster.delay;
    expect(isAvailable(s, p, 'cluster')).toBe(true);
    // Chaos has no delays.
    const c = createMatch({ scheme: 'chaos' }, 1);
    expect(isAvailable(c, c.players[0], 'airstrike')).toBe(true);
  });

  it('R-54: no ammo, no weapon; the Purist scheme has none at all', () => {
    const s = createMatch(STANDARD, 1);
    s.rallyCount = 10;
    s.players[0].ammo.frag = 0;
    expect(rallyOptions(s, s.players[0])).not.toContain('frag');
    const purist = createMatch({ scheme: 'purist' }, 1);
    purist.rallyCount = 10;
    expect(rallyOptions(purist, purist.players[0])).toEqual([null]);
  });

  it('the fuse cycles 1..5 seconds', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[0];
    expect(p.fuse).toBe(3);
    for (const expected of [4, 5, 1]) {
      step(s, press(0, { buttons: Buttons.FUSE }));
      step(s, idle);
      expect(p.fuse).toBe(expected);
    }
  });
});

describe('loaded shots', () => {
  it('R-51: a hit uses the loaded weapon and its ammo', () => {
    const s = loadedRally('frag');
    const hit = swingAt(s, 0).find((e) => e.type === 'hit');
    expect(hit?.type === 'hit' && hit.weapon).toBe('frag');
    expect(s.shuttle.weapon).toBe('frag');
    expect(s.shuttle.fuseTicks).toBeGreaterThan(2 * 60);
    expect(s.players[0].ammo.frag).toBe(1);
    expect(s.players[0].rallyWeapon).toBeNull();
  });

  it('R-51: losing the rally before hitting keeps the ammo and clears the loadout', () => {
    const s = rallyState({ x: -3, y: 0.3, vx: 0, vy: -5 }, 1, 1, STANDARD);
    s.players[0].x = -5;
    s.players[0].rallyWeapon = 'shock';
    runUntil(s, 'point', 30);
    expect(s.players[0].ammo.shock).toBe(3);
    expect(s.players[0].rallyWeapon).toBeNull();
  });

  it('R-11: serves are always standard shuttles', () => {
    const s = createMatch(STANDARD, 2);
    const server = s.players[s.server];
    server.rallyWeapon = 'frag';
    s.rallyCount = 10;
    step(s, idle);
    step(s, press(s.server, { buttons: Buttons.HIT }));
    expect(s.phase).toBe('rally');
    expect(s.shuttle.weapon).toBeNull();
    expect(server.ammo.frag).toBe(2);
  });

  it('R-50: a Frag stays live when returned and its fuse keeps ticking (hot potato)', () => {
    const s = loadedRally(null);
    Object.assign(s.shuttle, { weapon: 'frag', fuseTicks: 200 });
    s.players[0].rallyWeapon = 'shock';
    swingAt(s, 0);
    expect(s.shuttle.weapon).toBe('frag');
    expect(s.shuttle.fuseTicks).toBeLessThan(200);
    // The returning player's own loaded shot isn't used (one weapon per shuttle).
    expect(s.players[0].ammo.shock).toBe(3);
  });

  it('R-27: a Frag that blows up in flight counts as landing below it', () => {
    const s = rallyState({ x: 3, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    Object.assign(s.shuttle, { weapon: 'frag', fuseTicks: 1 });
    const point = runUntil(s, 'point', 3);
    expect(point).toMatchObject({ winner: 0, reason: 'in' });
    expect(s.shuttle.mode).toBe('gone');

    const out = rallyState({ x: 7.5, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    Object.assign(out.shuttle, { weapon: 'frag', fuseTicks: 1 });
    expect(runUntil(out, 'point', 3)).toMatchObject({ winner: 1, reason: 'out' });
  });

  it('a Frag that already landed still explodes when its fuse runs out', () => {
    const s = rallyState({ x: 3, y: 0.3, vx: 0, vy: -5 }, 0, 1, STANDARD);
    Object.assign(s.shuttle, { weapon: 'frag', fuseTicks: 60 });
    s.players[1].x = 3.4;
    runUntil(s, 'point', 10);
    expect(runUntil(s, 'explosion', 80)).not.toBeNull();
    expect(s.players[1].hp).toBeLessThan(MAX_HP);
  });

  it('a Shock Shuttle hurts and stuns whoever hits it next, once', () => {
    const s = loadedRally(null);
    s.shuttle.weapon = 'shock';
    const events = swingAt(s, 0);
    expect(events.some((e) => e.type === 'shocked' && e.player === 0)).toBe(true);
    expect(s.players[0].hp).toBe(MAX_HP - WEAPONS.shock.damage);
    expect(s.players[0].stunTicks).toBeGreaterThan(0);
    expect(s.shuttle.weapon).toBeNull();
  });

  it('a Lead Shuttle has far less drag', () => {
    const s = loadedRally(null);
    const still = flightEnv(s).k;
    s.shuttle.weapon = 'lead';
    expect(flightEnv(s).k).toBeCloseTo(still * WEAPON_TUNING.lead.dragMultiplier, 10);
    const launch = { x: -4, y: 2.5, vx: 40, vy: -2 };
    const plain = summarizeFlight(launch, { ...flightEnv(s), k: still }).landX;
    const lead = summarizeFlight(launch, flightEnv(s)).landX;
    expect(lead).toBeGreaterThan(plain);
  });

  it('a Lead Shuttle to the body deals 25 damage and knocks back', () => {
    const s = rallyState({ x: 1, y: 1.2, vx: 30, vy: 0 }, 0, 1, STANDARD);
    s.shuttle.weapon = 'lead';
    s.players[1].x = 3;
    runUntil(s, 'bodyHit', 60);
    expect(s.players[1].hp).toBe(MAX_HP - WEAPONS.lead.damage);
    expect(s.players[1].vx).toBeGreaterThan(0);
  });

  it('a standard smash to the body deals 3–8 damage (and the point, R-22)', () => {
    const s = rallyState({ x: 1, y: 1.2, vx: 45, vy: 0 }, 0, 1, STANDARD);
    s.players[1].x = 3;
    runUntil(s, 'bodyHit', 60);
    const lost = MAX_HP - s.players[1].hp;
    expect(lost).toBeGreaterThanOrEqual(3);
    expect(lost).toBeLessThanOrEqual(8);
    expect(s.lastPoint?.reason).toBe('body');
  });

  it('a Cluster Shuttle splits into bomblets when it lands', () => {
    const s = rallyState({ x: 3, y: 0.3, vx: 0, vy: -5 }, 0, 1, STANDARD);
    s.shuttle.weapon = 'cluster';
    runUntil(s, 'point', 10);
    expect(s.projectiles.filter((p) => p.kind === 'clusterBomb')).toHaveLength(
      WEAPON_TUNING.cluster.bomblets,
    );
    let explosions = 0;
    for (let i = 0; i < 200; i++)
      explosions += step(s, idle).filter((e) => e.type === 'explosion').length;
    expect(explosions).toBe(WEAPON_TUNING.cluster.bomblets);
  });

  it('a Ghost Shuttle turns invisible after crossing the net', () => {
    const s = rallyState({ x: -0.3, y: 3, vx: 15, vy: 0 }, 0, 1, STANDARD);
    s.shuttle.weapon = 'ghost';
    for (let i = 0; i < 4; i++) step(s, idle);
    expect(s.shuttle.x).toBeGreaterThan(0);
    expect(s.shuttle.ghostTicks).toBeGreaterThan(0);
  });
});

describe('mines', () => {
  it('are thrown onto the opponent half, arm, trigger on proximity and explode', () => {
    const s = loadedRally('mine');
    s.wind = 0;
    s.shuttle.mode = 'grounded';
    step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.players[0].ammo.mine).toBe(1);
    expect(s.players[0].throwTicks).toBeGreaterThan(0);
    for (let i = 0; i < 180 && s.mines.length === 0; i++) step(s, idle);
    expect(s.mines).toHaveLength(1);
    const mine = s.mines[0]!;
    expect(mine.x).toBeGreaterThan(1.5);
    runUntil(s, 'mineArmed', 80);
    s.players[1].x = mine.x + 0.2;
    expect(runUntil(s, 'mineTriggered', 5)).not.toBeNull();
    expect(runUntil(s, 'explosion', WEAPON_TUNING.mine.fuseTicks + 2)).not.toBeNull();
    expect(s.players[1].hp).toBeLessThan(MAX_HP);
    expect(s.mines).toHaveLength(0);
  });

  it('R-53: at most 2 active mines per player', () => {
    const s = loadedRally('mine', { scheme: 'chaos' });
    s.shuttle.mode = 'grounded';
    for (let k = 0; k < 4; k++) {
      step(s, press(0, { buttons: Buttons.FIRE }));
      for (let i = 0; i < 40; i++) step(s, idle);
    }
    expect(s.mines.length + s.projectiles.length).toBe(2);
    expect(s.players[0].ammo.mine).toBe(2);
  });

  it('blasts set off nearby mines (chain reaction)', () => {
    const s = createMatch(STANDARD, 1);
    s.mines.push({ id: 99, owner: 0, x: 4, y: 0, armTicks: 50, fuseTicks: -1 });
    explode(s, 4.5, 0.2, WEAPONS.rocket, 'test', []);
    expect(runUntil(s, 'explosion', 10)).not.toBeNull();
    expect(s.mines).toHaveLength(0);
  });
});

describe('supply crates (§8)', () => {
  it('drop after a rally in Chaos, land, and are collected by walking into them', () => {
    const s = rallyState({ x: 3, y: 0.3, vx: 0, vy: -5 }, 0, 1, {
      scheme: 'chaos',
      revengeChance: 0,
    });
    s.players[0].hp = 50;
    const drop = runUntil(s, 'crateDrop', 900, (st) =>
      st.phase === 'revenge' ? skipRevenge(st) : idle,
    );
    expect(drop).not.toBeNull();
    const crate = s.crates[0]!;
    // Keep everyone away while it parachutes down.
    s.phase = 'matchOver';
    s.players[0].x = -8;
    s.players[1].x = 8;
    for (let i = 0; i < 400 && !crate.landed; i++) step(s, idle);
    expect(crate.landed).toBe(true);
    const owner = crate.x < 0 ? 0 : 1;
    s.players[owner].x = crate.x;
    const got = runUntil(s, 'crateCollect', 3);
    expect(got?.player).toBe(owner);
    expect(s.crates).toHaveLength(0);
  });

  it('blow up when caught in a blast', () => {
    const s = createMatch(STANDARD, 1);
    s.crates.push({ id: 7, x: 4, y: 0, landed: true, contents: 'health', weapon: null });
    const events: SimEvent[] = [];
    explode(s, 4.6, 0.3, WEAPONS.rocket, 'test', events);
    expect(events.filter((e) => e.type === 'explosion')).toHaveLength(2);
    expect(s.crates).toHaveLength(0);
  });
});

describe('projectile simulation (for bots)', () => {
  it('a mortar splits into three bomblets', () => {
    const s = createMatch(STANDARD, 1);
    s.wind = 0;
    const impacts = simulateProjectile(s, 'mortar', 0, -3, 1.5, 6, 10);
    expect(impacts).toHaveLength(3);
  });

  it('a rocket lands where the real one does', () => {
    const s = createMatch(STANDARD, 1);
    s.wind = 0.7;
    const [predicted] = simulateProjectile(s, 'rocket', 0, -3, 1.5, 9, 7);
    s.projectiles.push({
      id: 1,
      kind: 'rocket',
      owner: 0,
      x: -3,
      y: 1.5,
      vx: 9,
      vy: 7,
      age: 0,
      targetX: 0,
      targetY: 0,
    });
    s.phase = 'matchOver';
    const boom = runUntil(s, 'explosion', 400);
    expect(boom?.type === 'explosion' && boom.x).toBeCloseTo(predicted!.x, 6);
  });
});

/** Inputs that skip a Revenge Turn: pick "skip" (null) and confirm. */
function skipRevenge(s: MatchState): readonly [InputFrame, InputFrame] {
  const shooter = s.revenge!.shooter;
  const p = s.players[shooter];
  if (p.revengeWeapon !== null && s.tick % 2 === 0)
    return press(shooter, { buttons: Buttons.WEAPON_PREV });
  if (p.revengeWeapon === null && s.tick % 2 === 0)
    return press(shooter, { buttons: Buttons.FIRE });
  return idle;
}
