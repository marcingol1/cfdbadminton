import { HALF_COURT, NET_HEIGHT, SHORT_SERVICE_LINE, WALL_X } from '@deadminton/sim';
import { C, css } from './palette';
import { CENTER_X, FLOOR_Y, VIEW_H, VIEW_W, sx, sy } from './view';

/** Paints the Rooftop arena: night skyline, open sky, a roof slab with pits on both sides. */
export function paintRooftop(ctx: CanvasRenderingContext2D): void {
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    ctx.fillStyle = css(c);
    ctx.fillRect(x, y, w, h);
  };

  // Sky: banded gradient with dithered transitions.
  const bands = [C.black, C.ink, C.navy, C.purple];
  const bandH = 52;
  for (let i = 0; i < bands.length; i++) rect(0, i * bandH, VIEW_W, bandH, bands[i]!);
  rect(0, bands.length * bandH, VIEW_W, VIEW_H, C.purple);
  for (let i = 1; i < bands.length; i++) {
    for (let y = i * bandH - 4; y < i * bandH; y++)
      for (let x = (y & 1) * 2; x < VIEW_W; x += 4) rect(x, y, 1, 1, bands[i]!);
  }

  // Stars (fixed pseudo-random pattern) and the moon.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * VIEW_W);
    const y = Math.floor(rand() * 110);
    rect(x, y, 1, 1, rand() < 0.2 ? C.paleYellow : C.lightGray);
  }
  for (let y = -9; y <= 9; y++)
    for (let x = -9; x <= 9; x++)
      if (x * x + y * y <= 81) rect(330 + x, 82 + y, 1, 1, C.paleYellow);
  for (let y = -9; y <= 9; y++)
    for (let x = -9; x <= 9; x++)
      if ((x + 4) * (x + 4) + (y - 2) * (y - 2) <= 49) rect(330 + x, 82 + y, 1, 1, C.tan);

  // City skyline with lit windows.
  seed = 42;
  for (let x = -10; x < VIEW_W;) {
    const w = 18 + Math.floor(rand() * 26);
    const h = 40 + Math.floor(rand() * 90);
    const top = FLOOR_Y - 20 - h;
    rect(x, top, w, VIEW_H - top, rand() < 0.5 ? C.ink : C.darkSlate);
    for (let wy = top + 4; wy < FLOOR_Y - 8; wy += 6)
      for (let wx = x + 3; wx < x + w - 3; wx += 5)
        if (rand() < 0.28) rect(wx, wy, 2, 2, rand() < 0.7 ? C.yellow : C.paleYellow);
    if (rand() < 0.3) rect(x + Math.floor(w / 2), top - 8, 1, 8, C.slate);
    x += w + 2;
  }

  // The abyss on both sides of the roof.
  const left = sx(-WALL_X);
  const right = sx(WALL_X);
  for (let y = FLOOR_Y; y < VIEW_H; y++) {
    const c = y < FLOOR_Y + 6 ? C.ink : C.black;
    rect(0, y, left, 1, c);
    rect(right, y, VIEW_W - right, 1, c);
  }

  // Roof slab: concrete run-off, green court, white lines, a lip at each edge.
  rect(left, FLOOR_Y, right - left, VIEW_H - FLOOR_Y, C.slate);
  for (let row = 0; row < 4; row++) rect(left, FLOOR_Y + 4 + row * 4, right - left, 1, C.darkSlate);
  const courtL = sx(-HALF_COURT);
  const courtR = sx(HALF_COURT);
  rect(courtL, FLOOR_Y, courtR - courtL, VIEW_H - FLOOR_Y, C.midGreen);
  for (let row = 0; row < 4; row++)
    rect(courtL, FLOOR_Y + 4 + row * 4, courtR - courtL, 1, C.darkGreen);
  rect(left, FLOOR_Y, right - left, 1, C.lightGray);
  rect(courtL, FLOOR_Y, courtR - courtL, 1, C.green);
  for (const x of [-HALF_COURT, -SHORT_SERVICE_LINE, SHORT_SERVICE_LINE, HALF_COURT])
    rect(sx(x) - 1, FLOOR_Y, 2, VIEW_H - FLOOR_Y, C.white);
  // Hazard stripes on the roof edges.
  for (let y = FLOOR_Y; y < VIEW_H; y += 4) {
    rect(left, y, 2, 2, C.yellow);
    rect(right - 2, y + 2, 2, 2, C.yellow);
  }

  // Net.
  const netTop = sy(NET_HEIGHT);
  const netBottom = sy(0.8);
  rect(CENTER_X - 1, netTop - 1, 2, FLOOR_Y - netTop + 1, C.lightGray);
  rect(CENTER_X, netTop - 1, 1, FLOOR_Y - netTop + 1, C.gray);
  for (let y = netTop + 2; y < netBottom; y++)
    for (let x = -1; x <= 1; x++) if ((x + y) % 2 === 0) rect(CENTER_X + x, y, 1, 1, C.ink);
  rect(CENTER_X - 2, netTop, 4, 2, C.white);
}
