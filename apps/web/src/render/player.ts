import type { PlayerState } from '@deadminton/sim';
import type { Painter } from './painter';
import { C } from './palette';
import type { TeamColors } from './palette';

export type SwingStyle = 'overhead' | 'underhand';

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
export function drawPlayer(p: Painter, pose: PlayerPose, team: TeamColors): void {
  const f = pose.player.facing;
  const x = pose.x;
  const y = pose.y;
  // Draw helper relative to the feet, mirrored by facing (dx is "forward").
  const r = (dx: number, dy: number, w: number, h: number, c: number) =>
    p.rect(f === 1 ? x + dx : x - dx - w + 1, y - dy - h, w, h, c);
  const skin = pose.hurtFlash ? C.white : C.skin;
  const airborne = !pose.player.grounded;

  // Legs + shoes.
  const stride = airborne ? 0 : Math.round(Math.sin(pose.runPhase) * 2);
  const backLeg = airborne ? -3 : -3 - stride;
  const frontLeg = airborne ? 2 : 1 + stride;
  r(backLeg, 2, 3, 11, C.skinDark);
  r(frontLeg, airborne ? 4 : 2, 3, airborne ? 9 : 11, skin);
  r(backLeg - 1, 0, 5, 2, C.white);
  r(frontLeg, airborne ? 2 : 0, 5, 2, C.white);
  r(backLeg - 1, 0, 5, 1, C.slate);

  // Shorts, torso.
  r(-5, 13, 10, 5, team.shorts);
  r(-5, 18, 10, 17, team.shirt);
  r(-5, 18, 2, 17, team.shirtShade);
  r(-1, 26, 3, 1, team.shirtShade);

  // Head: hair, face, headband, eye.
  r(-4, 35, 9, 9, skin);
  r(-5, 41, 10, 3, team.hair);
  r(-5, 36, 3, 6, team.hair);
  r(-4, 40, 9, 1, team.band);
  r(2, 38, 1, 1, C.black);
  r(3, 35, 2, 1, C.skinDark);

  // Back arm hangs (or balances during a swing).
  const back = pose.swing >= 0 ? -6 : -5;
  r(back, 22, 2, 11, C.skinDark);

  // Racket arm from the shoulder.
  const sx0 = x + f * 2;
  const sy0 = y - 33;
  const a = racketAngle(pose.swingStyle, pose.swing) * DEG;
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
}
