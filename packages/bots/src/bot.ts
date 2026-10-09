import {
  Buttons,
  DT,
  HALF_COURT,
  NET_CLEARANCE,
  PLAYER_HALF_WIDTH,
  SHOULDER_FORWARD,
  SHOULDER_HEIGHT,
  WALL_X,
  clamp,
  halfOwner,
  nextFloat,
  nextInt,
  nextRange,
  other,
  predictShuttle,
  quantizeAxis,
  seedRng,
  sideSign,
} from '@deadminton/sim';
import type {
  InputFrame,
  MatchState,
  PlayerId,
  RngState,
  ShotIntent,
  TrajectoryPoint,
} from '@deadminton/sim';
import { DIFFICULTIES } from './profiles';
import type { BotProfile, Difficulty } from './profiles';

/** Highest contact point reachable standing / jumping (shoulder 1.45 m + reach). */
const STANDING_MAX_Y = 2.3;
const JUMPING_MAX_Y = 3.0;
const MIN_CONTACT_Y = 0.3;
const HOME_X = 3.3;

interface Plan {
  /** Rally hit count this plan answers; a new hit invalidates it. */
  hits: number;
  standX: number;
  contactTick: number;
  swingTick: number;
  jumpTick: number;
  intent: ShotIntent;
  swung: boolean;
  /** The bot judged the shuttle to be going out and lets it drop. */
  leave: boolean;
}

/**
 * A bot is just another input source: it reads the (public) match state and returns the
 * InputFrame a human would have produced. It never touches the sim directly.
 */
export class Bot {
  readonly id: PlayerId;
  readonly profile: BotProfile;
  private readonly rng: RngState;
  private plan: Plan | null = null;
  private serveAt = -1;
  private serveIntent: ShotIntent = 'neutral';
  /** Exposed for the Watch-mode intent overlay. */
  lastPlan: Readonly<Plan> | null = null;

  constructor(id: PlayerId, profile: BotProfile | Difficulty, seed: number) {
    this.id = id;
    this.profile = typeof profile === 'string' ? DIFFICULTIES[profile] : profile;
    this.rng = seedRng(seed ^ (id === 0 ? 0x5bd1e995 : 0x1b873593));
  }

  think(state: MatchState): InputFrame {
    const me = state.players[this.id];
    const side = sideSign(this.id);
    const input: InputFrame = { moveX: 0, moveY: 0, buttons: 0 };

    if (state.phase === 'serve') {
      this.plan = null;
      if (state.server === this.id) {
        if (this.serveAt < 0) {
          this.serveAt = state.tick + nextInt(this.rng, 20, 60);
          this.serveIntent = this.pickServe();
        }
        if (state.tick >= this.serveAt) {
          this.serveAt = -1;
          this.applyIntent(input, this.serveIntent, me.facing);
          input.buttons |= Buttons.HIT;
        }
      } else {
        this.serveAt = -1;
        this.moveTo(input, me.x, side * state.config.tuning.serve.receiverX);
      }
      return input;
    }

    if (state.phase !== 'rally') {
      this.plan = null;
      this.moveTo(input, me.x, side * HOME_X);
      return input;
    }

    const incoming = state.shuttle.mode === 'flight' && state.rally.lastHitter !== this.id;
    if (!incoming) {
      this.plan = null;
      this.moveTo(input, me.x, side * HOME_X);
      return input;
    }

    if (
      (this.plan === null || this.plan.hits !== state.rally.hits) &&
      state.rally.ticksSinceHit >= this.profile.reactionTicks
    ) {
      this.plan = this.makePlan(state);
      this.lastPlan = this.plan;
    }
    const plan = this.plan;
    if (!plan) return input;

    this.moveTo(input, me.x, plan.standX);
    if (plan.leave) return input;
    // Inputs sampled now are applied on the next tick.
    if (state.tick + 1 === plan.jumpTick) input.buttons |= Buttons.JUMP;
    if (!plan.swung && state.tick + 1 >= plan.swingTick) {
      plan.swung = true;
      this.applyIntent(input, plan.intent, me.facing);
      input.buttons |= Buttons.HIT;
    }
    return input;
  }

  private moveTo(input: InputFrame, x: number, targetX: number): void {
    const dx = targetX - x;
    input.moveX =
      Math.abs(dx) < 0.05 ? 0 : quantizeAxis(clamp(dx * 4, -1, 1) * this.profile.footwork);
  }

  /** Sets the stick so intentFromInput() reads back exactly `intent` on the swing tick. */
  private applyIntent(input: InputFrame, intent: ShotIntent, facing: 1 | -1): void {
    input.moveY = intent === 'up' ? 127 : intent === 'down' ? -127 : 0;
    if (intent === 'forward') input.moveX = facing * 127;
    else if (intent === 'neutral') input.moveX = 0;
  }

  private pickServe(): ShotIntent {
    const r = nextFloat(this.rng);
    return r < 0.5 ? 'neutral' : r < 0.85 ? 'up' : 'forward';
  }

  private makePlan(state: MatchState): Plan | null {
    const me = state.players[this.id];
    const tuning = state.config.tuning;
    const speed = tuning.player.runSpeed * this.profile.footwork;
    const traj = predictShuttle(state, 300);
    const sw = tuning.swing;

    // Leave shuttles that will land out (judged with the bot's own prediction error).
    if (traj.end?.kind === 'floor' || traj.end?.kind === 'wall') {
      const judgedX =
        Math.abs(traj.end.x) + nextRange(this.rng, -1, 1) * this.profile.predictionError;
      if (
        halfOwner(traj.end.x) === this.id &&
        judgedX > HALF_COURT + 0.1 &&
        nextFloat(this.rng) < this.profile.shotIQ
      ) {
        return this.leavePlan(state, traj.end.x);
      }
    }

    let best: { p: TrajectoryPoint; standX: number; jump: boolean; score: number } | null = null;
    let fallback: { p: TrajectoryPoint; standX: number; jump: boolean; deficit: number } | null =
      null;
    for (const p of traj.points) {
      if (halfOwner(p.x) !== this.id || p.y < MIN_CONTACT_Y || p.y > JUMPING_MAX_Y) continue;
      // Too soon to wind up a swing.
      if (p.t < sw.activeStart + 1) continue;
      const jump = p.y > STANDING_MAX_Y;
      const standX = this.standPosition(p, jump, me.facing, tuning.player.sweetSpot);
      // A few ticks of slack for acceleration and the swing wind-up.
      const needed = Math.abs(standX - me.x) / speed + 6 * DT;
      const available = p.t * DT;
      if (needed <= available) {
        // Prefer high contacts (attacking options), slightly penalize jumping.
        const score = Math.min(p.y, 2.8) - (jump ? 0.2 : 0);
        if (!best || score > best.score) best = { p, standX, jump, score };
      } else {
        const deficit = needed - available;
        if (!fallback || deficit < fallback.deficit) fallback = { p, standX, jump, deficit };
      }
    }
    const pick = best ?? fallback;
    if (!pick) return null;

    const contactTick = state.tick + pick.p.t;
    const timingNoise = Math.round(nextRange(this.rng, -1, 1) * this.profile.timingNoise);
    const errorX = nextRange(this.rng, -1, 1) * this.profile.predictionError;
    const lo = this.id === 0 ? -WALL_X + PLAYER_HALF_WIDTH : NET_CLEARANCE;
    const hi = this.id === 0 ? -NET_CLEARANCE : WALL_X - PLAYER_HALF_WIDTH;
    return {
      hits: state.rally.hits,
      standX: clamp(pick.standX + errorX, lo, hi),
      contactTick,
      swingTick: contactTick - tuning.swing.idealTick + timingNoise,
      jumpTick: pick.jump ? contactTick - this.jumpLeadTicks(pick.p.y, state) : -1,
      intent: this.pickIntent(state, pick.p),
      swung: false,
      leave: false,
    };
  }

  /** Step away from the landing spot so the shuttle doesn't hit the body (R-22). */
  private leavePlan(state: MatchState, landX: number): Plan {
    const me = state.players[this.id];
    const away = me.x < landX ? -1 : 1;
    return {
      hits: state.rally.hits,
      standX: me.x + away * 0.8,
      contactTick: -1,
      swingTick: -1,
      jumpTick: -1,
      intent: 'neutral',
      swung: true,
      leave: true,
    };
  }

  /** Where to stand so the shuttle meets the racket's sweet spot in front of the body. */
  private standPosition(
    p: TrajectoryPoint,
    jump: boolean,
    facing: 1 | -1,
    sweetSpot: number,
  ): number {
    const shoulderY = SHOULDER_HEIGHT + (jump ? 0.6 : 0);
    const dy = p.y - shoulderY;
    const dx = Math.max(0.15, Math.sqrt(Math.max(0, sweetSpot * sweetSpot - dy * dy)));
    return p.x - facing * (SHOULDER_FORWARD + dx);
  }

  /** Ticks before contact to press jump so the body is rising through the needed height. */
  private jumpLeadTicks(contactY: number, state: MatchState): number {
    const { jumpVelocity: v, gravity: g } = state.config.tuning.player;
    const h = clamp(contactY - STANDING_MAX_Y + 0.15, 0, (v * v) / (2 * g) - 0.01);
    const t = (v - Math.sqrt(v * v - 2 * g * h)) / g;
    return Math.max(1, Math.round(t / DT));
  }

  private pickIntent(state: MatchState, p: TrajectoryPoint): ShotIntent {
    const r = this.rng;
    if (nextFloat(r) > this.profile.shotIQ) {
      const all: ShotIntent[] = ['up', 'down', 'forward', 'neutral'];
      return all[nextInt(r, 0, 3)]!;
    }
    const opp = state.players[other(this.id)];
    const oppDepth = Math.abs(opp.x);
    if (p.y >= 2.3 && Math.abs(p.x) < 5.2 && nextFloat(r) < this.profile.aggression)
      return 'forward';
    if (oppDepth > 4.6) return 'down';
    if (oppDepth < 3.0) return 'up';
    if (p.y < 1.2) return Math.abs(p.x) < 2 && nextFloat(r) < 0.5 ? 'down' : 'up';
    const options: ShotIntent[] = ['up', 'down', 'forward'];
    return options[nextInt(r, 0, 2)]!;
  }
}
