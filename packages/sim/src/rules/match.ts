import {
  DT,
  HALF_COURT,
  NET_CLEARANCE,
  PLAYER_HALF_WIDTH,
  SERVE_HAND_FORWARD,
  SERVE_HAND_HEIGHT,
  SHORT_SERVICE_LINE,
  SHOULDER_FORWARD,
  SHOULDER_HEIGHT,
  SHUTTLE_SUBSTEPS,
  BODY_BOTTOM,
  BODY_TOP,
  WALL_X,
} from '../constants';
import { ARENAS } from '../data/arenas';
import { DEFAULT_TUNING } from '../data/tuning';
import { Buttons, intentFromInput } from '../input';
import { clamp, hypot2 } from '../math/dmath';
import { nextRange, nextU32, seedRng } from '../math/prng';
import { advanceFlight, dragCoefficient } from '../physics/shuttle';
import type { FlightEnv } from '../physics/shuttle';
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
  SimEvent,
} from '../types';

/** R-01: hard cap on points for each target score. */
export const POINT_CAP: Record<PointsToWin, number> = { 7: 10, 11: 15, 21: 30 };

export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** -1 for player 0 (left half), +1 for player 1 (right half). */
export function sideSign(p: PlayerId): -1 | 1 {
  return p === 0 ? -1 : 1;
}

/** Which player's half x is on. */
export function halfOwner(x: number): PlayerId {
  return x < 0 ? 0 : 1;
}

export function shoulderOf(p: PlayerState): { x: number; y: number } {
  return { x: p.x + p.facing * SHOULDER_FORWARD, y: p.y + SHOULDER_HEIGHT };
}

export function flightEnv(state: MatchState): FlightEnv {
  const t = state.config.tuning;
  return {
    gravity: t.shuttle.gravity,
    k: dragCoefficient(t),
    wind: state.wind,
    ceiling: ARENAS[state.config.arena].ceiling,
  };
}

function createPlayer(id: PlayerId): PlayerState {
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
    hp: 100,
  };
}

export function createMatch(config: Partial<MatchConfig>, seed: number): MatchState {
  const full: MatchConfig = {
    arena: config.arena ?? 'hall',
    pointsToWin: config.pointsToWin ?? 11,
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
    players: [createPlayer(0), createPlayer(1)],
    shuttle: { mode: 'held', x: 0, y: 0, vx: 0, vy: 0 },
    rally: { hits: 0, isServe: true, lastHitter: 0, ticksSinceHit: 0, serveClock: 0 },
    score: [0, 0],
    // R-10: the first server is a coin toss from the seed.
    server: (nextU32(rng) & 1) as PlayerId,
    wind: 0,
    lastPoint: null,
    winner: null,
  };
  startServe(state, []);
  return state;
}

function startServe(state: MatchState, events: SimEvent[]): void {
  const t = state.config.tuning;
  for (const p of state.players) {
    const isServer = p.id === state.server;
    p.x = sideSign(p.id) * (isServer ? t.serve.serverX : t.serve.receiverX);
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.grounded = true;
    p.swingTick = -1;
    p.swingContact = false;
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
  placeShuttleInHand(state);
  state.phase = 'serve';
  state.phaseTicks = 0;
  events.push({ type: 'newRally', server: state.server, wind: state.wind });
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

function updatePlayer(
  state: MatchState,
  p: PlayerState,
  input: InputFrame,
  pressed: number,
  locked: boolean,
  canSwing: boolean,
  events: SimEvent[],
): void {
  const t = state.config.tuning.player;
  const axis = Math.abs(input.moveX) > 12 ? input.moveX / 127 : 0;
  const targetVx = locked ? 0 : axis * t.runSpeed;
  const accel = (p.grounded ? t.groundAccel : t.airAccel) * DT;
  p.vx += clamp(targetVx - p.vx, -accel, accel);

  if (!locked && p.grounded && pressed & Buttons.JUMP) {
    p.vy = t.jumpVelocity;
    p.grounded = false;
  }
  if (!p.grounded) p.vy -= t.gravity * DT;

  p.x += p.vx * DT;
  p.y += p.vy * DT;
  if (p.y <= 0) {
    p.y = 0;
    p.vy = 0;
    p.grounded = true;
  }

  // Players can never cross the net plane or leave the arena.
  const lo = p.id === 0 ? -WALL_X + PLAYER_HALF_WIDTH : NET_CLEARANCE;
  const hi = p.id === 0 ? -NET_CLEARANCE : WALL_X - PLAYER_HALF_WIDTH;
  if (p.x < lo || p.x > hi) {
    p.x = clamp(p.x, lo, hi);
    p.vx = 0;
  }

  if (p.swingTick >= 0) {
    p.swingTick++;
    if (p.swingTick >= state.config.tuning.swing.totalTicks) p.swingTick = -1;
  }
  if (canSwing && p.swingTick < 0 && pressed & Buttons.HIT) {
    p.swingTick = 0;
    p.swingIntent = intentFromInput(input, p.facing);
    p.swingContact = false;
    events.push({ type: 'swing', player: p.id });
  }
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

function launchShuttle(
  state: MatchState,
  p: PlayerState,
  intent: ShotIntent,
  quality: number,
  isServe: boolean,
  events: SimEvent[],
): void {
  const s = state.shuttle;
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

export function isMatchWon(
  score: [number, number],
  pointsToWin: PointsToWin,
  p: PlayerId,
): boolean {
  const s = score[p];
  const o = score[other(p)];
  return (s >= pointsToWin && s - o >= 2) || s >= POINT_CAP[pointsToWin];
}

function awardPoint(
  state: MatchState,
  winner: PlayerId,
  reason: PointReason,
  x: number,
  events: SimEvent[],
): void {
  state.score[winner]++;
  state.server = winner; // R-10
  state.lastPoint = { winner, reason, x };
  state.phase = 'point';
  state.phaseTicks = 0;
  if (state.shuttle.mode === 'flight') state.shuttle.mode = 'dead';
  events.push({ type: 'point', winner, reason, score: [state.score[0], state.score[1]] });
  if (isMatchWon(state.score, state.config.pointsToWin, winner)) {
    state.winner = winner;
    events.push({ type: 'matchOver', winner, reason: 'points' });
  }
}

function stepRallyShuttle(state: MatchState, events: SimEvent[]): void {
  const env = flightEnv(state);
  const s = state.shuttle;
  for (let i = 0; i < SHUTTLE_SUBSTEPS && state.phase === 'rally'; i++) {
    const ev = advanceFlight(s, env);
    if (ev?.kind === 'net') {
      events.push({ type: 'net', x: 0, y: ev.y });
    } else if (ev?.kind === 'floor' || ev?.kind === 'wall') {
      const verdict = judgeLanding(ev.x, state.rally.lastHitter, state.rally.isServe);
      if (ev.kind === 'floor') s.mode = 'grounded';
      events.push({ type: 'land', x: ev.x, inBounds: Math.abs(ev.x) <= HALF_COURT });
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
      s.vx *= -0.2;
      s.vy = 0;
      awardPoint(state, other(victim.id), 'body', s.x, events); // R-22
      return;
    }
  }
}

/** After the rally: let the dead shuttle fall to the floor with no rules attached. */
function stepDeadShuttle(state: MatchState): void {
  const s = state.shuttle;
  if (s.mode !== 'dead') return;
  const env = flightEnv(state);
  for (let i = 0; i < SHUTTLE_SUBSTEPS; i++) {
    const ev = advanceFlight(s, env);
    if (ev?.kind === 'floor') {
      s.mode = 'grounded';
      return;
    }
    if (ev?.kind === 'ceiling') s.vy = -Math.abs(s.vy) * 0.3;
    if (ev?.kind === 'wall') s.vx = -s.vx * 0.3;
  }
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

  switch (state.phase) {
    case 'serve': {
      for (const p of state.players) {
        const isServer = p.id === state.server;
        // The server is locked in place and swings by serving; the receiver moves freely.
        updatePlayer(state, p, inputs[p.id], isServer ? 0 : pressed[p.id], isServer, false, events);
      }
      placeShuttleInHand(state);
      state.rally.serveClock++;
      const serverInput = inputs[state.server];
      if (pressed[state.server] & Buttons.HIT) {
        serve(state, intentFromInput(serverInput, state.players[state.server].facing), events);
      } else if (state.rally.serveClock >= state.config.tuning.serve.clockTicks) {
        serve(state, 'up', events); // R-14: automatic high serve
      }
      break;
    }
    case 'rally': {
      for (const p of state.players)
        updatePlayer(state, p, inputs[p.id], pressed[p.id], false, true, events);
      state.rally.ticksSinceHit++;
      stepRallyShuttle(state, events);
      break;
    }
    case 'point': {
      for (const p of state.players)
        updatePlayer(state, p, inputs[p.id], pressed[p.id], false, false, events);
      stepDeadShuttle(state);
      if (state.phaseTicks >= state.config.tuning.pointPauseTicks) {
        if (state.winner !== null) {
          state.phase = 'matchOver';
          state.phaseTicks = 0;
        } else {
          startServe(state, events);
        }
      }
      break;
    }
    case 'matchOver': {
      for (const p of state.players)
        updatePlayer(state, p, inputs[p.id], pressed[p.id], false, false, events);
      stepDeadShuttle(state);
      break;
    }
  }

  state.players[0].prevButtons = inputs[0].buttons;
  state.players[1].prevButtons = inputs[1].buttons;
  return events;
}
