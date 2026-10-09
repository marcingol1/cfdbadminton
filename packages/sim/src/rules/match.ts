import {
  BODY_BOTTOM,
  BODY_TOP,
  HALF_COURT,
  PLAYER_HALF_WIDTH,
  SERVE_HAND_FORWARD,
  SERVE_HAND_HEIGHT,
  SHORT_SERVICE_LINE,
  SHUTTLE_SUBSTEPS,
} from '../constants';
import { MAX_HP, NO_FALL, applyDamage, explode, knockback } from '../combat';
import { ARENAS } from '../data/arenas';
import { DEFAULT_TUNING } from '../data/tuning';
import { SCHEMES, WEAPONS, WEAPON_TUNING } from '../data/weapons';
import { Buttons, intentFromInput } from '../input';
import { clamp, hypot2 } from '../math/dmath';
import { nextRange, nextU32, seedRng } from '../math/prng';
import { advanceFlight } from '../physics/shuttle';
import { chooseShot, playShot } from '../shots';
import type {
  InputFrame,
  MatchConfig,
  MatchState,
  PlayerId,
  PlayerState,
  PointReason,
  PointsToWin,
  ShotIntent,
  ShuttleWeapon,
  SimEvent,
  WinReason,
} from '../types';
import { maybeDropCrate, stepCrates, stepMines } from '../weapons/field';
import { spawnProjectile, stepProjectiles } from '../weapons/projectiles';
import { consumeAmmo, isAvailable } from '../weapons/selection';
import {
  createTerrain,
  flightEnv,
  groundAt,
  halfOwner,
  other,
  shoulderOf,
  sideSign,
} from '../world';
import { rallyWeaponControls, updatePlayer } from './player';
import { canRevenge, startRevenge, stepRevenge } from './revenge';

/** R-01: hard cap on points for each target score. */
export const POINT_CAP: Record<PointsToWin, number> = { 7: 10, 11: 15, 21: 30 };
/** A rally with no hit for this long is ended where the shuttle is (stuck-shuttle safety net). */
const STUCK_RALLY_TICKS = 30 * 60;
/** R-05: HP restored at the start of each new game. */
export const NEW_GAME_HEAL = 20;

function createPlayer(id: PlayerId, config: MatchConfig): PlayerState {
  return {
    id,
    x: sideSign(id) * 3,
    y: 0,
    vx: 0,
    vy: 0,
    grounded: true,
    facing: id === 0 ? 1 : -1,
    swingTick: -1,
    swingIntent: 'neutral',
    swingContact: false,
    prevButtons: 0,
    hp: MAX_HP,
    shield: 0,
    dead: false,
    stunTicks: 0,
    knockTicks: 0,
    airPeak: NO_FALL,
    throwTicks: 0,
    ammo: { ...SCHEMES[config.scheme].ammo },
    rallyWeapon: null,
    revengeWeapon: 'rocket',
    fuse: WEAPON_TUNING.frag.defaultFuse,
  };
}

export function createMatch(config: Partial<MatchConfig>, seed: number): MatchState {
  const full: MatchConfig = {
    arena: config.arena ?? 'hall',
    pointsToWin: config.pointsToWin ?? 11,
    bestOf: config.bestOf ?? 1,
    scheme: config.scheme ?? 'standard',
    timeLimitSec: config.timeLimitSec ?? null,
    classicTargeting: config.classicTargeting ?? false,
    // Deep copy so live tuning edits never leak between matches.
    tuning: structuredClone(config.tuning ?? DEFAULT_TUNING),
  };
  const rng = seedRng(seed);
  const state: MatchState = {
    tick: 0,
    config: full,
    rng,
    phase: 'serve',
    phaseTicks: 0,
    players: [createPlayer(0, full), createPlayer(1, full)],
    shuttle: { mode: 'held', x: 0, y: 0, vx: 0, vy: 0, weapon: null, fuseTicks: 0, ghostTicks: 0 },
    rally: { hits: 0, isServe: true, lastHitter: 0, ticksSinceHit: 0, serveClock: 0 },
    score: [0, 0],
    games: [0, 0],
    // R-10: the first server is a coin toss from the seed.
    server: (nextU32(rng) & 1) as PlayerId,
    wind: 0,
    lastPoint: null,
    winner: null,
    winReason: null,
    rallyCount: 0,
    playTicks: 0,
    suddenDeath: false,
    terrain: createTerrain(),
    projectiles: [],
    mines: [],
    crates: [],
    revenge: null,
    pendingRevenge: null,
    pendingGame: false,
    nextId: 1,
  };
  startServe(state, []);
  return state;
}

function startServe(state: MatchState, events: SimEvent[]): void {
  const t = state.config.tuning;
  for (const p of state.players) {
    const isServer = p.id === state.server;
    p.x = sideSign(p.id) * (isServer ? t.serve.serverX : t.serve.receiverX);
    p.y = groundAt(state, p.x);
    p.vx = 0;
    p.vy = 0;
    p.grounded = true;
    p.swingTick = -1;
    p.swingContact = false;
    p.knockTicks = 0;
    p.stunTicks = 0;
    p.throwTicks = 0;
    p.airPeak = NO_FALL;
  }
  const windMax = ARENAS[state.config.arena].windMax;
  state.wind = Math.round(nextRange(state.rng, -windMax, windMax) * 10) / 10;
  state.rally = {
    hits: 0,
    isServe: true,
    lastHitter: state.server,
    ticksSinceHit: 0,
    serveClock: 0,
  };
  state.revenge = null;
  state.pendingRevenge = null;
  const s = state.shuttle;
  s.weapon = null;
  s.fuseTicks = 0;
  s.ghostTicks = 0;
  placeShuttleInHand(state);
  state.phase = 'serve';
  state.phaseTicks = 0;
  events.push({ type: 'newRally', server: state.server, wind: state.wind });
}

/** R-05: a new game keeps HP (+20) and ammo, but resets score, craters and field objects. */
function startNewGame(state: MatchState, events: SimEvent[]): void {
  state.score = [0, 0];
  state.rallyCount = 0;
  state.terrain = createTerrain();
  state.mines = [];
  state.crates = [];
  state.projectiles = [];
  state.pendingGame = false;
  for (const p of state.players) p.hp = Math.min(MAX_HP, p.hp + NEW_GAME_HEAL);
  startServe(state, events);
}

function placeShuttleInHand(state: MatchState): void {
  const server = state.players[state.server];
  const s = state.shuttle;
  s.mode = 'held';
  s.x = server.x + server.facing * SERVE_HAND_FORWARD;
  s.y = server.y + SERVE_HAND_HEIGHT;
  s.vx = 0;
  s.vy = 0;
}

/** Swing timing + racket distance → quality in [0, 1]. */
function contactQuality(state: MatchState, p: PlayerState, dist: number): number {
  const s = state.config.tuning.swing;
  const reach = state.config.tuning.player.reach;
  const distTerm = Math.abs(dist - state.config.tuning.player.sweetSpot) / reach;
  const window = Math.max(s.idealTick - s.activeStart, s.activeEnd - s.idealTick);
  const timeTerm = Math.abs(p.swingTick - s.idealTick) / window;
  return clamp(1 - 0.9 * distTerm - 0.5 * timeTerm, 0, 1);
}

/** Loaded shots (GAME_DESIGN §7.1, R-11, R-50, R-51) applied at the moment of a hit. */
function applyShotWeapons(
  state: MatchState,
  p: PlayerState,
  isServe: boolean,
  events: SimEvent[],
): void {
  const s = state.shuttle;
  if (s.weapon === 'shock') {
    // Whoever touches a Shock Shuttle next takes the hit; it's single-use.
    applyDamage(p, WEAPONS.shock.damage, 'shock', events);
    p.stunTicks = WEAPON_TUNING.shock.stunTicks;
    events.push({ type: 'shocked', player: p.id });
    s.weapon = null;
  }
  const w = p.rallyWeapon;
  // R-11: no weapons on a serve. R-50: a shuttle carries one weapon (Frags stay live).
  if (isServe || s.weapon !== null || w === null || WEAPONS[w].category !== 'loaded') return;
  if (!isAvailable(state, p, w)) return;
  consumeAmmo(p, w);
  s.weapon = w as ShuttleWeapon;
  if (w === 'frag') s.fuseTicks = p.fuse * 60;
  p.rallyWeapon = null;
  events.push({ type: 'loaded', player: p.id, weapon: s.weapon });
}

function launchShuttle(
  state: MatchState,
  p: PlayerState,
  intent: ShotIntent,
  quality: number,
  isServe: boolean,
  events: SimEvent[],
): void {
  const s = state.shuttle;
  applyShotWeapons(state, p, isServe, events);
  const shot = chooseShot(intent, s.y, Math.abs(s.x), isServe);
  const env = flightEnv(state);
  const v = playShot(
    shot,
    quality,
    s.x,
    s.y,
    p.facing,
    state.wind,
    env.k,
    state.config.tuning,
    env.ceiling,
    state.rng,
  );
  s.mode = 'flight';
  s.vx = v.vx;
  s.vy = v.vy;
  const r = state.rally;
  r.lastHitter = p.id;
  r.ticksSinceHit = 0;
  r.hits++;
  r.isServe = isServe;
  events.push({
    type: 'hit',
    player: p.id,
    shot,
    quality,
    x: s.x,
    y: s.y,
    speed: hypot2(v.vx, v.vy),
    weapon: s.weapon,
  });
}

function tryContact(state: MatchState, p: PlayerState, events: SimEvent[]): boolean {
  const sw = state.config.tuning.swing;
  if (p.swingTick < sw.activeStart || p.swingTick > sw.activeEnd || p.swingContact) return false;
  const s = state.shuttle;
  // R-24: a player can't hit twice in a row (the contact simply doesn't register).
  if (state.rally.lastHitter === p.id) return false;
  // R-25: contact only on your own side of the net.
  if (halfOwner(s.x) !== p.id) return false;
  const sh = shoulderOf(p);
  const dist = hypot2(s.x - sh.x, s.y - sh.y);
  if (dist > state.config.tuning.player.reach) return false;
  p.swingContact = true;
  launchShuttle(state, p, p.swingIntent, contactQuality(state, p, dist), false, events);
  return true;
}

function serve(state: MatchState, intent: ShotIntent, events: SimEvent[]): void {
  const p = state.players[state.server];
  p.swingTick = 0;
  p.swingIntent = intent;
  p.swingContact = true;
  events.push({ type: 'swing', player: p.id });
  launchShuttle(state, p, intent, state.config.tuning.serve.quality, true, events);
  const hit = events[events.length - 1];
  if (hit?.type === 'hit') events.push({ type: 'serve', player: p.id, shot: hit.shot });
  state.phase = 'rally';
  state.phaseTicks = 0;
}

function bodyHit(state: MatchState): PlayerState | null {
  const s = state.shuttle;
  const grace = state.config.tuning.swing.selfHitGrace;
  for (const p of state.players) {
    if (p.dead) continue;
    if (p.id === state.rally.lastHitter && state.rally.ticksSinceHit < grace) continue;
    if (
      s.x >= p.x - PLAYER_HALF_WIDTH &&
      s.x <= p.x + PLAYER_HALF_WIDTH &&
      s.y >= p.y + BODY_BOTTOM &&
      s.y <= p.y + BODY_TOP
    ) {
      return p;
    }
  }
  return null;
}

/** Damage from a shuttle hitting a body (GAME_DESIGN §7.1). */
function bodyHitDamage(state: MatchState, victim: PlayerState, events: SimEvent[]): void {
  const s = state.shuttle;
  const speed = hypot2(s.vx, s.vy);
  switch (s.weapon) {
    case 'frag':
      detonateShuttle(state, events);
      return;
    case 'lead': {
      applyDamage(victim, WEAPONS.lead.damage, 'lead', events);
      const kb = WEAPONS.lead.knockback;
      knockback(victim, (s.vx / (speed || 1)) * kb, kb * 0.5);
      return;
    }
    case 'shock':
      applyDamage(victim, WEAPONS.shock.damage, 'shock', events);
      victim.stunTicks = WEAPON_TUNING.shock.stunTicks;
      events.push({ type: 'shocked', player: victim.id });
      s.weapon = null;
      return;
    default: {
      const sm = WEAPON_TUNING.smash;
      if (speed <= sm.minSpeed) return;
      const f = clamp((speed - sm.minSpeed) / (sm.maxSpeed - sm.minSpeed), 0, 1);
      applyDamage(victim, sm.minDamage + (sm.maxDamage - sm.minDamage) * f, 'smash', events);
    }
  }
}

/** R-20, R-21, R-23, R-13: who wins when the shuttle comes down at x. */
export function judgeLanding(
  x: number,
  lastHitter: PlayerId,
  isServe: boolean,
): { winner: PlayerId; reason: PointReason } {
  const receiver = other(lastHitter);
  if (halfOwner(x) === lastHitter) return { winner: receiver, reason: 'ownSide' };
  if (Math.abs(x) > HALF_COURT) return { winner: receiver, reason: 'out' };
  if (isServe && Math.abs(x) < SHORT_SERVICE_LINE)
    return { winner: receiver, reason: 'serveShort' };
  return { winner: lastHitter, reason: 'in' };
}

/** R-01 for one game. */
export function isMatchWon(
  score: [number, number],
  pointsToWin: PointsToWin,
  p: PlayerId,
): boolean {
  const s = score[p];
  const o = score[other(p)];
  return (s >= pointsToWin && s - o >= 2) || s >= POINT_CAP[pointsToWin];
}

/** Ends the match (by points or KO). The point pause plays out first, then matchOver. */
function endMatch(
  state: MatchState,
  winner: PlayerId,
  reason: WinReason,
  events: SimEvent[],
): void {
  if (state.winner !== null) return;
  state.winner = winner;
  state.winReason = reason;
  state.revenge = null;
  state.pendingRevenge = null;
  if (state.shuttle.mode === 'flight') state.shuttle.mode = 'dead';
  if (state.phase !== 'point') {
    state.phase = 'point';
    state.phaseTicks = 0;
  }
  events.push({ type: 'matchOver', winner, reason });
}

function awardPoint(
  state: MatchState,
  winner: PlayerId,
  reason: PointReason,
  x: number,
  events: SimEvent[],
): void {
  if (state.phase !== 'rally') return;
  state.score[winner]++;
  state.server = winner; // R-10
  state.lastPoint = { winner, reason, x };
  state.phase = 'point';
  state.phaseTicks = 0;
  state.rallyCount++;
  if (state.shuttle.mode === 'flight') state.shuttle.mode = 'dead';
  // R-51: loadouts are cleared when the rally ends; unused ammo is kept.
  for (const p of state.players) if (p.rallyWeapon !== 'mine') p.rallyWeapon = null;
  events.push({ type: 'point', winner, reason, score: [state.score[0], state.score[1]] });

  if (state.suddenDeath) return endMatch(state, winner, 'points', events); // R-06
  if (isMatchWon(state.score, state.config.pointsToWin, winner)) {
    state.games[winner]++;
    const needed = (state.config.bestOf + 1) / 2;
    if (state.config.bestOf > 1)
      events.push({ type: 'gameOver', winner, games: [state.games[0], state.games[1]] });
    if (state.games[winner] >= needed) return endMatch(state, winner, 'points', events);
    state.pendingGame = true; // R-05
    return;
  }
  const loser = other(winner);
  state.pendingRevenge = canRevenge(state, loser) ? loser : null; // R-40
}

/** Blows up a Frag Shuttle where it is. R-27: in a live rally it counts as landing below. */
function detonateShuttle(state: MatchState, events: SimEvent[]): void {
  const s = state.shuttle;
  const x = s.x;
  const y = s.y;
  s.weapon = null;
  s.fuseTicks = 0;
  const live = state.phase === 'rally' && s.mode === 'flight';
  s.mode = 'gone';
  explode(state, x, y, WEAPONS.frag, 'frag', events);
  if (live) {
    const verdict = judgeLanding(x, state.rally.lastHitter, state.rally.isServe);
    events.push({ type: 'land', x, inBounds: Math.abs(x) <= HALF_COURT });
    awardPoint(state, verdict.winner, verdict.reason, x, events);
  }
}

/** A Cluster Shuttle splits into bomblets when it touches the floor. */
function burstCluster(state: MatchState): void {
  const s = state.shuttle;
  s.weapon = null;
  const owner = state.rally.lastHitter;
  for (let i = 0; i < WEAPON_TUNING.cluster.bomblets; i++) {
    spawnProjectile(
      state,
      'clusterBomb',
      owner,
      s.x,
      s.y + 0.15,
      s.vx * 0.1 + nextRange(state.rng, -3.5, 3.5),
      nextRange(state.rng, 3, 6),
    );
  }
}

/** Frag fuse and Ghost invisibility count down in every phase. */
function stepShuttleWeapon(state: MatchState, events: SimEvent[]): void {
  const s = state.shuttle;
  if (s.ghostTicks > 0) s.ghostTicks--;
  if (s.weapon === 'frag' && s.mode !== 'held' && s.mode !== 'gone') {
    s.fuseTicks--;
    if (s.fuseTicks <= 0) detonateShuttle(state, events);
  }
}

function stepRallyShuttle(state: MatchState, events: SimEvent[]): void {
  const s = state.shuttle;
  for (let i = 0; i < SHUTTLE_SUBSTEPS && state.phase === 'rally' && s.mode === 'flight'; i++) {
    const env = flightEnv(state);
    const px = s.x;
    const ev = advanceFlight(s, env);
    if (s.weapon === 'ghost' && px < 0 !== s.x < 0)
      s.ghostTicks = WEAPON_TUNING.ghost.invisibleTicks;
    if (ev?.kind === 'net') {
      events.push({ type: 'net', x: 0, y: ev.y });
    } else if (ev?.kind === 'floor' || ev?.kind === 'wall') {
      const verdict = judgeLanding(ev.x, state.rally.lastHitter, state.rally.isServe);
      if (ev.kind === 'floor') s.mode = 'grounded';
      events.push({ type: 'land', x: ev.x, inBounds: Math.abs(ev.x) <= HALF_COURT });
      if (ev.kind === 'floor' && s.weapon === 'cluster') burstCluster(state);
      awardPoint(state, verdict.winner, verdict.reason, ev.x, events);
      return;
    } else if (ev?.kind === 'ceiling') {
      s.vy = -Math.abs(s.vy) * 0.3;
      awardPoint(state, other(state.rally.lastHitter), 'ceiling', s.x, events); // R-26
      return;
    }
    // Racket contact takes precedence over a body hit at the same moment.
    if (tryContact(state, state.players[0], events) || tryContact(state, state.players[1], events))
      continue;
    const victim = bodyHit(state);
    if (victim) {
      events.push({ type: 'bodyHit', player: victim.id, x: s.x, y: s.y });
      bodyHitDamage(state, victim, events); // R-28: damage alone never ends a rally…
      if (s.mode === 'flight') {
        s.vx *= -0.2;
        s.vy = 0;
      }
      awardPoint(state, other(victim.id), 'body', s.x, events); // …but the body hit does (R-22)
      return;
    }
  }
}

/** After the rally: the shuttle falls with no rules attached (it can still blow up). */
function stepDeadShuttle(state: MatchState): void {
  const s = state.shuttle;
  if (s.mode !== 'dead') return;
  const env = flightEnv(state);
  for (let i = 0; i < SHUTTLE_SUBSTEPS; i++) {
    const ev = advanceFlight(s, env);
    if (ev?.kind === 'floor') {
      s.mode = 'grounded';
      if (s.weapon === 'cluster') burstCluster(state);
      return;
    }
    if (ev?.kind === 'ceiling') s.vy = -Math.abs(s.vy) * 0.3;
    if (ev?.kind === 'wall') s.vx = -s.vx * 0.3;
  }
}

/** R-02, R-03, R-04: decide the match when someone reaches 0 HP. */
function resolveDeaths(state: MatchState, events: SimEvent[]): void {
  const fallen = state.players.filter((p) => !p.dead && p.hp <= 0);
  if (fallen.length === 0) return;
  for (const p of fallen) {
    p.dead = true;
    events.push({ type: 'ko', player: p.id });
  }
  if (state.winner !== null) return;
  const alive = state.players.filter((p) => !p.dead);
  if (alive.length === 1) return endMatch(state, alive[0]!.id, 'ko', events);
  // Double KO: more points wins; a tie goes to a Sudden Death rally at 1 HP.
  const [a, b] = state.score;
  if (a !== b) return endMatch(state, a > b ? 0 : 1, 'ko', events);
  for (const p of state.players) {
    p.dead = false;
    p.hp = 1;
    p.shield = 0;
  }
  enterSuddenDeath(state, events);
  if (state.shuttle.mode === 'flight') state.shuttle.mode = 'dead';
  state.revenge = null;
  state.pendingRevenge = null;
  state.pendingGame = false;
  state.phase = 'point';
  state.phaseTicks = 0;
}

function enterSuddenDeath(state: MatchState, events: SimEvent[]): void {
  if (state.suddenDeath) return;
  state.suddenDeath = true;
  for (const p of state.players) {
    if (p.dead) continue;
    p.hp = 1;
    p.shield = 0;
  }
  events.push({ type: 'suddenDeath' });
}

/** What follows the point pause: match over, a new game, a Revenge Turn, or the next serve. */
function afterPointPause(state: MatchState, events: SimEvent[]): void {
  if (state.winner !== null) {
    state.phase = 'matchOver';
    state.phaseTicks = 0;
    return;
  }
  if (state.pendingGame) return startNewGame(state, events);
  const shooter = state.pendingRevenge;
  state.pendingRevenge = null;
  if (shooter !== null && canRevenge(state, shooter)) return startRevenge(state, shooter, events);
  maybeDropCrate(state, events);
  startServe(state, events);
}

/**
 * Advances the match by one tick (1/60 s). Mutates `state` and returns what happened.
 * Pure function of (state, inputs): no clock, no Math.random, no I/O.
 */
export function step(state: MatchState, inputs: readonly [InputFrame, InputFrame]): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  state.phaseTicks++;
  const pressed = [
    inputs[0].buttons & ~state.players[0].prevButtons,
    inputs[1].buttons & ~state.players[1].prevButtons,
  ] as const;
  const free = { locked: false, canSwing: false };

  switch (state.phase) {
    case 'serve': {
      for (const p of state.players) {
        const isServer = p.id === state.server;
        // The server is locked in place and swings by serving; the receiver moves freely.
        updatePlayer(
          state,
          p,
          inputs[p.id],
          isServer ? 0 : pressed[p.id],
          { locked: isServer, canSwing: false },
          events,
        );
        rallyWeaponControls(state, p, pressed[p.id], false, events);
      }
      placeShuttleInHand(state);
      state.rally.serveClock++;
      state.playTicks++;
      const server = state.players[state.server];
      if (pressed[state.server] & Buttons.HIT && !server.dead) {
        serve(state, intentFromInput(inputs[state.server], server.facing), events);
      } else if (state.rally.serveClock >= state.config.tuning.serve.clockTicks) {
        serve(state, 'up', events); // R-14: automatic high serve
      }
      break;
    }
    case 'rally': {
      for (const p of state.players) {
        const netTouch = updatePlayer(
          state,
          p,
          inputs[p.id],
          pressed[p.id],
          { locked: false, canSwing: true },
          events,
        );
        rallyWeaponControls(state, p, pressed[p.id], true, events);
        if (netTouch) awardPoint(state, other(p.id), 'netTouch', p.x, events); // R-29
      }
      state.rally.ticksSinceHit++;
      state.playTicks++;
      stepRallyShuttle(state, events);
      if (state.phase === 'rally' && state.rally.ticksSinceHit > STUCK_RALLY_TICKS) {
        // Safety net: a shuttle that somehow never comes down is judged where it is.
        const s = state.shuttle;
        const verdict = judgeLanding(s.x, state.rally.lastHitter, state.rally.isServe);
        awardPoint(state, verdict.winner, verdict.reason, s.x, events);
      }
      break;
    }
    case 'point': {
      for (const p of state.players) {
        updatePlayer(state, p, inputs[p.id], pressed[p.id], free, events);
        rallyWeaponControls(state, p, pressed[p.id], false, events);
      }
      stepDeadShuttle(state);
      if (state.phaseTicks >= state.config.tuning.pointPauseTicks) afterPointPause(state, events);
      break;
    }
    case 'revenge': {
      state.playTicks++;
      stepDeadShuttle(state);
      if (stepRevenge(state, inputs, pressed, events)) {
        state.revenge = null;
        events.push({ type: 'revengeEnd' });
        maybeDropCrate(state, events);
        startServe(state, events);
      }
      break;
    }
    case 'matchOver': {
      for (const p of state.players)
        updatePlayer(state, p, inputs[p.id], pressed[p.id], free, events);
      stepDeadShuttle(state);
      break;
    }
  }

  stepShuttleWeapon(state, events);
  stepProjectiles(state, events);
  stepMines(state, events);
  stepCrates(state, events);
  resolveDeaths(state, events);

  const limit = state.config.timeLimitSec;
  if (limit !== null && state.winner === null && state.playTicks >= limit * 60)
    enterSuddenDeath(state, events);

  state.players[0].prevButtons = inputs[0].buttons;
  state.players[1].prevButtons = inputs[1].buttons;
  return events;
}
