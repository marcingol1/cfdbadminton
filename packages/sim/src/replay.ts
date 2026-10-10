import { createMatch, step } from './rules/match';
import { hashState } from './snapshot';
import type { InputFrame, MatchConfig, MatchState } from './types';

// A replay is everything needed to re-run a match bit-for-bit: the seed, the full config
// (including tuning) and every tick's inputs for both players. The final state hash lets
// playback verify itself. Inputs are run-length encoded: [count, mx0, my0, b0, mx1, my1, b1].

/** Bumped whenever the simulation changes how inputs play out (old replays would desync). */
export const REPLAY_VERSION = 2;

export interface Replay {
  game: 'deadminton';
  version: typeof REPLAY_VERSION;
  seed: number;
  config: MatchConfig;
  /** Player names as shown in the HUD. */
  labels: [string, string];
  /** Run-length encoded input frames. */
  inputs: number[][];
  /** Number of ticks recorded. */
  ticks: number;
  /** hashState() after the last recorded tick. */
  finalHash: number;
  /** Client extras such as the players' looks. Never used by playback. */
  extras?: Record<string, unknown>;
}

type Pair = readonly [InputFrame, InputFrame];

const same = (run: number[], f: Pair) =>
  run[1] === f[0].moveX &&
  run[2] === f[0].moveY &&
  run[3] === f[0].buttons &&
  run[4] === f[1].moveX &&
  run[5] === f[1].moveY &&
  run[6] === f[1].buttons;

/** Collects inputs tick by tick while a match is played. */
export class ReplayRecorder {
  private readonly runs: number[][] = [];
  private ticks = 0;
  private readonly config: MatchConfig;

  constructor(
    config: MatchConfig,
    private readonly seed: number,
    private readonly labels: [string, string],
  ) {
    // Snapshot the config at kick-off (live tuning edits later would not be replayable).
    this.config = structuredClone(config);
  }

  push(frames: Pair): void {
    this.ticks++;
    const last = this.runs[this.runs.length - 1];
    if (last && same(last, frames)) {
      last[0]!++;
      return;
    }
    const [a, b] = frames;
    this.runs.push([1, a.moveX, a.moveY, a.buttons, b.moveX, b.moveY, b.buttons]);
  }

  finish(state: MatchState): Replay {
    return {
      game: 'deadminton',
      version: REPLAY_VERSION,
      seed: this.seed,
      config: this.config,
      labels: [this.labels[0], this.labels[1]],
      inputs: this.runs.map((r) => [...r]),
      ticks: this.ticks,
      finalHash: hashState(state),
    };
  }
}

/** Expands the run-length encoding into one input pair per tick. */
export function replayFrames(replay: Replay): Pair[] {
  const out: Pair[] = [];
  for (const [count = 0, mx0 = 0, my0 = 0, b0 = 0, mx1 = 0, my1 = 0, b1 = 0] of replay.inputs) {
    const pair: Pair = [
      { moveX: mx0, moveY: my0, buttons: b0 },
      { moveX: mx1, moveY: my1, buttons: b1 },
    ];
    for (let i = 0; i < count; i++) out.push(pair);
  }
  return out;
}

/** Re-runs a replay headless and returns the final state. */
export function playReplay(replay: Replay): MatchState {
  const state = createMatch(replay.config, replay.seed);
  for (const frames of replayFrames(replay)) step(state, frames);
  return state;
}

/** True when re-running the replay reproduces the recorded final state bit for bit. */
export function verifyReplay(replay: Replay): boolean {
  return hashState(playReplay(replay)) === replay.finalHash;
}

/** Checks that untrusted JSON (e.g. a loaded file) looks like a replay this build can play. */
export function parseReplay(json: unknown): Replay {
  const r = json as Partial<Replay> | null;
  if (!r || typeof r !== 'object' || r.game !== 'deadminton')
    throw new Error('Not a Deadminton replay file.');
  if (typeof r.version === 'number' && r.version < REPLAY_VERSION)
    throw new Error('This replay was recorded by an older version of Deadminton.');
  if (r.version !== REPLAY_VERSION)
    throw new Error(`Unsupported replay version ${String(r.version)}.`);
  if (typeof r.seed !== 'number' || typeof r.ticks !== 'number' || typeof r.finalHash !== 'number')
    throw new Error('Replay is missing its seed, length or hash.');
  if (!r.config || typeof r.config !== 'object')
    throw new Error('Replay is missing its match settings.');
  if (!Array.isArray(r.inputs) || !r.inputs.every((run) => Array.isArray(run) && run.length === 7))
    throw new Error('Replay inputs are malformed.');
  if (!Array.isArray(r.labels) || r.labels.length !== 2)
    throw new Error('Replay is missing player names.');
  return r as Replay;
}
