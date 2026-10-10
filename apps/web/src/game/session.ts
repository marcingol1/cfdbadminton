import { DT, ReplayRecorder, createMatch, hashState, step } from '@deadminton/sim';
import type { MatchConfig, MatchState, PlayerId, Replay, SimEvent } from '@deadminton/sim';
import type { Controller } from './controllers';

export type SessionMode = 'vsBot' | 'local2p' | 'watch' | 'attract' | 'replay' | 'tutorial';

export interface MatchStats {
  rallies: number;
  longestRally: number;
  smashes: [number, number];
  winners: [number, number];
  errors: [number, number];
  damageTaken: [number, number];
}

/** Positions captured before a tick, for render interpolation. */
interface RenderPrev {
  p: [{ x: number; y: number }, { x: number; y: number }];
  s: { x: number; y: number };
}

const STEP_MS = DT * 1000;
/** Never simulate more than this many ticks per frame (tab switches, slow devices). */
const MAX_STEPS_PER_FRAME = 40;

/**
 * Runs one match: fixed-timestep sim stepping, input collection from controllers, speed
 * control, pause and stats. Knows nothing about rendering.
 */
export class MatchSession {
  readonly state: MatchState;
  readonly seed: number;
  /** Every match except the title-screen one is recorded (see docs/AI_AND_SEEDS.md). */
  private readonly recorder: ReplayRecorder | null;
  private finished: Replay | null = null;
  /** In replay mode: the replay being shown, and whether it reproduced exactly. */
  readonly source: Replay | null;
  verified: boolean | null = null;
  /** Live tuning edits during a match make its replay unverifiable. */
  tuningEdited = false;
  speed = 1;
  paused = false;
  /** Render-only freeze after big hits (single player only; the sim is unaffected). */
  private freezeMs = 0;
  /** Render-only slow motion (KOs): sim ticks run slower in real time, results unchanged. */
  private slowMs = 0;
  private slowScale = 1;
  private accumulator = 0;
  private rallyHits = 0;
  readonly prev: RenderPrev;
  readonly stats: MatchStats = {
    rallies: 0,
    longestRally: 0,
    smashes: [0, 0],
    winners: [0, 0],
    errors: [0, 0],
    damageTaken: [0, 0],
  };

  constructor(
    readonly mode: SessionMode,
    readonly controllers: [Controller, Controller],
    config: Partial<MatchConfig>,
    seed: number,
    source: Replay | null = null,
  ) {
    this.seed = seed;
    this.source = source;
    this.state = createMatch(config, seed);
    this.recorder =
      mode === 'attract' || mode === 'replay' || mode === 'tutorial'
        ? null
        : new ReplayRecorder(this.state.config, seed, [controllers[0].label, controllers[1].label]);
    this.prev = {
      p: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      s: { x: 0, y: 0 },
    };
    this.capturePrev();
  }

  /** The recorded replay, once the match is over. */
  get replay(): Replay | null {
    return this.finished;
  }

  /** Interpolation factor between the previous and current tick. */
  get alpha(): number {
    return Math.min(1, this.accumulator / STEP_MS);
  }

  hitStop(ms: number): void {
    if (this.mode === 'vsBot' || this.mode === 'local2p' || this.mode === 'tutorial')
      this.freezeMs = Math.max(this.freezeMs, ms);
  }

  slowMo(ms: number, scale: number): void {
    if (this.speed > 2) return;
    this.slowMs = Math.max(this.slowMs, ms);
    this.slowScale = scale;
  }

  /** How fast visual effects should run right now (0 while frozen or paused). */
  get timeScale(): number {
    if (this.paused || this.freezeMs > 0) return 0;
    return this.slowMs > 0 ? this.slowScale : 1;
  }

  /** Advance by real elapsed time. Returns all sim events produced. */
  advance(elapsedMs: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.paused) return events;
    if (this.freezeMs > 0) {
      this.freezeMs -= elapsedMs;
      return events;
    }
    let scale = this.speed;
    if (this.slowMs > 0) {
      this.slowMs -= elapsedMs;
      scale *= this.slowScale;
    }
    this.accumulator += Math.min(elapsedMs, 250) * scale;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      events.push(...this.tick());
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    return events;
  }

  /** Exactly one tick (used by watch-mode single stepping). */
  tick(): SimEvent[] {
    this.capturePrev();
    const s = this.state;
    const frame = [this.controllers[0].sample(s), this.controllers[1].sample(s)] as const;
    if (this.recorder && !this.finished) this.recorder.push(frame);
    const events = step(s, frame);
    if (s.phase === 'matchOver' && this.recorder && !this.finished)
      this.finished = this.recorder.finish(s);
    if (this.source && this.verified === null && s.tick === this.source.ticks) {
      this.verified = hashState(s) === this.source.finalHash;
    }
    this.record(events);
    return events;
  }

  private capturePrev(): void {
    const s = this.state;
    for (const i of [0, 1] as const) {
      this.prev.p[i].x = s.players[i].x;
      this.prev.p[i].y = s.players[i].y;
    }
    this.prev.s.x = s.shuttle.x;
    this.prev.s.y = s.shuttle.y;
  }

  private record(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'hit') {
        this.rallyHits++;
        if (e.shot === 'smash') this.stats.smashes[e.player]++;
      } else if (e.type === 'damage') {
        this.stats.damageTaken[e.player] += e.amount;
      } else if (e.type === 'point') {
        this.stats.rallies++;
        this.stats.longestRally = Math.max(this.stats.longestRally, this.rallyHits);
        this.rallyHits = 0;
        const loser = (1 - e.winner) as PlayerId;
        if (e.reason === 'in' || e.reason === 'body') this.stats.winners[e.winner]++;
        else this.stats.errors[loser]++;
      }
    }
  }
}
