import { describe, expect, it } from 'vitest';
import {
  ReplayRecorder,
  createMatch,
  hashState,
  parseReplay,
  playReplay,
  replayFrames,
  step,
  verifyReplay,
} from '@deadminton/sim';
import type { MatchConfig, Replay } from '@deadminton/sim';
import { Bot } from '../src';

/** Records a bot-vs-bot match the way the web client does. */
function record(config: Partial<MatchConfig>, seed: number): { replay: Replay; hash: number } {
  const state = createMatch(config, seed);
  const bots = [new Bot(0, 'medium', seed, 'berserker'), new Bot(1, 'hard', seed + 1)] as const;
  const recorder = new ReplayRecorder(state.config, seed, ['A', 'B']);
  while (state.phase !== 'matchOver') {
    const frames = [bots[0].think(state), bots[1].think(state)] as const;
    recorder.push(frames);
    step(state, frames);
  }
  return { replay: recorder.finish(state), hash: hashState(state) };
}

describe('replays', () => {
  it('re-running a recorded match reproduces it bit for bit (weapons, Revenge, crates)', () => {
    const { replay, hash } = record(
      { pointsToWin: 7, scheme: 'chaos', revengeTurns: true, arena: 'rooftop' },
      4242,
    );
    expect(replay.finalHash).toBe(hash);
    expect(hashState(playReplay(replay))).toBe(hash);
    expect(verifyReplay(replay)).toBe(true);
    expect(replayFrames(replay)).toHaveLength(replay.ticks);
  });

  it('survives a JSON round trip and stays compact', () => {
    const { replay } = record({ pointsToWin: 7 }, 99);
    const text = JSON.stringify(replay);
    const back = parseReplay(JSON.parse(text));
    expect(verifyReplay(back)).toBe(true);
    // Run-length encoding: far fewer runs than ticks.
    expect(back.inputs.length).toBeLessThan(back.ticks);
  });

  it('detects a tampered replay', () => {
    const { replay } = record({ pointsToWin: 7 }, 5);
    const tampered: Replay = structuredClone(replay);
    // Push player 1's stick hard left for the first third of the match.
    for (const run of tampered.inputs.slice(0, Math.floor(tampered.inputs.length / 3)))
      run[1] = -127;
    expect(verifyReplay(tampered)).toBe(false);
  });

  it('rejects files that are not replays', () => {
    expect(() => parseReplay({ hello: 'world' })).toThrow(/Not a Deadminton replay/);
    expect(() => parseReplay({ game: 'deadminton', version: 99 })).toThrow(/version/);
  });
});
