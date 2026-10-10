import type { PlayerState } from '@deadminton/sim';
import type { PixelPainter } from './painter';
import { C } from './palette';
import type { TeamColors } from './palette';

export type SwingStyle = 'overhead' | 'underhand';

/** Celebration after a point or the match: racket up, or head down. */
export type Mood = 'win' | 'lose' | null;

export interface PlayerPose {
  /** Feet position in screen pixels. */
  x: number;
  y: number;
  player: PlayerState;
  swingStyle: SwingStyle;
  /** Fraction of the swing completed, or -1 when idle. */
  swing: number;
  runPhase: number;
  hurtFlash: boolean;
  /** > 0 squashes (landing), < 0 stretches (take-off); -1..1. */
  squash: number;
  /** Upper-body lean toward the net while running, in pixels (-2..2). */
  lean: number;
  /** Idle breathing offset (0 or 1 px). */
  bob: number;
  /** Pixels pushed back by a recent hit. */
  flinch: number;
  /** Knees bent, racket up: the shuttle is coming this way. */
  ready: boolean;
  mood: Mood;
  /** Milliseconds clock, for looping celebrations and wobbles. */
  time: number;
}

/** Where the racket head ended up this frame (for the swing smear). */
export interface RacketPoint {
  x: number;
  y: number;
}

interface V {
  x: number;
  y: number;
}

const UPPER_ARM = 5;
const FOREARM = 5;
const THIGH = 6;
const SHIN = 6;
const HANDLE = 4;
const HEAD_R = 4;
const DEG = Math.PI / 180;
const ease = (a: number, b: number, k: number) => a + (b - a) * (k * k * (3 - 2 * k));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Racket angle (degrees, 0 = toward the net, 90 = up) along the swing arc. */
function racketAngle(style: SwingStyle, t: number): number {
  if (t < 0) return 75;
  if (style === 'overhead') {
    if (t < 0.12) return ease(75, 165, t / 0.12);
    if (t < 0.6) return ease(165, -35, (t - 0.12) / 0.48);
    return ease(-35, 20, (t - 0.6) / 0.4);
  }
  if (t < 0.12) return ease(75, -150, t / 0.12);
  if (t < 0.6) return ease(-150, 55, (t - 0.12) / 0.48);
  return ease(55, 75, (t - 0.6) / 0.4);
}

/** How far the racket hand reaches (0..1 of a straight arm): bent in the wind-up, straight at contact. */
function armExtension(t: number): number {
  if (t < 0) return 0.72;
  if (t < 0.12) return ease(0.72, 0.55, t / 0.12);
  if (t < 0.45) return ease(0.55, 1, (t - 0.12) / 0.33);
  return ease(1, 0.8, clamp01((t - 0.45) / 0.55));
}

/** Upper-body lean along a swing: rock back in the wind-up, drive through the shot. */
function swingLean(t: number): number {
  if (t < 0) return 0;
  if (t < 0.12) return ease(0, -1.5, t / 0.12);
  if (t < 0.5) return ease(-1.5, 2.5, (t - 0.12) / 0.38);
  return ease(2.5, 0, (t - 0.5) / 0.5);
}

/**
 * Two-bone IK in local coordinates (x forward, y up): the middle joint for a limb from
 * `a` to target `t`. bend +1 rotates the joint counter-clockwise from the a→t line.
 */
function joint(a: V, t: V, l1: number, l2: number, bend: number): V {
  const dx = t.x - a.x;
  const dy = t.y - a.y;
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01) || 0.01;
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = Math.atan2(dy, dx) + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  return { x: a.x + Math.cos(ang) * l1, y: a.y + Math.sin(ang) * l1 };
}

/**
 * Procedural 16-bit style player, about 44 px tall (24 px per meter), built on a small
 * skeleton: legs and arms bend at the knee and elbow, so running, crouching, jumping and
 * swinging all come from the same pose math. Coordinates are local (x toward the net,
 * y up from the feet) and mirrored by facing.
 */
export function drawPlayer(p: PixelPainter, pose: PlayerPose, team: TeamColors): RacketPoint {
  const pl = pose.player;
  const f = pl.facing;
  const ox = pose.x - f * pose.flinch;
  const oy = pose.y;
  const X = (v: V) => ox + f * v.x;
  const Y = (v: V) => oy - v.y;
  const line = (a: V, b: V, c: number, size: number) => {
    const o = (size - 1) / 2;
    p.line(X(a) - o, Y(a) - o, X(b) - o, Y(b) - o, c, size);
  };
  // Rectangle in local space (dx, dy = bottom-left), mirrored by facing.
  const rect = (dx: number, dy: number, w: number, h: number, c: number) =>
    p.rect(f === 1 ? ox + dx : ox - dx - w + 1, oy - dy - h, w, h, c);

  const skin = pose.hurtFlash ? C.white : team.skin;
  const airborne = !pl.grounded;
  const swinging = pose.swing >= 0;
  const t = pose.swing;
  const speed = Math.abs(pl.vx);
  const running = !airborne && speed > 0.4;
  const backpedal = running && Math.sign(pl.vx) !== f;
  const stunned = pl.stunTicks > 0;

  // ---- Lower body: feet from the gait, hips from crouch and bob. ----
  let crouch = pose.ready && !running && !airborne ? 2 : 0;
  if (pose.squash > 0) crouch += pose.squash * 3;
  if (pose.squash < 0) crouch -= 1;
  if (pose.mood === 'lose') crouch += 1;
  const phase = pose.runPhase;
  let front: V;
  let back: V;
  let bob = pose.bob;
  if (airborne) {
    // Knees tucked on the way up, legs reaching for the floor on the way down.
    const rising = pl.vy > 0;
    front = rising ? { x: 3, y: 5 } : { x: 2, y: 1 };
    back = rising ? { x: -3, y: 3 } : { x: -2, y: 0 };
  } else if (running) {
    const stride = backpedal ? 2.5 : Math.min(5, 2 + speed * 0.6);
    const lift = backpedal ? 1.5 : 3;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    front = { x: 1 + s * stride, y: Math.max(0, c) * lift };
    back = { x: -1 - s * stride, y: Math.max(0, -c) * lift };
    // Lowest when the legs are spread, highest as they pass.
    bob = Math.abs(s) > 0.7 ? 1 : 0;
  } else {
    const spread = pose.ready || pose.squash > 0.3 ? 4 : 3;
    front = { x: spread, y: 0 };
    back = { x: -spread + 1, y: 0 };
    // Step into the shot: the front foot slides forward through the swing.
    if (swinging && t > 0.12 && t < 0.8) front = { x: spread + 2, y: 0 };
  }
  const hipY = 13 - crouch - bob;
  const backKnee = joint({ x: -1, y: hipY }, back, THIGH, SHIN, 1);
  const frontKnee = joint({ x: 1, y: hipY }, front, THIGH, SHIN, 1);

  // Back leg first (behind the body), with its shoe.
  line({ x: -1, y: hipY }, backKnee, team.skinDark, 3);
  line(backKnee, { x: back.x, y: back.y + 2 }, team.skinDark, 3);
  rect(Math.round(back.x) - 2, Math.round(back.y), 5, 2, C.white);
  rect(Math.round(back.x) - 2, Math.round(back.y), 5, 1, C.slate);

  // ---- Upper body: lean from running, swings and mood. ----
  const sway = stunned ? Math.round(Math.sin(pose.time / 90) * 1.5) : 0;
  const lean = Math.round(pose.lean + swingLean(t) + (backpedal ? -1 : 0)) + sway;
  const droop = pose.mood === 'lose' ? 2 : 0;
  const top = hipY + 22 - droop; // shoulders
  const shoulder: V = { x: 2 + lean, y: top - 2 };
  const backShoulder: V = { x: -3 + lean, y: top - 3 };

  // Back arm (behind the torso): pumps when running, points at the shuttle in an
  // overhead wind-up, tucks in at contact, waves when celebrating.
  let backAng: number;
  let backExt = 0.85;
  if (pose.mood === 'win' && !swinging) {
    backAng = 100 + Math.sin(pose.time / 120) * 10;
    backExt = 1;
  } else if (swinging && pose.swingStyle === 'overhead') {
    backAng = t < 0.3 ? ease(-80, 70, clamp01(t / 0.2)) : ease(70, -100, clamp01((t - 0.3) / 0.3));
    backExt = t < 0.3 ? 1 : 0.7;
  } else if (airborne) {
    backAng = 40;
  } else if (running) {
    backAng = -90 - Math.sin(phase) * (backpedal ? 15 : 40);
  } else {
    backAng = pose.ready ? -50 : -80;
    backExt = pose.ready ? 0.7 : 0.9;
  }
  const backHand: V = {
    x: backShoulder.x + Math.cos(backAng * DEG) * (UPPER_ARM + FOREARM) * backExt,
    y: backShoulder.y + Math.sin(backAng * DEG) * (UPPER_ARM + FOREARM) * backExt,
  };
  const backElbow = joint(backShoulder, backHand, UPPER_ARM, FOREARM, -1);
  line(backShoulder, backElbow, team.skinDark, 2);
  line(backElbow, backHand, team.skinDark, 2);

  // Shorts and torso, drawn in bands so the lean bends the body instead of tilting a box.
  const h = Math.round(hipY);
  rect(-5, h - 1, 10, 6, team.shorts);
  const bands = 4;
  const torsoH = top - (h + 5);
  for (let i = 0; i < bands; i++) {
    const y0 = h + 5 + Math.round((torsoH * i) / bands);
    const y1 = h + 5 + Math.round((torsoH * (i + 1)) / bands);
    const dx = Math.round((lean * (i + 1)) / bands);
    rect(-5 + dx, y0, 10, y1 - y0, team.shirt);
    rect(-5 + dx, y0, 2, y1 - y0, team.shirtShade);
  }

  // Head: face, hair (by style), headband or cap, eye, glasses.
  const hx = lean + (droop ? 1 : 0);
  const hy = top + 1 - droop;
  drawHead(rect, team, skin, hx, hy, {
    squint: stunned || pose.hurtFlash,
    droop: droop > 0,
    grin: pose.mood === 'win',
    tail: running ? Math.round(Math.sin(phase * 2)) : 0,
  });

  // Front leg over the shorts' edge, with its shoe.
  line({ x: 1, y: hipY }, frontKnee, skin, 3);
  line(frontKnee, { x: front.x, y: front.y + 2 }, skin, 3);
  rect(Math.round(front.x) - 1, Math.round(front.y), 5, 2, C.white);

  // ---- Racket arm: shoulder → elbow → hand, then the racket. ----
  // Between shots the hand rests at chest height with the racket up; in a swing the arm
  // and racket whip round together (blended in over the wind-up so nothing pops).
  let armAng = 15;
  let racketAng = 78;
  let ext = 0.62;
  if (pose.mood === 'win') {
    armAng = racketAng = 100 + Math.sin(pose.time / 110) * 25;
    ext = 1;
  } else if (pose.mood === 'lose') {
    armAng = -75;
    racketAng = -95;
    ext = 0.95;
  } else if (airborne) {
    armAng = 75;
    racketAng = 105;
    ext = 0.9;
  } else if (running) {
    armAng = (backpedal ? 20 : 0) + Math.sin(phase) * 12;
    racketAng = 65 + Math.sin(phase) * 8;
    ext = 0.66;
  } else if (pose.ready) {
    armAng = 30;
    racketAng = 72;
    ext = 0.7;
  }
  if (swinging) {
    const whip = racketAngle(pose.swingStyle, t);
    const blend = clamp01(t / 0.12);
    armAng = armAng + (whip - armAng) * blend;
    racketAng = whip;
    ext = armExtension(t);
  }
  const reach = (UPPER_ARM + FOREARM) * ext;
  const hand: V = {
    x: shoulder.x + Math.cos(armAng * DEG) * reach,
    y: shoulder.y + Math.sin(armAng * DEG) * reach,
  };
  const bend = pose.swingStyle === 'underhand' && swinging ? 1 : -1;
  const elbow = joint(shoulder, hand, UPPER_ARM, FOREARM, bend);
  line(shoulder, elbow, skin, 2);
  line(elbow, hand, skin, 2);
  if (team.extra === 'wristbands') {
    const wb = team.band ?? team.shirt;
    p.rect(X(hand) - 1, Y(hand) - 1, 2, 2, wb);
    p.rect(X(backHand) - 1, Y(backHand) - 1, 2, 2, wb);
  }

  const a = racketAng * DEG;
  const dir: V = { x: Math.cos(a), y: Math.sin(a) };
  const neck: V = { x: hand.x + dir.x * HANDLE, y: hand.y + dir.y * HANDLE };
  const headC: V = { x: hand.x + dir.x * (HANDLE + HEAD_R), y: hand.y + dir.y * (HANDLE + HEAD_R) };
  line(hand, neck, C.ink, 1);
  // Racket head: a small ring along the shaft direction (screen space).
  const cx = dir.x * f;
  const cy = -dir.y;
  const hx2 = X(headC);
  const hy2 = Y(headC);
  for (let i = 0; i < 12; i++) {
    const r = (i / 12) * Math.PI * 2;
    const rx = Math.cos(r) * HEAD_R;
    const ry = Math.sin(r) * (HEAD_R - 1);
    p.px(hx2 + rx * cx - ry * cy, hy2 + rx * cy + ry * cx, team.racket);
  }
  p.px(hx2, hy2, C.lightGray);
  p.px(hx2 + cx, hy2 + cy, C.lightGray);
  return { x: hx2, y: hy2 };
}

type LocalRect = (dx: number, dy: number, w: number, h: number, c: number) => void;

/** The head in local coordinates (x toward the net), bottom-left at (hx - 4, hy). */
function drawHead(
  rect: LocalRect,
  team: TeamColors,
  skin: number,
  hx: number,
  hy: number,
  o: { squint: boolean; droop: boolean; grin: boolean; tail: number },
): void {
  rect(-4 + hx, hy, 9, 9, skin);
  const hair = team.hair;
  switch (team.hairStyle) {
    case 'short':
      rect(-5 + hx, hy + 6, 10, 3, hair);
      rect(-5 + hx, hy + 1, 3, 6, hair);
      break;
    case 'long':
      rect(-5 + hx, hy + 6, 10, 3, hair);
      rect(-6 + hx, hy - 3, 4, 10, hair);
      break;
    case 'spiky':
      rect(-5 + hx, hy + 6, 10, 3, hair);
      rect(-5 + hx, hy + 2, 3, 5, hair);
      rect(-4 + hx, hy + 9, 1, 2, hair);
      rect(-1 + hx, hy + 9, 1, 3, hair);
      rect(2 + hx, hy + 9, 1, 2, hair);
      break;
    case 'mohawk':
      rect(-3 + hx, hy + 7, 4, 4, hair);
      rect(-4 + hx, hy + 5, 2, 2, hair);
      break;
    case 'ponytail':
      rect(-5 + hx, hy + 6, 10, 3, hair);
      rect(-5 + hx, hy + 2, 3, 5, hair);
      rect(-8 + hx, hy + 3 + o.tail, 3, 4, hair);
      break;
    case 'bald':
      rect(-1 + hx, hy + 8, 3, 1, team.skinDark);
      break;
  }
  if (team.extra === 'cap') {
    const cap = team.band ?? team.shirtShade;
    rect(-5 + hx, hy + 6, 10, 3, cap);
    rect(4 + hx, hy + 6, 3, 1, cap);
  } else if (team.band !== null) {
    rect(-4 + hx, hy + 5, 9, 1, team.band);
  }
  // Eye, mouth.
  if (o.squint) rect(1 + hx, hy + 3, 3, 1, C.black);
  else rect(2 + hx, hy + 3 - (o.droop ? 1 : 0), 1, 1, C.black);
  if (team.extra === 'glasses') {
    rect(0 + hx, hy + 3, 5, 1, C.ink);
    rect(2 + hx, hy + 3, 1, 1, C.lightGray);
  }
  if (o.grin) rect(1 + hx, hy, 3, 1, C.darkBrown);
  else rect(3 + hx, hy, 2, 1, team.skinDark);
}

/** A tumbling KO body: chunky limbs around a spinning torso (client-side only). */
export interface Ragdoll {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  /** Limb flail phase. */
  t: number;
  settled: boolean;
  facing: 1 | -1;
}

export function drawRagdoll(p: PixelPainter, rd: Ragdoll, team: TeamColors): void {
  const pt = (along: number, side: number) => ({
    x: rd.x + Math.sin(rd.rot) * along + Math.cos(rd.rot) * side,
    y: rd.y - Math.cos(rd.rot) * along + Math.sin(rd.rot) * side,
  });
  const limb = (from: { x: number; y: number }, ang: number, len: number, c: number) => {
    const a = rd.rot + ang;
    const to = { x: from.x + Math.sin(a) * len, y: from.y + Math.cos(a) * len };
    p.line(from.x, from.y, to.x, to.y, c, 3);
  };
  const flail = rd.settled ? 0 : Math.sin(rd.t * 18) * 0.6;
  // Torso runs from hips (along 0) to neck (along 18), centered on (x, y).
  const hips = pt(-9, 0);
  const neck = pt(9, 0);
  limb(hips, 0.4 + flail, 12, team.skinDark);
  limb(hips, -0.3 - flail, 12, team.skin);
  limb(neck, 2.2 - flail, 10, team.skinDark);
  limb(neck, -2.4 + flail, 10, team.skin);
  p.line(hips.x, hips.y, neck.x, neck.y, team.shirt, 6);
  const head = pt(14, 0);
  p.rect(head.x - 4, head.y - 4, 9, 9, team.skin);
  if (team.hairStyle !== 'bald') p.rect(head.x - 4, head.y - 4, 9, 2, team.hair);
  if (team.band !== null) p.rect(head.x - 4, head.y - 2, 9, 1, team.band);
  // X-ed out eyes.
  p.px(head.x - 1, head.y + 1, C.black);
  p.px(head.x + 1, head.y + 1, C.black);
  p.px(head.x, head.y + 2, C.black);
  p.px(head.x - 1, head.y + 3, C.black);
  p.px(head.x + 1, head.y + 3, C.black);
}
