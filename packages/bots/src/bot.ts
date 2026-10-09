import {
  ARENAS,
  Buttons,
  DT,
  HALF_COURT,
  MAX_AIM,
  MIN_AIM,
  NET_CLEARANCE,
  PLAYER_HALF_WIDTH,
  SHOULDER_FORWARD,
  SHOULDER_HEIGHT,
  WALL_X,
  WEAPONS,
  WEAPON_TUNING,
  activeMines,
  blastDamage,
  clamp,
  groundAt,
  halfOwner,
  isAvailable,
  nextFloat,
  nextInt,
  nextRange,
  other,
  predictShuttle,
  quantizeAxis,
  rallyOptions,
  revengeLaunch,
  revengeOptions,
  seedRng,
  sideSign,
  simulateProjectile,
} from '@deadminton/sim';
import type {
  InputFrame,
  MatchState,
  PlayerId,
  PlayerState,
  ProjectileKind,
  RngState,
  ShotIntent,
  TrajectoryPoint,
  WeaponId,
} from '@deadminton/sim';
import { DIFFICULTIES, PERSONALITIES } from './profiles';
import type { BotProfile, Difficulty, Personality, PersonalityTraits } from './profiles';

/** Highest contact point reachable standing / jumping (shoulder 1.45 m + reach). */
const STANDING_MAX_Y = 2.3;
const JUMPING_MAX_Y = 3.0;
const MIN_CONTACT_Y = 0.3;
const HOME_X = 3.3;
/** Keep this far from armed mines when choosing where to stand. */
const MINE_CLEARANCE = 0.9;
/** On arenas with pits, don't dodge to within this distance of the edge. */
const PIT_EDGE_ROOM = 2;
const LOADED_SHOTS = ['frag', 'lead', 'shock', 'cluster', 'ghost'] as const;

interface Plan {
  /** Rally hit count this plan answers; a new hit invalidates it. */
  hits: number;
  standX: number;
  contactTick: number;
  swingTick: number;
  jumpTick: number;
  intent: ShotIntent;
  swung: boolean;
  /** The bot lets this shuttle drop (going out, a Frag about to blow, a Shock it fears). */
  leave: boolean;
}

interface RevengePlan {
  weapon: WeaponId | null;
  angle: number;
  power: number;
  cursor: number;
  /** Tick before which the bot "thinks" and doesn't act. */
  readyAt: number;
}

/**
 * A bot is just another input source: it reads the (public) match state and returns the
 * InputFrame a human would have produced. It never touches the sim directly.
 * See docs/AI_AND_SEEDS.md.
 */
export class Bot {
  readonly id: PlayerId;
  readonly profile: BotProfile;
  readonly personality: Personality;
  readonly traits: PersonalityTraits;
  private readonly rng: RngState;
  private plan: Plan | null = null;
  private serveAt = -1;
  private serveIntent: ShotIntent = 'neutral';
  /** Loaded shot or throwable the bot wants selected, and the Frag fuse it wants. */
  private wantWeapon: WeaponId | null = null;
  private wantFuse: number = WEAPON_TUNING.frag.defaultFuse;
  /** Rally hit count for which the mine decision was already made. */
  private mineDecidedFor = -1;
  private revengePlan: RevengePlan | null = null;
  private dodgeSeen = new Set<number>();
  private dodgeIgnored = new Set<number>();
  /** Exposed for the Watch-mode intent overlay. */
  lastPlan: Readonly<Plan> | null = null;
  lastRevenge: Readonly<RevengePlan> | null = null;

  constructor(
    id: PlayerId,
    profile: BotProfile | Difficulty,
    seed: number,
    personality: Personality = 'balanced',
  ) {
    this.id = id;
    this.profile = typeof profile === 'string' ? DIFFICULTIES[profile] : profile;
    this.personality = personality;
    this.traits = PERSONALITIES[personality];
    this.rng = seedRng(seed ^ (id === 0 ? 0x5bd1e995 : 0x1b873593));
  }

  think(state: MatchState): InputFrame {
    const me = state.players[this.id];
    const input: InputFrame = { moveX: 0, moveY: 0, buttons: 0 };
    if (me.dead) return input;

    if (state.phase === 'revenge') return this.thinkRevenge(state, input);
    this.revengePlan = null;

    if (state.phase === 'serve') {
      this.plan = null;
      this.wantWeapon = null;
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
        this.moveTo(state, input, me.x, sideSign(this.id) * state.config.tuning.serve.receiverX);
      }
      return input;
    }

    if (state.phase !== 'rally') {
      this.plan = null;
      this.moveTo(state, input, me.x, this.idleSpot(state));
      return input;
    }

    const incoming = state.shuttle.mode === 'flight' && state.rally.lastHitter !== this.id;
    if (!incoming) {
      this.plan = null;
      this.moveTo(state, input, me.x, this.idleSpot(state));
      this.maybeThrowMine(state, me, input);
      this.steerSelection(state, me, input);
      return input;
    }

    if (
      (this.plan === null || this.plan.hits !== state.rally.hits) &&
      state.rally.ticksSinceHit >= this.profile.reactionTicks &&
      // A Ghost Shuttle can't be read until it reappears.
      state.shuttle.ghostTicks <= 0
    ) {
      this.plan = this.makePlan(state);
      this.lastPlan = this.plan;
    }
    const plan = this.plan;
    if (!plan) return input;

    this.moveTo(state, input, me.x, plan.standX);
    if (plan.leave) return input;
    this.steerSelection(state, me, input);
    // Inputs sampled now are applied on the next tick.
    if (state.tick + 1 === plan.jumpTick) input.buttons |= Buttons.JUMP;
    if (!plan.swung && state.tick + 1 >= plan.swingTick) {
      plan.swung = true;
      this.applyIntent(input, plan.intent, me.facing);
      input.buttons |= Buttons.HIT;
    }
    return input;
  }

  // ---------------------------------------------------------------- movement

  private moveTo(state: MatchState, input: InputFrame, x: number, targetX: number): void {
    const t = this.avoidMines(state, targetX);
    const dx = t - x;
    input.moveX =
      Math.abs(dx) < 0.05 ? 0 : quantizeAxis(clamp(dx * 4, -1, 1) * this.profile.footwork);
  }

  /** Never plan to stand on (or right next to) a mine. */
  private avoidMines(state: MatchState, x: number): number {
    for (const m of state.mines) {
      if (halfOwner(m.x) !== this.id || Math.abs(m.x - x) >= MINE_CLEARANCE) continue;
      const towardCenter = m.x < x ? 1 : -1;
      const shifted = m.x + towardCenter * MINE_CLEARANCE;
      return this.clampToHalf(shifted);
    }
    return x;
  }

  private clampToHalf(x: number): number {
    const lo = this.id === 0 ? -WALL_X + PLAYER_HALF_WIDTH + 0.3 : NET_CLEARANCE;
    const hi = this.id === 0 ? -NET_CLEARANCE : WALL_X - PLAYER_HALF_WIDTH - 0.3;
    return clamp(x, lo, hi);
  }

  /** Home position, or a supply crate on my side worth walking to. */
  private idleSpot(state: MatchState): number {
    const crate = state.crates.find((c) => c.landed && halfOwner(c.x) === this.id);
    return crate ? crate.x : sideSign(this.id) * HOME_X;
  }

  // ---------------------------------------------------------------- weapons in a rally

  /** Cycle NEXT / FUSE on alternate ticks until the wanted weapon and fuse are selected. */
  private steerSelection(state: MatchState, me: PlayerState, input: InputFrame): void {
    if (!rallyOptions(state, me).includes(this.wantWeapon)) this.wantWeapon = null;
    if (state.tick % 2 !== 0) return;
    if (me.rallyWeapon !== this.wantWeapon) input.buttons |= Buttons.WEAPON_NEXT;
    else if (this.wantWeapon === 'frag' && me.fuse !== this.wantFuse) input.buttons |= Buttons.FUSE;
  }

  /** Chance to load a weapon now: difficulty × personality × (for Balanced) the situation. */
  private weaponChance(state: MatchState): number {
    let chance = this.profile.weaponUse * this.traits.weaponUse;
    if (this.traits.situational) {
      const opp = state.players[other(this.id)];
      const lead = state.score[this.id] - state.score[other(this.id)];
      if (opp.hp <= 40) chance *= 1.8; // Smell blood: go for the KO.
      if (lead >= 4) chance *= 0.5; // Comfortably ahead: just play badminton.
      if (lead <= -4) chance *= 1.5; // Far behind on points: the KO is the way back.
    }
    return Math.min(0.9, chance);
  }

  private chooseLoadedShot(state: MatchState, me: PlayerState): void {
    this.wantWeapon = null;
    if (nextFloat(this.rng) >= this.weaponChance(state)) return;
    const weights = this.traits.loadedWeights;
    const options = LOADED_SHOTS.filter((id) => weights[id] > 0 && isAvailable(state, me, id));
    const total = options.reduce((sum, id) => sum + weights[id], 0);
    if (total === 0) return;
    let r = nextFloat(this.rng) * total;
    for (const id of options) {
      r -= weights[id];
      if (r < 0) {
        this.wantWeapon = id;
        break;
      }
    }
    // Long enough to cross the net, short enough to blow up near the opponent.
    this.wantFuse = nextInt(this.rng, 2, 4);
  }

  private maybeThrowMine(state: MatchState, me: PlayerState, input: InputFrame): void {
    if (this.mineDecidedFor !== state.rally.hits) {
      this.mineDecidedFor = state.rally.hits;
      const canThrow =
        isAvailable(state, me, 'mine') &&
        activeMines(state, this.id) < WEAPON_TUNING.mine.maxActive;
      const chance = Math.min(0.6, this.profile.weaponUse * 0.5 * this.traits.mineUse);
      if (canThrow && nextFloat(this.rng) < chance) this.wantWeapon = 'mine';
      else if (this.wantWeapon === 'mine') this.wantWeapon = null;
    }
    if (
      this.wantWeapon === 'mine' &&
      me.rallyWeapon === 'mine' &&
      state.tick % 2 === 1 &&
      me.swingTick < 0
    ) {
      input.buttons |= Buttons.FIRE;
      this.wantWeapon = null;
    }
  }

  // ---------------------------------------------------------------- rally planning

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
    const s = state.shuttle;

    // Leave shuttles that will land out (judged with the bot's own prediction error).
    if (traj.end?.kind === 'floor' || traj.end?.kind === 'wall') {
      const judgedX =
        Math.abs(traj.end.x) + nextRange(this.rng, -1, 1) * this.profile.predictionError;
      if (
        halfOwner(traj.end.x) === this.id &&
        judgedX > HALF_COURT + 0.1 &&
        nextFloat(this.rng) < this.profile.shotIQ
      ) {
        return this.leavePlan(state, traj.end.x, 0.8);
      }
    }

    // A Shock Shuttle costs HP to return: give up the point when HP is low or the lead is safe.
    if (s.weapon === 'shock') {
      const lead = state.score[this.id] - state.score[other(this.id)];
      const hurts = me.hp <= WEAPONS.shock.damage + 10 || lead >= 3;
      const scared = hurts && nextFloat(this.rng) < this.traits.shockFear * this.profile.shotIQ;
      const end = traj.end && traj.end.kind !== 'net' ? traj.end.x : me.x;
      if (scared) return this.leavePlan(state, end, 0.8);
    }

    let best: {
      p: TrajectoryPoint;
      h: number;
      standX: number;
      jump: boolean;
      score: number;
    } | null = null;
    let fallback: {
      p: TrajectoryPoint;
      h: number;
      standX: number;
      jump: boolean;
      deficit: number;
    } | null = null;
    for (const p of traj.points) {
      if (halfOwner(p.x) !== this.id) continue;
      // Heights are measured from the floor under the bot (it may stand in a crater).
      const floor = groundAt(state, p.x - me.facing * 0.7);
      const h = p.y - floor;
      if (h < MIN_CONTACT_Y || h > JUMPING_MAX_Y) continue;
      // Too soon to wind up a swing.
      if (p.t < sw.activeStart + 1) continue;
      const jump = h > STANDING_MAX_Y;
      const standX = this.standPosition(p, floor, jump, me.facing, tuning.player.sweetSpot);
      // A few ticks of slack for acceleration and the swing wind-up.
      const needed = Math.abs(standX - me.x) / speed + 6 * DT;
      const available = p.t * DT;
      if (needed <= available) {
        // Prefer high contacts (attacking options), slightly penalize jumping.
        const score = Math.min(h, 2.8) - (jump ? 0.2 : 0);
        if (!best || score > best.score) best = { p, h, standX, jump, score };
      } else {
        const deficit = needed - available;
        if (!fallback || deficit < fallback.deficit) fallback = { p, h, standX, jump, deficit };
      }
    }
    const pick = best ?? fallback;
    if (!pick) return null;

    // Hot potato: a Frag that would blow up before (or right after) contact is dropped and fled.
    if (s.weapon === 'frag' && s.fuseTicks < pick.p.t + this.traits.fragMargin) {
      const blastPoint =
        traj.points[Math.min(traj.points.length - 1, Math.max(0, s.fuseTicks - 1))];
      return this.leavePlan(state, blastPoint?.x ?? pick.p.x, WEAPONS.frag.radius + 1);
    }

    if (s.weapon === null) this.chooseLoadedShot(state, me);
    else this.wantWeapon = null;

    const contactTick = state.tick + pick.p.t;
    const timingNoise = Math.round(nextRange(this.rng, -1, 1) * this.profile.timingNoise);
    const errorX = nextRange(this.rng, -1, 1) * this.profile.predictionError;
    return {
      hits: state.rally.hits,
      standX: this.clampToHalf(pick.standX + errorX),
      contactTick,
      swingTick: contactTick - tuning.swing.idealTick + timingNoise,
      jumpTick: pick.jump ? contactTick - this.jumpLeadTicks(pick.h, state) : -1,
      intent: this.pickIntent(state, pick.p),
      swung: false,
      leave: false,
    };
  }

  /** Step `distance` m away from `dangerX` so the shuttle (or its blast) misses the body. */
  private leavePlan(state: MatchState, dangerX: number, distance: number): Plan {
    const me = state.players[this.id];
    let away: number = me.x < dangerX ? -1 : 1;
    // Don't run into the net or off the court: flee the other way if there's no room.
    // Next to a pit, keep extra room: a blast can still knock you a couple of meters.
    const edgeRoom = ARENAS[state.config.arena].pits ? PIT_EDGE_ROOM : 0;
    const target = dangerX + away * distance;
    if (this.clampToHalf(target) !== target || Math.abs(target) > WALL_X - edgeRoom) away = -away;
    return {
      hits: state.rally.hits,
      standX: this.clampToHalf(dangerX + away * distance),
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
    floor: number,
    jump: boolean,
    facing: 1 | -1,
    sweetSpot: number,
  ): number {
    const shoulderY = floor + SHOULDER_HEIGHT + (jump ? 0.6 : 0);
    const dy = p.y - shoulderY;
    const dx = Math.max(0.15, Math.sqrt(Math.max(0, sweetSpot * sweetSpot - dy * dy)));
    return p.x - facing * (SHOULDER_FORWARD + dx);
  }

  /** Ticks before contact to press jump so the body is rising through the needed height. */
  private jumpLeadTicks(contactHeight: number, state: MatchState): number {
    const { jumpVelocity: v, gravity: g } = state.config.tuning.player;
    const h = clamp(contactHeight - STANDING_MAX_Y + 0.15, 0, (v * v) / (2 * g) - 0.01);
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
    const h = p.y - groundAt(state, p.x - state.players[this.id].facing * 0.7);
    const aggression = Math.min(0.97, this.profile.aggression * this.traits.aggression);
    if (h >= 2.3 && Math.abs(p.x) < 5.2 && nextFloat(r) < aggression) return 'forward';
    if (oppDepth > 4.6) return 'down';
    if (oppDepth < 3.0) return 'up';
    if (h < 1.2) return Math.abs(p.x) < 2 && nextFloat(r) < 0.5 ? 'down' : 'up';
    const options: ShotIntent[] = ['up', 'down', 'forward'];
    return options[nextInt(r, 0, 2)]!;
  }

  // ---------------------------------------------------------------- Revenge Turns

  private thinkRevenge(state: MatchState, input: InputFrame): InputFrame {
    const rv = state.revenge!;
    const me = state.players[this.id];
    this.plan = null;
    if (rv.shooter !== this.id) {
      this.revengePlan = null;
      this.dodge(state, me, input);
      return input;
    }
    if (rv.fired) {
      this.moveTo(state, input, me.x, sideSign(this.id) * HOME_X);
      return input;
    }
    if (!this.revengePlan) {
      this.revengePlan = this.planRevenge(state);
      this.lastRevenge = this.revengePlan;
    }
    const plan = this.revengePlan;
    if (state.tick < plan.readyAt) return input;

    // 1. Pick the weapon (NEXT on alternate ticks; the cycle includes "skip").
    if (me.revengeWeapon !== plan.weapon) {
      if (state.tick % 2 === 0) input.buttons |= Buttons.WEAPON_NEXT;
      return input;
    }
    if (plan.weapon !== 'rocket' && plan.weapon !== 'mortar' && plan.weapon !== 'homing') {
      // 2b. Air Strike: move the cursor first. Utilities and skip: just confirm.
      if (plan.weapon === 'airstrike' && Math.abs(rv.cursor - plan.cursor) > 0.1) {
        input.moveY = quantizeAxis(clamp((plan.cursor - rv.cursor) * 2, -1, 1));
        return input;
      }
      if (state.tick % 2 === 0) input.buttons |= Buttons.FIRE;
      return input;
    }
    // 2a. Aim, then hold FIRE until the charge reaches the planned power.
    if (!rv.charging && Math.abs(rv.angle - plan.angle) > 0.6) {
      input.moveY = quantizeAxis(clamp((plan.angle - rv.angle) / 8, -1, 1));
      return input;
    }
    const step = 1 / WEAPON_TUNING.revenge.chargeTicks;
    if (!rv.charging || rv.power + step < plan.power) input.buttons |= Buttons.FIRE;
    return input;
  }

  /**
   * Try a grid of angles and powers for every aimed weapon in a copy of the physics, score
   * the expected damage to the target minus the risk to itself, then add human error.
   */
  private planRevenge(state: MatchState): RevengePlan {
    const me = state.players[this.id];
    const target = state.players[other(this.id)];
    const options = revengeOptions(state, me);
    const readyAt = state.tick + nextInt(this.rng, 20, 45);
    const plan = (weapon: WeaponId | null, angle = 35, power = 0, cursor = 4): RevengePlan => ({
      weapon,
      angle,
      power,
      cursor,
      readyAt,
    });

    const attitude = this.traits.revenge;
    const behind = state.score[other(this.id)] - state.score[this.id];
    if (me.hp <= (attitude === 'always' ? 20 : 35) && options.includes('medkit'))
      return plan('medkit');
    // A Purist only shoots back when it is clearly losing on points; otherwise it patches up.
    if (attitude === 'utility' && behind < 3) {
      if (me.hp <= 75 && options.includes('medkit')) return plan('medkit');
      if (me.shield === 0 && options.includes('shield')) return plan('shield');
      return plan(null);
    }

    // A Berserker fires whatever does the most damage, however little.
    let best = { score: attitude === 'always' ? -Infinity : 2, plan: plan(null) };
    for (const weapon of ['rocket', 'mortar', 'homing'] as const) {
      if (!options.includes(weapon)) continue;
      const cost = me.ammo[weapon] > 0 ? 5 : 0;
      for (let angle = 5; angle <= 80; angle += 5) {
        for (let power = 0; power <= 1.0001; power += 0.05) {
          const l = revengeLaunch(state, this.id, angle, power);
          const impacts = simulateProjectile(
            state,
            weapon as ProjectileKind,
            this.id,
            l.x,
            l.y,
            l.vx,
            l.vy,
            target.x,
            target.y + 0.9,
          );
          let score = -cost;
          for (const hit of impacts) {
            score +=
              blastDamage(target, hit.x, hit.y, hit.blast) -
              1.5 * blastDamage(me, hit.x, hit.y, hit.blast);
          }
          if (score > best.score) best = { score, plan: plan(weapon, angle, power) };
        }
      }
    }
    if (options.includes('airstrike')) {
      const a = WEAPON_TUNING.airstrike;
      let score = -5;
      for (let i = 0; i < a.missiles; i++) {
        const x = target.x + (i - (a.missiles - 1) / 2) * a.spacing;
        score += blastDamage(target, x, target.y, WEAPONS.airstrike);
      }
      if (score > best.score) best = { score, plan: plan('airstrike', 35, 0, Math.abs(target.x)) };
    }
    if (best.plan.weapon === null && me.hp <= 60 && options.includes('shield') && me.shield === 0) {
      return plan('shield');
    }

    const p = best.plan;
    p.angle = clamp(p.angle + nextRange(this.rng, -1, 1) * this.profile.aimNoise, MIN_AIM, MAX_AIM);
    p.power = clamp(p.power + nextRange(this.rng, -1, 1) * this.profile.powerNoise, 0.02, 1);
    p.cursor = clamp(
      p.cursor + nextRange(this.rng, -1, 1) * this.profile.aimNoise * 0.05,
      0.5,
      8.4,
    );
    return p;
  }

  /** As the target: predict each incoming projectile and run out of its blast. */
  private dodge(state: MatchState, me: PlayerState, input: InputFrame): void {
    let danger: { x: number; radius: number } | null = null;
    for (const proj of state.projectiles) {
      if (proj.owner === this.id || this.dodgeIgnored.has(proj.id)) continue;
      if (!this.dodgeSeen.has(proj.id)) {
        this.dodgeSeen.add(proj.id);
        if (nextFloat(this.rng) >= this.profile.dodge) {
          this.dodgeIgnored.add(proj.id);
          continue;
        }
      }
      const impacts = simulateProjectile(
        state,
        proj.kind,
        proj.owner,
        proj.x,
        proj.y,
        proj.vx,
        proj.vy,
        proj.targetX,
        proj.targetY,
        proj.age,
      );
      for (const hit of impacts) {
        if (blastDamage(me, hit.x, hit.y, hit.blast) > 0)
          danger = { x: hit.x, radius: hit.blast.radius };
      }
    }
    if (!danger) {
      this.moveTo(state, input, me.x, sideSign(this.id) * HOME_X);
      return;
    }
    const plan = this.leavePlan(state, danger.x, danger.radius + 0.8);
    input.moveX = quantizeAxis(clamp((plan.standX - me.x) * 4, -1, 1) * this.profile.footwork);
    if (me.grounded && Math.abs(plan.standX - me.x) > 1.5) input.buttons |= Buttons.JUMP;
  }
}
