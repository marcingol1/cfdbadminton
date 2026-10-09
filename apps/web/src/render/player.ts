import type { PlayerState } from '@deadminton/sim';
import type { Painter } from './painter';
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
  mood: Mood;
  /** Milliseconds clock, for looping celebrations and wobbles. */
  time: number;
}

/** Where the racket head ended up this frame (for the swing smear). */
export interface RacketPoint {
  x: number;
  y: number;
}

const ARM = 9;
const HANDLE = 4;
const HEAD_R = 4;
const DEG = Math.PI / 180;

/** Racket angle (degrees, 0 = toward the net, 90 = up) along the swing arc. */
function racketAngle(style: SwingStyle, t: number): number {
  if (t < 0) return 75;
  const ease = (a: number, b: number, k: number) => a + (b - a) * (k * k * (3 - 2 * k));
  if (style === 'overhead') {
    if (t < 0.12) return ease(75, 165, t / 0.12);
    if (t < 0.6) return ease(165, -35, (t - 0.12) / 0.48);
    return ease(-35, 20, (t - 0.6) / 0.4);
  }
  if (t < 0.12) return ease(75, -150, t / 0.12);
  if (t < 0.6) return ease(-150, 55, (t - 0.12) / 0.48);
  return ease(55, 75, (t - 0.6) / 0.4);
}

/** Procedural 16-bit style player, about 44 px tall (24 px per meter). */
export function drawPlayer(p: Painter, pose: PlayerPose, team: TeamColors): RacketPoint {
  const f = pose.player.facing;
  const x = pose.x - f * pose.flinch;
  const y = pose.y;
  // Squash and stretch scale every height; the upper body also leans and breathes.
  const k = 1 - pose.squash * 0.14;
  const lean = Math.round(pose.lean);
  const bob = pose.bob;
  // Draw helper relative to the feet, mirrored by facing (dx is "forward").
  const r = (dx: number, dy: number, w: number, h: number, c: number) => {
    const top = Math.round((dy + h) * k);
    const bottom = Math.round(dy * k);
    p.rect(f === 1 ? x + dx : x - dx - w + 1, y - top, w, Math.max(1, top - bottom), c);
  };
  // Upper body: shifted by lean, lowered by breathing.
  const u = (dx: number, dy: number, w: number, h: number, c: number) =>
    r(dx + lean, dy - bob, w, h, c);
  const skin = pose.hurtFlash ? C.white : C.skin;
  const airborne = !pose.player.grounded;
  const stunned = pose.player.stunTicks > 0;
  // Stunned players sway; losers hang their head.
  const sway = stunned ? Math.round(Math.sin(pose.time / 90) * 1.5) : 0;
  const droop = pose.mood === 'lose' ? 2 : 0;

  // Legs + shoes. A wider stance when squashed.
  const stride = airborne ? 0 : Math.round(Math.sin(pose.runPhase) * 2.5);
  const spread = pose.squash > 0.3 ? 1 : 0;
  const backLeg = (airborne ? -3 : -3 - stride) - spread;
  const frontLeg = (airborne ? 2 : 1 + stride) + spread;
  const tuck = airborne && pose.player.vy > 0 ? 2 : 0;
  r(backLeg, 2 + tuck, 3, 11 - tuck, C.skinDark);
  r(frontLeg, airborne ? 4 : 2, 3, airborne ? 9 : 11, skin);
  r(backLeg - 1, tuck, 5, 2, C.white);
  r(frontLeg, airborne ? 2 : 0, 5, 2, C.white);
  r(backLeg - 1, tuck, 5, 1, C.slate);

  // Shorts, torso.
  r(-5, 13, 10, 5, team.shorts);
  u(-5, 18, 10, 17 - droop, team.shirt);
  u(-5, 18, 2, 17 - droop, team.shirtShade);
  u(-1, 26, 3, 1, team.shirtShade);

  // Head: hair, face, headband, eye.
  const hx = sway + (droop ? 1 : 0);
  const hy = -droop;
  u(-4 + hx, 35 + hy, 9, 9, skin);
  u(-5 + hx, 41 + hy, 10, 3, team.hair);
  u(-5 + hx, 36 + hy, 3, 6, team.hair);
  u(-4 + hx, 40 + hy, 9, 1, team.band);
  if (pose.player.stunTicks > 0 || pose.hurtFlash) {
    // Squeezed-shut eye.
    u(1 + hx, 38 + hy, 3, 1, C.black);
  } else {
    u(2 + hx, 38 + hy - (droop ? 1 : 0), 1, 1, C.black);
  }
  if (pose.mood === 'win')
    u(1 + hx, 35 + hy, 3, 1, C.darkBrown); // grin
  else u(3 + hx, 35 + hy, 2, 1, C.skinDark);

  // Back arm hangs (or balances during a swing, or pumps a fist).
  if (pose.mood === 'win') {
    u(-6, 31, 2, 6, C.skinDark);
    u(-6, 37, 3, 2, C.skinDark);
  } else {
    const back = pose.swing >= 0 ? -6 : -5;
    u(back, 22 - droop, 2, 11, C.skinDark);
  }

  // Racket arm from the shoulder.
  const sx0 = x + f * (2 + lean);
  const sy0 = y - Math.round((33 - bob - droop) * k);
  let angle = racketAngle(pose.swingStyle, pose.swing);
  if (pose.swing < 0 && pose.mood === 'win') angle = 100 + Math.sin(pose.time / 110) * 25;
  else if (pose.swing < 0 && pose.mood === 'lose') angle = -70;
  else if (pose.swing < 0 && airborne) angle = 95;
  const a = angle * DEG;
  const cx = Math.cos(a) * f;
  const cy = -Math.sin(a);
  const hand = { x: sx0 + cx * ARM, y: sy0 + cy * ARM };
  const neck = { x: sx0 + cx * (ARM + HANDLE), y: sy0 + cy * (ARM + HANDLE) };
  const head = { x: sx0 + cx * (ARM + HANDLE + HEAD_R), y: sy0 + cy * (ARM + HANDLE + HEAD_R) };
  p.line(sx0, sy0, hand.x, hand.y, skin, 2);
  p.line(hand.x, hand.y, neck.x, neck.y, C.ink);
  // Racket head: a small ring perpendicular-ish to the shaft.
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const ox = Math.cos(t) * HEAD_R;
    const oy = Math.sin(t) * (HEAD_R - 1);
    p.px(head.x + ox * cx - oy * cy, head.y + ox * cy + oy * cx, team.racket);
  }
  p.px(head.x, head.y, C.lightGray);
  p.px(head.x + cx, head.y + cy, C.lightGray);
  return head;
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

export function drawRagdoll(p: Painter, rd: Ragdoll, team: TeamColors): void {
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
  limb(hips, 0.4 + flail, 12, C.skinDark);
  limb(hips, -0.3 - flail, 12, C.skin);
  limb(neck, 2.2 - flail, 10, C.skinDark);
  limb(neck, -2.4 + flail, 10, C.skin);
  p.line(hips.x, hips.y, neck.x, neck.y, team.shirt, 6);
  const head = pt(14, 0);
  p.rect(head.x - 4, head.y - 4, 9, 9, C.skin);
  p.rect(head.x - 4, head.y - 4, 9, 2, team.hair);
  p.rect(head.x - 4, head.y - 2, 9, 1, team.band);
  // X-ed out eyes.
  p.px(head.x - 1, head.y + 1, C.black);
  p.px(head.x + 1, head.y + 1, C.black);
  p.px(head.x, head.y + 2, C.black);
  p.px(head.x - 1, head.y + 3, C.black);
  p.px(head.x + 1, head.y + 3, C.black);
}
