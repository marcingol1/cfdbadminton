import { describe, expect, it } from 'vitest';
import {
  Buttons,
  HALF_COURT,
  NEUTRAL_INPUT,
  SHORT_SERVICE_LINE,
  createMatch,
  isMatchWon,
  judgeLanding,
  shoulderOf,
  step,
} from '../src';
import type { InputFrame, MatchState, PlayerId } from '../src';
import { idle, rallyState, runUntil } from './helpers';

const PURIST = { scheme: 'purist' } as const;

function press(player: PlayerId, frame: Partial<InputFrame>): readonly [InputFrame, InputFrame] {
  const f = { ...NEUTRAL_INPUT, ...frame };
  return player === 0 ? [f, NEUTRAL_INPUT] : [NEUTRAL_INPUT, f];
}

function serveWith(s: MatchState, frame: Partial<InputFrame>) {
  step(s, idle);
  return step(s, press(s.server, { buttons: Buttons.HIT, ...frame }));
}

describe('R-01 point victory', () => {
  it('needs the target score and a 2-point lead', () => {
    expect(isMatchWon([11, 9], 11, 0)).toBe(true);
    expect(isMatchWon([11, 10], 11, 0)).toBe(false);
    expect(isMatchWon([12, 10], 11, 0)).toBe(true);
    expect(isMatchWon([10, 3], 11, 0)).toBe(false);
  });

  it('ends at the hard cap even without a 2-point lead', () => {
    expect(isMatchWon([15, 14], 11, 0)).toBe(true);
    expect(isMatchWon([14, 13], 11, 0)).toBe(false);
    expect(isMatchWon([30, 29], 21, 1 as PlayerId)).toBe(false);
    expect(isMatchWon([29, 30], 21, 1)).toBe(true);
  });

  it('a won match goes to matchOver after the point pause', () => {
    const s = rallyState({ x: 3, y: 0.5, vx: 0, vy: -5 }, 0);
    s.score = [10, 3];
    const over = runUntil(s, 'matchOver', 60);
    expect(over).toEqual({ type: 'matchOver', winner: 0, reason: 'points' });
    for (let i = 0; i < s.config.tuning.pointPauseTicks + 1; i++) step(s, idle);
    expect(s.phase).toBe('matchOver');
  });
});

describe('R-10 serve order', () => {
  it('the first server comes from the seed, and the rally winner serves next', () => {
    const servers = new Set(Array.from({ length: 20 }, (_, i) => createMatch(PURIST, i).server));
    expect(servers).toEqual(new Set([0, 1]));

    const s = rallyState({ x: -3, y: 0.5, vx: 0, vy: -5 }, 0);
    s.server = 0;
    runUntil(s, 'point');
    expect(s.server).toBe(1);
    runUntil(s, 'newRally', 200);
    expect(s.phase).toBe('serve');
    expect(s.shuttle.mode).toBe('held');
  });
});

describe('R-11 / R-12 / R-13 serving', () => {
  it('serves start underhand, below 1.15 m, and fly upward', () => {
    const s = createMatch(PURIST, 5);
    const events = serveWith(s, { moveY: 127 });
    const hit = events.find((e) => e.type === 'hit');
    expect(hit?.type === 'hit' && hit.y).toBeLessThan(1.15);
    expect(s.shuttle.vy).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'serve')).toBe(true);
  });

  it('the server cannot move before serving', () => {
    const s = createMatch(PURIST, 5);
    const x = s.players[s.server].x;
    for (let i = 0; i < 30; i++) step(s, press(s.server, { moveX: 127 }));
    expect(s.players[s.server].x).toBe(x);
  });

  it('a serve that lands short of the short service line is a fault', () => {
    expect(judgeLanding(1.5, 0, true)).toEqual({ winner: 1, reason: 'serveShort' });
    expect(judgeLanding(SHORT_SERVICE_LINE + 0.1, 0, true)).toEqual({ winner: 0, reason: 'in' });
    // Outside a serve, the same landing is a winner.
    expect(judgeLanding(1.5, 0, false)).toEqual({ winner: 0, reason: 'in' });
  });

  it('an unanswered short serve that lands in scores for the server', () => {
    const s = createMatch(PURIST, 11);
    const server = s.server;
    serveWith(s, {});
    const point = runUntil(s, 'point');
    expect(point?.winner).toBe(server);
    expect(Math.abs(s.lastPoint!.x)).toBeGreaterThan(SHORT_SERVICE_LINE);
  });
});

describe('R-14 serve clock', () => {
  it('auto-serves when the clock runs out', () => {
    const s = createMatch(PURIST, 3);
    const serve = runUntil(s, 'serve', s.config.tuning.serve.clockTicks + 5);
    expect(serve?.shot).toBe('serveHigh');
    expect(s.rally.serveClock).toBe(s.config.tuning.serve.clockTicks);
  });
});

describe('R-20 / R-21 / R-23 landing', () => {
  it('in on the opponent half scores for the hitter, lines are in', () => {
    expect(judgeLanding(4, 0, false)).toEqual({ winner: 0, reason: 'in' });
    expect(judgeLanding(HALF_COURT, 0, false)).toEqual({ winner: 0, reason: 'in' });
    expect(judgeLanding(-HALF_COURT, 1, false)).toEqual({ winner: 1, reason: 'in' });
  });

  it('out scores for the receiver', () => {
    expect(judgeLanding(HALF_COURT + 0.01, 0, false)).toEqual({ winner: 1, reason: 'out' });
    expect(judgeLanding(-7.5, 1, false)).toEqual({ winner: 0, reason: 'out' });
  });

  it('a shot into the net that falls back is the hitter’s fault', () => {
    const s = rallyState({ x: -1, y: 1, vx: 15, vy: 0 }, 0);
    const net = runUntil(s, 'net', 60);
    expect(net).not.toBeNull();
    const point = runUntil(s, 'point');
    expect(point).toMatchObject({ winner: 1, reason: 'ownSide' });
  });
});

describe('R-22 body hit', () => {
  it('a shuttle hitting a player costs that player the point', () => {
    const s = rallyState({ x: 1, y: 1.2, vx: 20, vy: 0 }, 0);
    s.players[1].x = 3;
    const body = runUntil(s, 'bodyHit', 60);
    expect(body?.player).toBe(1);
    expect(s.lastPoint).toMatchObject({ winner: 0, reason: 'body' });
  });
});

describe('R-24 / R-25 contact rules', () => {
  /** Put the shuttle right at player `p`'s sweet spot and swing. */
  function swingAt(s: MatchState, p: PlayerId) {
    const pl = s.players[p];
    const sh = shoulderOf(pl);
    Object.assign(s.shuttle, {
      mode: 'flight',
      x: sh.x + pl.facing * 0.6,
      y: sh.y + 0.2,
      vx: 0,
      vy: 0,
    });
    const hits = [];
    for (let i = 0; i < 8; i++) {
      const frame = press(p, { buttons: i === 0 ? Buttons.HIT : 0 });
      hits.push(...step(s, frame).filter((e) => e.type === 'hit'));
      s.shuttle.vx = 0;
      s.shuttle.vy = 0;
    }
    return hits;
  }

  it('a player can hit a shuttle on their own side', () => {
    const s = rallyState({ x: 0, y: 0, vx: 0, vy: 0 }, 1);
    s.players[0].x = -3;
    expect(swingAt(s, 0)).toHaveLength(1);
  });

  it('R-24: no second consecutive hit by the same player', () => {
    const s = rallyState({ x: 0, y: 0, vx: 0, vy: 0 }, 0);
    s.players[0].x = -3;
    expect(swingAt(s, 0)).toHaveLength(0);
  });

  it('R-25: no reaching over the net', () => {
    const s = rallyState({ x: 0, y: 0, vx: 0, vy: 0 }, 1);
    s.players[0].x = -0.3;
    const pl = s.players[0];
    Object.assign(s.shuttle, { mode: 'flight', x: 0.3, y: shoulderOf(pl).y, vx: 0, vy: 0 });
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      hits += step(s, press(0, { buttons: i === 0 ? Buttons.HIT : 0 })).filter(
        (e) => e.type === 'hit',
      ).length;
      s.shuttle.x = 0.3;
      s.shuttle.vx = 0;
      s.shuttle.vy = 0;
    }
    expect(hits).toBe(0);
  });
});

describe('R-26 ceiling', () => {
  it('touching the ceiling is a fault by the last hitter', () => {
    const s = rallyState({ x: -3, y: 9, vx: 1, vy: 30 }, 0);
    const point = runUntil(s, 'point', 60);
    expect(point).toMatchObject({ winner: 1, reason: 'ceiling' });
  });
});

describe('movement', () => {
  it('players can never cross the net', () => {
    const s = rallyState({ x: -3, y: 9, vx: 0, vy: 0 }, 1);
    s.shuttle.mode = 'grounded';
    for (let i = 0; i < 120; i++)
      step(s, [
        { ...NEUTRAL_INPUT, moveX: 127 },
        { ...NEUTRAL_INPUT, moveX: -127 },
      ]);
    expect(s.players[0].x).toBeLessThan(0);
    expect(s.players[1].x).toBeGreaterThan(0);
  });

  it('jumping leaves the ground and lands again', () => {
    const s = rallyState({ x: -3, y: 9, vx: 0, vy: 0 }, 1);
    step(s, press(0, { buttons: Buttons.JUMP }));
    expect(s.players[0].grounded).toBe(false);
    for (let i = 0; i < 60; i++) step(s, idle);
    expect(s.players[0].grounded).toBe(true);
    expect(s.players[0].y).toBe(0);
  });
});
