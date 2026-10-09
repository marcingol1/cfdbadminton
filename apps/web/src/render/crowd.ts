import type { Painter } from './painter';
import { C, TEAMS } from './palette';
import { CENTER_X, WALL_PX } from './view';

// Spectators on the Sports Hall balcony. Each half of the hall supports the player on its
// side: they jump and wave when their player scores, and sit still otherwise.

interface Fan {
  x: number;
  y: number;
  side: 0 | 1;
  skin: number;
  hair: number;
  /** A team color (looked up when drawn, so palette changes apply) or a fixed one. */
  shirt: number | 'shirt' | 'shirtShade';
  phase: number;
  /** 0 calm … 1 on their feet. */
  excite: number;
}

const SKINS = [C.skin, C.beige, C.rose, C.skinDark, C.brown];
const HAIRS = [C.black, C.darkBrown, C.brown, C.yellow, C.ink, C.lightGray];
const NEUTRAL = [C.green, C.purple, C.slate, C.tan, C.mauve, C.darkGreen, C.gray];

export class Crowd {
  private readonly fans: Fan[] = [];

  constructor() {
    const left = CENTER_X - WALL_PX + 4;
    const right = CENTER_X + WALL_PX - 8;
    for (const [row, y] of [
      [0, 128],
      [1, 138],
    ] as const) {
      for (let x = left + row * 5; x < right; x += 10) {
        // Leave a gap behind the net post for readability.
        if (Math.abs(x + 2 - CENTER_X) < 8) continue;
        const side: 0 | 1 = x + 2 < CENTER_X ? 0 : 1;
        const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
        this.fans.push({
          x,
          y,
          side,
          skin: pick(SKINS),
          hair: pick(HAIRS),
          shirt:
            Math.random() < 0.55 ? (Math.random() < 0.5 ? 'shirt' : 'shirtShade') : pick(NEUTRAL),
          phase: Math.random() * 1000,
          excite: 0,
        });
      }
    }
  }

  /** side: whose fans react (null = everyone). */
  cheer(side: 0 | 1 | null, level: number): void {
    for (const f of this.fans)
      if (side === null || f.side === side)
        f.excite = Math.max(f.excite, level * (0.7 + Math.random() * 0.3));
  }

  draw(p: Painter, dtMs: number, timeMs: number): void {
    for (const f of this.fans) {
      f.excite = Math.max(0, f.excite - dtMs / 2200);
      const t = timeMs + f.phase;
      const jumping = f.excite > 0.35;
      const hop = jumping
        ? Math.floor(t / 130) % 2
          ? -2
          : 0
        : Math.floor(t / 900) % 7 === 0
          ? -1
          : 0;
      const x = f.x;
      const y = f.y + hop;
      // Body, head, hair.
      p.rect(x - 1, y + 5, 7, 6, typeof f.shirt === 'number' ? f.shirt : TEAMS[f.side][f.shirt]);
      p.rect(x, y, 5, 5, f.skin);
      p.rect(x, y, 5, 2, f.hair);
      if (f.excite > 0.6) {
        // Both arms up, waving.
        const wave = Math.floor(t / 160) % 2;
        p.rect(x - 2 - wave, y - 3, 1, 8, f.skin);
        p.rect(x + 6 + wave, y - 3, 1, 8, f.skin);
      } else if (jumping) {
        p.rect(x + 6, y - 2, 1, 7, f.skin);
      }
    }
  }
}
