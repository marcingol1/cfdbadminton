import { TERRAIN_STEP, WALL_X } from '@deadminton/sim';
import type { Crate, MatchState, Mine, PlayerState, Projectile } from '@deadminton/sim';
import type { Painter } from './painter';
import { C, HP_COLORS } from './palette';
import { CENTER_X, FLOOR_Y, PX_PER_M, sx, sy } from './view';

// 3×5 pixel digits for fuse countdowns and the like.
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/** Draws digits centered on x, top at y, with a 1 px dark outline for contrast. */
export function drawDigits(p: Painter, text: string, x: number, y: number, color: number): void {
  const w = text.length * 4 - 1;
  const left = Math.round(x - w / 2);
  p.rect(left - 1, y - 1, w + 2, 7, C.black, 0.7);
  [...text].forEach((ch, i) => {
    const glyph = DIGITS[ch];
    if (!glyph) return;
    glyph.forEach((row, gy) =>
      [...row].forEach((bit, gx) => bit === '1' && p.px(left + i * 4 + gx, y + gy, color)),
    );
  });
}

/** Craters: dark holes cut into the floor strip. */
export function drawTerrain(p: Painter, state: MatchState): void {
  const left = sx(-WALL_X);
  const right = sx(WALL_X);
  for (let px = left; px < right; px++) {
    const x = (px + 0.5 - CENTER_X) / PX_PER_M;
    const i = Math.floor((x + WALL_X) / TERRAIN_STEP);
    const h = state.terrain[i] ?? 0;
    if (h > -0.02) continue;
    const d = Math.max(1, Math.round(-h * PX_PER_M));
    p.rect(px, FLOOR_Y, 1, d, C.darkBrown);
    p.px(px, FLOOR_Y + d, C.brown);
  }
}

export function drawMine(p: Painter, m: Mine, timeMs: number): void {
  const x = sx(m.x);
  const y = sy(m.y);
  p.rect(x - 3, y - 2, 7, 2, C.slate);
  p.rect(x - 2, y - 3, 5, 1, C.gray);
  let light: number = C.gray;
  if (m.fuseTicks > 0) light = Math.floor(timeMs / 60) % 2 ? C.paleYellow : C.brightRed;
  else if (m.armTicks <= 0) light = Math.floor(timeMs / 500) % 2 ? C.brightRed : C.red;
  p.px(x, y - 4, light);
}

export function drawCrate(p: Painter, c: Crate): void {
  const x = sx(c.x);
  const y = sy(c.y);
  if (!c.landed) {
    // Parachute canopy and strings.
    for (let i = -6; i <= 6; i++)
      p.px(x + i, y - 18 - Math.round(Math.sqrt(36 - i * i) * 0.6), C.lightGray);
    p.line(x - 6, y - 18, x - 3, y - 8, C.gray);
    p.line(x + 6, y - 18, x + 3, y - 8, C.gray);
  }
  const body = c.contents === 'health' ? C.white : c.contents === 'shield' ? C.cyan : C.brown;
  const edge = c.contents === 'weapon' ? C.tan : C.lightGray;
  p.rect(x - 4, y - 8, 8, 8, edge);
  p.rect(x - 3, y - 7, 6, 6, body);
  if (c.contents === 'health') {
    p.rect(x - 1, y - 6, 2, 4, C.brightRed);
    p.rect(x - 2, y - 5, 4, 2, C.brightRed);
  } else if (c.contents === 'weapon') {
    p.line(x - 3, y - 7, x + 2, y - 2, C.darkBrown);
    p.line(x + 2, y - 7, x - 3, y - 2, C.darkBrown);
  } else {
    p.rect(x - 1, y - 6, 2, 4, C.navy);
  }
}

export function drawProjectile(p: Painter, proj: Projectile): void {
  const x = sx(proj.x);
  const y = sy(proj.y);
  const v = Math.hypot(proj.vx, proj.vy) || 1;
  const dx = proj.vx / v;
  const dy = -proj.vy / v;
  switch (proj.kind) {
    case 'rocket':
    case 'homing': {
      const body = proj.kind === 'homing' ? C.cyan : C.lightGray;
      for (let i = 0; i < 4; i++) p.px(x - dx * i, y - dy * i, body);
      p.px(x + dx, y + dy, C.brightRed);
      p.px(x - dx * 4, y - dy * 4, C.orange);
      break;
    }
    case 'airMissile':
      p.rect(x, y - 4, 1, 4, C.lightGray);
      p.px(x, y, C.brightRed);
      p.px(x - 1, y - 4, C.gray);
      p.px(x + 1, y - 4, C.gray);
      break;
    case 'mortar':
      p.rect(x - 2, y - 2, 5, 5, C.black);
      p.rect(x - 1, y - 1, 3, 3, C.lightGray);
      p.px(x - 1, y - 1, C.white);
      break;
    case 'mortarBomb':
    case 'clusterBomb':
      p.rect(x - 1, y - 2, 4, 4, C.black);
      p.rect(x, y - 1, 2, 2, proj.kind === 'clusterBomb' ? C.orange : C.lightGray);
      break;
    case 'mineThrown':
      p.rect(x - 2, y - 1, 5, 2, C.slate);
      p.px(x, y - 2, C.brightRed);
      break;
  }
}

export function drawTombstone(p: Painter, x: number, y: number): void {
  p.rect(x - 5, y - 12, 10, 12, C.slate);
  p.rect(x - 4, y - 14, 8, 2, C.slate);
  p.rect(x - 3, y - 15, 6, 1, C.slate);
  p.rect(x - 4, y - 11, 8, 10, C.gray);
  p.rect(x - 3, y - 13, 6, 2, C.gray);
  p.rect(x - 1, y - 11, 2, 7, C.slate);
  p.rect(x - 3, y - 9, 6, 2, C.slate);
  // A racket leaning on the stone.
  p.line(x + 6, y - 1, x + 9, y - 9, C.ink);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    p.px(x + 10 + Math.round(Math.cos(t) * 2), y - 12 + Math.round(Math.sin(t) * 3), C.lightGray);
  }
}

export function drawShield(p: Painter, x: number, y: number, timeMs: number): void {
  for (let i = 0; i < 28; i++) {
    if ((i + Math.floor(timeMs / 80)) % 3 === 0) continue;
    const t = (i / 28) * Math.PI * 2;
    p.px(x + Math.cos(t) * 13, y - 22 + Math.sin(t) * 25, C.cyan, 0.8);
  }
}

export function drawStun(p: Painter, x: number, y: number, timeMs: number): void {
  for (let i = 0; i < 3; i++) {
    const t = timeMs / 150 + (i * Math.PI * 2) / 3;
    p.px(x + Math.cos(t) * 7, y - 47 + Math.sin(t) * 2, C.paleYellow);
  }
}

/** Small HP (and shield) bar above a player's head. */
export function drawHpBar(p: Painter, pl: PlayerState, x: number, y: number): void {
  const w = 16;
  const fill = Math.round((pl.hp / 100) * w);
  const color = pl.hp > 60 ? HP_COLORS.ok : pl.hp > 30 ? HP_COLORS.warn : HP_COLORS.low;
  p.rect(x - w / 2 - 1, y - 52, w + 2, 4, C.black, 0.8);
  p.rect(x - w / 2, y - 51, fill, 2, color);
  if (pl.shield > 0) p.rect(x - w / 2, y - 52, Math.round((pl.shield / 100) * w), 1, C.cyan);
}

/** A filled pixel disc (explosion flashes). */
export function drawDisc(
  p: Painter,
  x: number,
  y: number,
  r: number,
  color: number,
  alpha = 1,
): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    p.rect(x - half, y + dy, half * 2 + 1, 1, color, alpha);
  }
}
