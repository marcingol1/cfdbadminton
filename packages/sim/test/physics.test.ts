import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNING,
  HALF_COURT,
  NET_HEIGHT,
  advanceFlight,
  dragCoefficient,
  solveShot,
  summarizeFlight,
} from '../src';
import type { FlightEnv, ShotType } from '../src';

const env: FlightEnv = { gravity: 9.81, k: dragCoefficient(DEFAULT_TUNING), wind: 0, ceiling: 10 };

function landing(type: ShotType, x: number, y: number) {
  const spec = DEFAULT_TUNING.shots[type];
  const l = solveShot(
    spec,
    x,
    y,
    1,
    spec.depth,
    env,
    spec.netMargin ?? DEFAULT_TUNING.shuttle.netMargin,
  );
  return { ...summarizeFlight({ x, y, vx: l.vx, vy: l.vy }, env), ...l };
}

describe('shuttle flight', () => {
  it('approaches terminal velocity when falling', () => {
    const b = { x: -3, y: 9, vx: 0, vy: 0 };
    for (let i = 0; i < 240 * 2; i++) advanceFlight(b, { ...env, ceiling: null });
    expect(Math.abs(b.vy)).toBeCloseTo(DEFAULT_TUNING.shuttle.terminalVelocity, 1);
  });

  it('a clear from the back lands deep in the opponent court and stays under the ceiling', () => {
    const f = landing('clear', -5.5, 2.3);
    expect(f.landX).toBeGreaterThan(0.75 * HALF_COURT);
    expect(f.landX).toBeLessThan(HALF_COURT);
    expect(f.apex).toBeLessThan(10);
  });

  it('a drop from the back lands short, and a net shot tumbles just over', () => {
    expect(landing('drop', -5.5, 2.4).landX).toBeLessThan(2.5);
    const net = landing('netShot', -0.8, 0.6);
    expect(net.landX).toBeGreaterThan(0);
    expect(net.landX).toBeLessThan(1.2);
    expect(net.netCrossY!).toBeGreaterThan(NET_HEIGHT);
  });

  it('a smash is fast, downward and clears the net', () => {
    const f = landing('smash', -3, 2.8);
    expect(f.vy).toBeLessThan(0);
    expect(Math.hypot(f.vx, f.vy)).toBeGreaterThan(40);
    expect(f.clearsNet).toBe(true);
  });

  it('a 90 m/s shot straight into the net never tunnels through it', () => {
    const b = { x: -0.5, y: 1.0, vx: 90, vy: 0 };
    let hitNet = false;
    for (let i = 0; i < 40 && !hitNet; i++) hitNet = advanceFlight(b, env)?.kind === 'net';
    expect(hitNet).toBe(true);
    expect(b.x).toBeLessThan(0);
  });

  it('wind pushes the shuttle downwind', () => {
    const still = summarizeFlight({ x: -5, y: 2.5, vx: 20, vy: 20 }, env).landX;
    const tail = summarizeFlight({ x: -5, y: 2.5, vx: 20, vy: 20 }, { ...env, wind: 2 }).landX;
    expect(tail).toBeGreaterThan(still + 0.5);
  });
});
