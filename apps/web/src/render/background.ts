import { HALF_COURT, NET_HEIGHT, SHORT_SERVICE_LINE } from '@deadminton/sim';
import { C, css } from './palette';
import { CENTER_X, FLOOR_Y, VIEW_H, VIEW_W, WALL_PX, sx, sy } from './view';

/** Paints the static Sports Hall (walls, windows, floor, court lines) into a 2D context. */
export function paintHall(ctx: CanvasRenderingContext2D): void {
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    ctx.fillStyle = css(c);
    ctx.fillRect(x, y, w, h);
  };
  const ceilingY = sy(10);

  // Back wall.
  rect(0, 0, VIEW_W, FLOOR_Y, C.darkSlate);
  for (let x = 0; x < VIEW_W; x += 24) rect(x, ceilingY, 1, FLOOR_Y - ceilingY, C.ink);
  // Dithered shading toward the top.
  for (let y = ceilingY; y < ceilingY + 40; y++) {
    for (let x = (y & 1) * 1; x < VIEW_W; x += 2)
      if (y < ceilingY + 20 || (x + y) % 4 === 0) rect(x, y, 1, 1, C.ink);
  }

  // High windows.
  for (let i = 0; i < 6; i++) {
    const wx = 52 + i * 66;
    rect(wx, 40, 44, 34, C.lightGray);
    rect(wx + 2, 42, 40, 30, C.navy);
    rect(wx + 2, 42, 40, 10, C.blue);
    rect(wx + 21, 42, 2, 30, C.lightGray);
    rect(wx + 2, 56, 40, 2, C.lightGray);
    for (let k = 0; k < 6; k++) rect(wx + 4 + k * 6, 44 + (k % 3), 2, 1, C.cyan);
  }

  // Club stripe and wall padding.
  rect(0, 148, VIEW_W, 3, C.yellow);
  rect(0, 151, VIEW_W, 10, C.red);
  for (let x = 6; x < VIEW_W; x += 40) rect(x, 154, 20, 4, C.brightRed);
  rect(0, 161, VIEW_W, 2, C.yellow);
  rect(0, 163, VIEW_W, FLOOR_Y - 163, C.slate);
  for (let x = 0; x < VIEW_W; x += 30) rect(x, 163, 1, FLOOR_Y - 163, C.darkSlate);
  rect(0, FLOOR_Y - 6, VIEW_W, 6, C.darkSlate);

  // Ceiling beam with lights.
  rect(0, 0, VIEW_W, ceilingY, C.black);
  rect(0, ceilingY - 2, VIEW_W, 2, C.ink);
  for (let x = 30; x < VIEW_W; x += 70) {
    rect(x, ceilingY, 24, 3, C.gray);
    rect(x + 2, ceilingY + 3, 20, 2, C.paleYellow);
  }

  // Side walls framing the arena.
  rect(0, ceilingY, CENTER_X - WALL_PX, FLOOR_Y - ceilingY, C.ink);
  rect(CENTER_X + WALL_PX, ceilingY, VIEW_W - CENTER_X - WALL_PX, FLOOR_Y - ceilingY, C.ink);
  rect(CENTER_X - WALL_PX - 2, ceilingY, 2, FLOOR_Y - ceilingY, C.slate);
  rect(CENTER_X + WALL_PX, ceilingY, 2, FLOOR_Y - ceilingY, C.slate);

  // Floor: wooden run-off, green court.
  rect(0, FLOOR_Y, VIEW_W, VIEW_H - FLOOR_Y, C.rust);
  for (let row = 0; row < 4; row++) {
    const y = FLOOR_Y + 3 + row * 4;
    rect(0, y, VIEW_W, 1, C.darkRed);
    for (let x = (row * 13) % 32; x < VIEW_W; x += 32) rect(x, y - 3, 1, 3, C.darkRed);
  }
  const courtL = sx(-HALF_COURT);
  const courtR = sx(HALF_COURT);
  rect(courtL, FLOOR_Y, courtR - courtL, VIEW_H - FLOOR_Y, C.midGreen);
  for (let row = 0; row < 4; row++)
    rect(courtL, FLOOR_Y + 4 + row * 4, courtR - courtL, 1, C.darkGreen);
  rect(0, FLOOR_Y, VIEW_W, 1, C.tan);
  rect(courtL, FLOOR_Y, courtR - courtL, 1, C.green);

  // Court lines (seen edge-on as white ticks).
  for (const x of [-HALF_COURT, -SHORT_SERVICE_LINE, SHORT_SERVICE_LINE, HALF_COURT]) {
    const px = sx(x) - 1;
    rect(px, FLOOR_Y, 2, VIEW_H - FLOOR_Y, C.white);
  }

  // Net: posts, mesh, white tape.
  const netTop = sy(NET_HEIGHT);
  const netBottom = sy(0.8);
  rect(CENTER_X - 1, netTop - 1, 2, FLOOR_Y - netTop + 1, C.lightGray);
  rect(CENTER_X, netTop - 1, 1, FLOOR_Y - netTop + 1, C.gray);
  for (let y = netTop + 2; y < netBottom; y++) {
    for (let x = -1; x <= 1; x++) if ((x + y) % 2 === 0) rect(CENTER_X + x, y, 1, 1, C.ink);
  }
  rect(CENTER_X - 2, netTop, 4, 2, C.white);
  rect(CENTER_X - 2, FLOOR_Y - 2, 4, 2, C.slate);
}
