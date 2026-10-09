import { describe, expect, it } from 'vitest';
import {
  MAX_HP,
  WEAPONS,
  createMatch,
  explode,
  groundAt,
  heal,
  knockback,
  raiseShield,
  step,
} from '../src';
import type { SimEvent } from '../src';
import { idle, rallyState, runUntil } from './helpers';

const STANDARD = { scheme: 'standard' } as const;

describe('explosions (GAME_DESIGN §9)', () => {
  it('deal full damage at the center, falling off to nothing at the radius', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[0];
    p.x = -4;
    const events: SimEvent[] = [];
    explode(s, -4, 0.8, WEAPONS.frag, 'test', events);
    expect(p.hp).toBe(MAX_HP - WEAPONS.frag.damage);

    const q = s.players[1];
    q.x = 4;
    explode(s, 4 - WEAPONS.frag.radius / 2, 0.8, WEAPONS.frag, 'test', events);
    expect(q.hp).toBeGreaterThan(MAX_HP - WEAPONS.frag.damage * 0.6);
    expect(q.hp).toBeLessThan(MAX_HP - WEAPONS.frag.damage * 0.4);

    const hpBefore = q.hp;
    explode(s, 4 + WEAPONS.frag.radius + 0.5, 0.8, WEAPONS.frag, 'test', events);
    expect(q.hp).toBe(hpBefore);
  });

  it('knock players away and up, and dig a crater', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[1];
    p.x = 3;
    explode(s, 2.5, 0.2, WEAPONS.frag, 'test', []);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vy).toBeGreaterThan(0);
    expect(groundAt(s, 2.5)).toBeLessThan(-0.3);
    expect(groundAt(s, 6)).toBe(0);
  });

  it('a blast high in the air leaves the floor alone', () => {
    const s = createMatch(STANDARD, 1);
    explode(s, 2, 6, WEAPONS.frag, 'test', []);
    expect(groundAt(s, 2)).toBe(0);
  });

  it('players walk down into craters', () => {
    const s = createMatch(STANDARD, 1);
    explode(s, -3, 0, WEAPONS.frag, 'test', []);
    const p = s.players[0];
    s.players[0].hp = MAX_HP;
    p.x = -3;
    p.vx = 0;
    p.vy = 0;
    for (let i = 0; i < 30; i++) step(s, idle);
    expect(p.y).toBeLessThan(-0.2);
    expect(p.grounded).toBe(true);
  });
});

describe('R-55 healing and shields', () => {
  it('healing never exceeds 100 HP', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[0];
    p.hp = 90;
    heal(p, 25, []);
    expect(p.hp).toBe(MAX_HP);
  });

  it('a shield absorbs damage first, and a new shield replaces the old one', () => {
    const s = createMatch(STANDARD, 1);
    const p = s.players[0];
    p.x = -4;
    raiseShield(p, 30, []);
    raiseShield(p, 30, []);
    expect(p.shield).toBe(30);
    explode(s, -4, 0.8, WEAPONS.frag, 'test', []);
    expect(p.shield).toBe(0);
    expect(p.hp).toBe(MAX_HP - (WEAPONS.frag.damage - 30));
  });
});

describe('fall damage', () => {
  it('a long knockback flight hurts on landing; a short one does not', () => {
    const s = createMatch({ scheme: 'purist' }, 1);
    s.phase = 'matchOver';
    const p = s.players[0];
    p.x = -4;
    knockback(p, 0, 12);
    for (let i = 0; i < 180; i++) step(s, idle);
    expect(p.grounded).toBe(true);
    expect(p.hp).toBeLessThan(MAX_HP);

    const q = s.players[1];
    q.x = 4;
    knockback(q, 0, 4);
    for (let i = 0; i < 120; i++) step(s, idle);
    expect(q.hp).toBe(MAX_HP);
  });
});

describe('KO rules', () => {
  it('R-02: a KO ends the match at once, whatever the score', () => {
    const s = rallyState({ x: 3, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    s.score = [0, 10];
    s.players[1].hp = 5;
    s.players[1].x = 4;
    explode(s, 4, 0.8, WEAPONS.frag, 'test', []);
    const over = runUntil(s, 'matchOver', 2);
    expect(over).toEqual({ type: 'matchOver', winner: 0, reason: 'ko' });
    expect(s.winReason).toBe('ko');
    for (let i = 0; i < s.config.tuning.pointPauseTicks + 1; i++) step(s, idle);
    expect(s.phase).toBe('matchOver');
  });

  it('R-03: killing yourself hands the win to the opponent', () => {
    const s = rallyState({ x: 3, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    s.players[0].hp = 5;
    s.players[0].x = -4;
    explode(s, -4, 0.8, WEAPONS.frag, 'self', []);
    expect(runUntil(s, 'matchOver', 2)?.winner).toBe(1);
  });

  it('R-04: a double KO goes to the player with more points', () => {
    const s = rallyState({ x: 3, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    s.score = [4, 6];
    for (const p of s.players) p.hp = 3;
    s.players[0].x = -0.6;
    s.players[1].x = 0.6;
    explode(s, 0, 0.8, WEAPONS.frag, 'test', []);
    expect(runUntil(s, 'matchOver', 2)?.winner).toBe(1);
  });

  it('R-04: a double KO on equal points goes to Sudden Death at 1 HP', () => {
    const s = rallyState({ x: 3, y: 4, vx: 0, vy: 0 }, 0, 1, STANDARD);
    s.score = [5, 5];
    for (const p of s.players) p.hp = 3;
    s.players[0].x = -0.6;
    s.players[1].x = 0.6;
    explode(s, 0, 0.8, WEAPONS.frag, 'test', []);
    expect(runUntil(s, 'suddenDeath', 2)).not.toBeNull();
    expect(s.winner).toBeNull();
    expect(s.players.map((p) => [p.hp, p.dead])).toEqual([
      [1, false],
      [1, false],
    ]);
    // The next point wins the match.
    runUntil(s, 'newRally', 200);
    s.phase = 'rally';
    s.rally.lastHitter = 0;
    s.rally.isServe = false;
    Object.assign(s.shuttle, { mode: 'flight', x: 3, y: 0.3, vx: 0, vy: -5 });
    expect(runUntil(s, 'matchOver', 30)).toEqual({
      type: 'matchOver',
      winner: 0,
      reason: 'points',
    });
  });

  it('R-06: when the time limit runs out, Sudden Death sets everyone to 1 HP', () => {
    const s = createMatch({ scheme: 'purist', timeLimitSec: 1 }, 1);
    const ev = runUntil(s, 'suddenDeath', 120);
    expect(ev).not.toBeNull();
    expect(s.suddenDeath).toBe(true);
    expect(s.players.map((p) => p.hp)).toEqual([1, 1]);
  });
});

describe('R-05 best of 3', () => {
  it('winning a game starts the next one: score and craters reset, HP +20, ammo kept', () => {
    const s = rallyState({ x: 3, y: 0.3, vx: 0, vy: -5 }, 0, 1, { scheme: 'standard', bestOf: 3 });
    s.score = [10, 3];
    s.players[0].hp = 50;
    s.players[0].ammo.frag = 1;
    explode(s, -3, 0, WEAPONS.frag, 'crater', []);
    s.players[0].hp = 50;
    const over = runUntil(s, 'gameOver', 30);
    expect(over).toEqual({ type: 'gameOver', winner: 0, games: [1, 0] });
    expect(s.winner).toBeNull();
    runUntil(s, 'newRally', 200);
    expect(s.score).toEqual([0, 0]);
    expect(s.players[0].hp).toBe(70);
    expect(groundAt(s, -3)).toBe(0);
    expect(s.players[0].ammo.frag).toBe(1);
  });

  it('two games win the match', () => {
    const s = rallyState({ x: 3, y: 0.3, vx: 0, vy: -5 }, 0, 1, { scheme: 'purist', bestOf: 3 });
    s.games = [1, 1];
    s.score = [10, 8];
    expect(runUntil(s, 'matchOver', 30)).toEqual({
      type: 'matchOver',
      winner: 0,
      reason: 'points',
    });
  });
});

describe('R-28 / R-29', () => {
  it('R-28: damage alone does not end a rally', () => {
    const s = rallyState({ x: -3, y: 6, vx: 0, vy: 0 }, 1, 1, STANDARD);
    s.players[1].x = 4;
    explode(s, 4, 0.8, WEAPONS.rocket, 'test', []);
    step(s, idle);
    expect(s.phase).toBe('rally');
    expect(s.players[1].hp).toBeLessThan(MAX_HP);
  });

  it('R-29: being knocked into the net is a fault', () => {
    const s = rallyState({ x: -3, y: 6, vx: 0, vy: 0 }, 1, 1, STANDARD);
    const p = s.players[1];
    p.x = 0.5;
    knockback(p, -10, 1);
    const point = runUntil(s, 'point', 30);
    expect(point).toMatchObject({ winner: 0, reason: 'netTouch' });
  });

  it('walking into the net is not a fault', () => {
    const s = rallyState({ x: -3, y: 6, vx: 0, vy: 0 }, 1, 1, STANDARD);
    s.players[1].x = 0.5;
    for (let i = 0; i < 30; i++) step(s, [idle[0], { moveX: -127, moveY: 0, buttons: 0 }]);
    expect(s.phase).toBe('rally');
  });
});

describe('pits (Rooftop)', () => {
  it('falling off the edge is an instant KO', () => {
    const s = rallyState({ x: -3, y: 6, vx: 0, vy: 0 }, 1, 1, {
      scheme: 'standard',
      arena: 'rooftop',
    });
    s.wind = 0;
    s.players[1].x = 8.5;
    const ko = runUntil(s, 'ko', 240, () => [idle[0], { moveX: 127, moveY: 0, buttons: 0 }]);
    expect(ko?.player).toBe(1);
    expect(s.winner).toBe(0);
  });
});
