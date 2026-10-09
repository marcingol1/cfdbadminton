import { describe, expect, it } from 'vitest';
import { Bot } from '../src';
import { createMatch, hashState, restore, snapshot, step } from '@deadminton/sim';
import type { MatchState } from '@deadminton/sim';

function play(state: MatchState, bots: [Bot, Bot], ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, [bots[0].think(state), bots[1].think(state)]);
}

const bots = (seed: number): [Bot, Bot] => [
  new Bot(0, 'medium', seed),
  new Bot(1, 'medium', seed + 1),
];

describe('determinism', () => {
  it('same seed and inputs produce a bit-identical state', () => {
    const a = createMatch({}, 1234);
    const b = createMatch({}, 1234);
    play(a, bots(9), 5000);
    play(b, bots(9), 5000);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.score[0] + a.score[1]).toBeGreaterThan(0);
  });

  it('different seeds diverge', () => {
    const a = createMatch({}, 1);
    const b = createMatch({}, 2);
    play(a, bots(9), 2000);
    play(b, bots(9), 2000);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('snapshot → restore → continue equals an uninterrupted run', () => {
    // Bots carry their own memory, so record the inputs once and replay them.
    const recorded = createMatch({}, 77);
    const bs = bots(3);
    const inputs = [];
    for (let i = 0; i < 4000; i++) {
      const frame = [bs[0].think(recorded), bs[1].think(recorded)] as const;
      inputs.push(frame);
      step(recorded, frame);
    }
    const replay = createMatch({}, 77);
    for (let i = 0; i < 1500; i++) step(replay, inputs[i]!);
    const resumed = restore(snapshot(replay));
    for (let i = 1500; i < 4000; i++) step(resumed, inputs[i]!);
    expect(hashState(resumed)).toBe(hashState(recorded));
  });
});
