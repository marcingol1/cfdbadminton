import { describe, expect, it } from 'vitest';
import {
  Buttons,
  MAX_HP,
  NEUTRAL_INPUT,
  REVENGE_RESOLVE_TICKS,
  REVENGE_TURN_TICKS,
  WEAPONS,
  createMatch,
  startRevenge,
  step,
} from '../src';
import type { InputFrame, MatchConfig, MatchState, PlayerId } from '../src';
import { idle, rallyState, runUntil } from './helpers';

function press(player: PlayerId, frame: Partial<InputFrame>): readonly [InputFrame, InputFrame] {
  const f = { ...NEUTRAL_INPUT, ...frame };
  return player === 0 ? [f, NEUTRAL_INPUT] : [NEUTRAL_INPUT, f];
}

/** A Revenge Turn for player 0 with no wind; players at fixed spots. */
function revenge(config: Partial<MatchConfig> = { scheme: 'standard' }): MatchState {
  const s = createMatch(config, 3);
  s.wind = 0;
  s.players[0].x = -3;
  s.players[1].x = 3;
  startRevenge(s, 0, []);
  return s;
}

/** Hold FIRE for `ticks` ticks, then release. */
function chargeAndRelease(s: MatchState, ticks: number) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...step(s, press(0, { buttons: Buttons.FIRE })));
  events.push(...step(s, idle));
  return events;
}

describe('R-40 who gets a Revenge Turn', () => {
  it('the loser of a point gets one after the point pause', () => {
    const s = rallyState({ x: -3, y: 0.3, vx: 0, vy: -5 }, 1, 1, { scheme: 'standard' });
    runUntil(s, 'point', 10);
    const start = runUntil(s, 'revengeStart', s.config.tuning.pointPauseTicks + 2);
    expect(start).toEqual({ type: 'revengeStart', shooter: 0, target: 1 });
    expect(s.phase).toBe('revenge');
  });

  it('no Revenge Turns in the Purist scheme', () => {
    const s = rallyState({ x: -3, y: 0.3, vx: 0, vy: -5 }, 1, 1, { scheme: 'purist' });
    runUntil(s, 'point', 10);
    for (let i = 0; i <= s.config.tuning.pointPauseTicks; i++) step(s, idle);
    expect(s.phase).toBe('serve');
  });

  it('no Revenge Turn after the point that wins a game', () => {
    const s = rallyState({ x: -3, y: 0.3, vx: 0, vy: -5 }, 1, 1, { scheme: 'standard', bestOf: 3 });
    s.score = [0, 10];
    runUntil(s, 'gameOver', 10);
    for (let i = 0; i <= s.config.tuning.pointPauseTicks; i++) step(s, idle);
    expect(s.phase).toBe('serve');
  });
});

describe('R-41 one shot per turn, on a timer', () => {
  it('fires exactly one rocket however often FIRE is pressed', () => {
    const s = revenge();
    chargeAndRelease(s, 30);
    expect(s.projectiles).toHaveLength(1);
    chargeAndRelease(s, 30);
    chargeAndRelease(s, 30);
    expect(s.projectiles.filter((p) => p.kind === 'rocket').length).toBeLessThanOrEqual(1);
    expect(s.players[0].ammo.rocket).toBe(-1);
  });

  it('holding FIRE charges power; a full charge fires by itself', () => {
    const s = revenge();
    for (let i = 0; i < 20; i++) step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.revenge!.power).toBeGreaterThan(0.2);
    expect(s.revenge!.fired).toBe(false);
    for (let i = 0; i < 80; i++) step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.revenge!.fired).toBe(true);
    expect(s.revenge!.power).toBe(1);
  });

  it('up/down aims the shot', () => {
    const s = revenge();
    const a0 = s.revenge!.angle;
    for (let i = 0; i < 30; i++) step(s, press(0, { moveY: 127 }));
    expect(s.revenge!.angle).toBeGreaterThan(a0 + 20);
  });

  it('the turn is lost when the timer runs out', () => {
    const s = revenge();
    for (let i = 0; i < REVENGE_TURN_TICKS + 1; i++) step(s, idle);
    expect(s.revenge === null || s.revenge.fired).toBe(true);
    expect(s.projectiles).toHaveLength(0);
    expect(runUntil(s, 'newRally', 100)).not.toBeNull();
  });
});

describe('R-42 the target can move (or not)', () => {
  it('the target can run while the shooter aims', () => {
    const s = revenge();
    for (let i = 0; i < 30; i++) step(s, [NEUTRAL_INPUT, { ...NEUTRAL_INPUT, moveX: 127 }]);
    expect(s.players[1].x).toBeGreaterThan(4);
  });

  it('classic targeting freezes the target', () => {
    const s = revenge({ scheme: 'standard', classicTargeting: true });
    for (let i = 0; i < 30; i++) step(s, [NEUTRAL_INPUT, { ...NEUTRAL_INPUT, moveX: 127 }]);
    expect(s.players[1].x).toBe(3);
  });

  it('the target cannot swing or throw during the turn', () => {
    const s = revenge();
    s.players[1].rallyWeapon = 'mine';
    const events = step(s, [
      NEUTRAL_INPUT,
      { ...NEUTRAL_INPUT, buttons: Buttons.HIT | Buttons.FIRE },
    ]);
    expect(events.some((e) => e.type === 'swing' || e.type === 'throw')).toBe(false);
  });
});

describe('R-43 / R-44 / R-45', () => {
  it('R-43: the turn resolves for a while after firing, then play resumes with a serve', () => {
    const s = revenge();
    chargeAndRelease(s, 30);
    for (let i = 0; i < REVENGE_RESOLVE_TICKS - 5; i++) step(s, idle);
    expect(s.phase).toBe('revenge');
    expect(runUntil(s, 'newRally', 400)).not.toBeNull();
  });

  it('R-44: a Revenge Turn never changes the score', () => {
    const s = revenge();
    s.score = [3, 4];
    chargeAndRelease(s, 40);
    runUntil(s, 'newRally', 800);
    expect(s.score).toEqual([3, 4]);
  });

  it('R-45: you can blow yourself up', () => {
    const s = revenge();
    // Straight up with no power: it comes down next to the shooter.
    for (let i = 0; i < 120; i++) step(s, press(0, { moveY: 127 }));
    step(s, press(0, { buttons: Buttons.FIRE }));
    step(s, idle);
    runUntil(s, 'explosion', 300);
    expect(s.players[0].hp).toBeLessThan(MAX_HP);
  });

  it('a well-aimed rocket hurts the target', () => {
    const s = revenge();
    // ~6 m away at 35°: a medium charge lands on the target.
    let hit = false;
    for (let ticks = 10; ticks <= 70 && !hit; ticks += 4) {
      const t = revenge();
      chargeAndRelease(t, ticks);
      runUntil(t, 'explosion', 400);
      hit = t.players[1].hp < MAX_HP;
    }
    expect(hit).toBe(true);
    expect(s.players[1].hp).toBe(MAX_HP);
  });
});

describe('Revenge weapons and utilities', () => {
  function select(s: MatchState, weapon: string | null) {
    for (let i = 0; i < 20 && s.players[0].revengeWeapon !== weapon; i++) {
      step(s, press(0, { buttons: Buttons.WEAPON_NEXT }));
      step(s, idle);
    }
    expect(s.players[0].revengeWeapon).toBe(weapon);
  }

  it('Medkit heals instead of attacking', () => {
    const s = revenge();
    s.players[0].hp = 40;
    select(s, 'medkit');
    step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.players[0].hp).toBe(40 + WEAPONS.medkit.damage);
    expect(s.players[0].ammo.medkit).toBe(0);
  });

  it('Shield absorbs the next 30 damage', () => {
    const s = revenge();
    select(s, 'shield');
    step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.players[0].shield).toBe(WEAPONS.shield.damage);
  });

  it('Air Strike drops a line of missiles on the cursor', () => {
    const s = revenge({ scheme: 'chaos' });
    select(s, 'airstrike');
    step(s, press(0, { buttons: Buttons.FIRE }));
    expect(s.projectiles.filter((p) => p.kind === 'airMissile')).toHaveLength(5);
    let explosions = 0;
    for (let i = 0; i < 200; i++)
      explosions += step(s, idle).filter((e) => e.type === 'explosion').length;
    expect(explosions).toBe(5);
    expect(s.players[1].hp).toBeLessThan(MAX_HP);
  });

  it('a Homing Missile curves toward where the target stood', () => {
    const s = revenge({ scheme: 'chaos' });
    select(s, 'homing');
    chargeAndRelease(s, 10);
    const boom = runUntil(s, 'explosion', 400);
    expect(boom?.type === 'explosion' && Math.abs(boom.x - 3)).toBeLessThan(1.2);
  });

  it('skipping ends the turn quickly', () => {
    const s = revenge();
    select(s, null);
    step(s, press(0, { buttons: Buttons.FIRE }));
    expect(runUntil(s, 'newRally', 60)).not.toBeNull();
  });
});
