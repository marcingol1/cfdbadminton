import { DT, createMatch, step } from '@deadminton/sim';
import type { MatchConfig, MatchState, PlayerId, SimEvent } from '@deadminton/sim';
import type { Controller } from './controllers';

export type SessionMode = 'vsBot' | 'local2p' | 'watch' | 'attract';

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
  speed = 1;
  paused = false;
  /** Render-only freeze after big hits (single player only; the sim is unaffected). */
  private freezeMs = 0;
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
  ) {
    this.seed = seed;
    this.state = createMatch(config, seed);
    this.prev = {
      p: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      s: { x: 0, y: 0 },
    };
    this.capturePrev();
  }

  /** Interpolation factor between the previous and current tick. */
  get alpha(): number {
    return Math.min(1, this.accumulator / STEP_MS);
  }

  hitStop(ms: number): void {
    if (this.mode === 'vsBot' || this.mode === 'local2p')
      this.freezeMs = Math.max(this.freezeMs, ms);
  }

  /** Advance by real elapsed time. Returns all sim events produced. */
  advance(elapsedMs: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.paused) return events;
    if (this.freezeMs > 0) {
      this.freezeMs -= elapsedMs;
      return events;
    }
    this.accumulator += Math.min(elapsedMs, 250) * this.speed;
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
    const events = step(s, frame);
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
