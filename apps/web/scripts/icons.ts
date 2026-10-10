// Draws the app icon and splash screen as pixel art and writes the PNGs the iOS, Android
// and web builds use: `npm run icons -w @deadminton/web` (then `npx @capacitor/assets
// generate`, see docs/MOBILE.md). Like the rest of the game's art, it's all code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];
// Endesga 32, as in the game.
const INK = hex('#181425');
const PANEL = hex('#262b44');
const SLATE = hex('#3a4466');
const WHITE = hex('#ffffff');
const LIGHT = hex('#c0cbdc');
const GRAY = hex('#8b9bb4');
const RED = hex('#e43b44');
const DARK_RED = hex('#a22633');
const ORANGE = hex('#f77622');
const YELLOW = hex('#feae34');
const PALE = hex('#fee761');
const CLEAR: RGBA = [0, 0, 0, 0];

class Grid {
  readonly px: RGBA[];
  constructor(
    readonly w: number,
    readonly h: number,
    fill: RGBA,
  ) {
    this.px = Array.from({ length: w * h }, () => fill);
  }
  set(x: number, y: number, c: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  disc(cx: number, cy: number, r: number, c: RGBA): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c);
  }
}

/** The shuttlecock-bomb, drawn on a 32×32 grid (offset ox, oy). */
function drawShuttle(g: Grid, ox: number, oy: number): void {
  // Feather skirt: a cone, wide at the top.
  for (let y = 0; y < 13; y++) {
    const half = 8 - Math.floor(y * 0.36);
    for (let x = -half; x <= half; x++) {
      const edge = Math.abs(x) === half;
      const rib = x % 3 === 0;
      g.set(ox + 16 + x, oy + 4 + y, edge ? GRAY : rib ? LIGHT : WHITE);
    }
  }
  // Feather tips.
  for (let x = -8; x <= 8; x += 2) g.set(ox + 16 + x, oy + 3, WHITE);
  // Band where the skirt meets the cork.
  g.rect(ox + 11, oy + 17, 11, 2, YELLOW);
  // The cork is a bomb.
  g.disc(ox + 16, oy + 23, 6, DARK_RED);
  g.disc(ox + 16, oy + 23, 5, RED);
  g.rect(ox + 13, oy + 20, 2, 2, hex('#ff8a8f'));
  g.set(ox + 13, oy + 22, hex('#ff8a8f'));
  // Fuse and spark, out of the cork's side.
  const fuse = hex('#ead4aa');
  g.set(ox + 21, oy + 19, fuse);
  g.set(ox + 22, oy + 18, fuse);
  g.set(ox + 23, oy + 17, fuse);
  g.set(ox + 24, oy + 16, ORANGE);
  g.set(ox + 25, oy + 15, WHITE);
  for (const [dx, dy] of [
    [24, 15],
    [26, 15],
    [25, 14],
    [25, 16],
  ] as const)
    g.set(ox + dx, oy + dy, PALE);
  for (const [dx, dy] of [
    [23, 14],
    [27, 14],
    [27, 16],
    [25, 13],
  ] as const)
    g.set(ox + dx, oy + dy, YELLOW);
}

/** Dark background with a soft lighter disc behind the shuttle. */
function drawBackground(g: Grid, cx: number, cy: number, r: number): void {
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // Dithered edge between the two rings.
      const band = d < r - 1 ? 2 : d < r + 1 ? ((x + y) % 2 ? 2 : 1) : d < r * 1.35 ? 1 : 0;
      g.set(x, y, band === 2 ? SLATE : band === 1 ? PANEL : INK);
    }
}

/** Encodes the grid scaled up by `scale`, centered on a `size` square padded with `pad`. */
function png(g: Grid, scale: number, size = g.w * scale, pad: RGBA = CLEAR): Buffer {
  const W = size;
  const H = size;
  const ox = Math.floor((size - g.w * scale) / 2);
  const oy = Math.floor((size - g.h * scale) / 2);
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const gx = Math.floor((x - ox) / scale);
      const gy = Math.floor((y - oy) / scale);
      const inside = x >= ox && y >= oy && gx < g.w && gy < g.h;
      raw.set(inside ? g.px[gy * g.w + gx]! : pad, y * (W * 4 + 1) + 1 + x * 4);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}assets`, { recursive: true });
const out = (path: string, g: Grid, scale: number, size?: number, pad?: RGBA) => {
  writeFileSync(`${root}${path}`, png(g, scale, size, pad));
  const px = size ?? g.w * scale;
  console.log(`wrote ${path} (${px}×${px})`);
};

// Full icon (iOS, web): background + shuttle, 32 px art scaled ×32 = 1024.
const icon = new Grid(32, 32, INK);
drawBackground(icon, 16, 17, 12);
drawShuttle(icon, 0, 0);
out('assets/icon-only.png', icon, 32);
out('public/icon-512.png', icon, 16);
out('public/icon-192.png', icon, 6);

// Android adaptive icon: the shuttle on a transparent layer inside the safe zone (the
// 32 px art in the middle of a 64 px grid), plus a background layer. Both 1024.
const fg = new Grid(64, 64, CLEAR);
drawShuttle(fg, 16, 16);
out('assets/icon-foreground.png', fg, 16);
const bg = new Grid(64, 64, INK);
drawBackground(bg, 32, 33, 20);
out('assets/icon-background.png', bg, 16);

// Splash: the shuttle in the middle of a 2732 square (both themes are dark).
const splash = new Grid(32, 32, INK);
drawShuttle(splash, 0, 0);
out('assets/splash.png', splash, 16, 2732, INK);
out('assets/splash-dark.png', splash, 16, 2732, INK);
