import { drawDisc } from './field';
import type { Painter } from './painter';
import { C } from './palette';
import { FLOOR_Y, VIEW_H } from './view';

// Client-side visual effects. Nothing here touches the simulation, so Math.random is fine.

/** Accessibility options that change how loud the visuals are. */
export interface FxSettings {
  /** Screen shake multiplier: 1 full, 0.4 reduced, 0 off. */
  shake: number;
  /** False softens flashes (no white screen flash, dimmer explosion cores). */
  flashes: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  gravity: number;
  size: number;
  /** Stops at the floor instead of falling through. */
  floor: boolean;
}

interface Smoke {
  x: number;
  y: number;
  r0: number;
  r1: number;
  vy: number;
  life: number;
  max: number;
  color: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: number;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
}

/** A line that streaks behind something fast (smashes). */
interface Streak {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  max: number;
  color: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  private particles: Particle[] = [];
  private smokes: Smoke[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private streaks: Streak[] = [];
  /** Full-screen white flash, in ms left. */
  screenFlash = 0;

  constructor(private readonly settings: () => FxSettings) {}

  clear(): void {
    this.particles = [];
    this.smokes = [];
    this.rings = [];
    this.flashes = [];
    this.streaks = [];
    this.screenFlash = 0;
  }

  burst(
    x: number,
    y: number,
    n: number,
    color: number,
    speed: number,
    opts: { upward?: boolean; gravity?: number; life?: number; size?: number } = {},
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * rand(0.4, 1);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: opts.upward ? -Math.abs(Math.sin(a) * v) : Math.sin(a) * v,
        life: 0,
        max: (opts.life ?? 250) + Math.random() * 250,
        color,
        gravity: opts.gravity ?? 260,
        size: opts.size ?? 1,
        floor: false,
      });
    }
  }

  /** Kicked-up floor dust; dir pushes it sideways (-1 left, 1 right, 0 both). */
  dust(x: number, y: number, n: number, dir = 0, strength = 1): void {
    for (let i = 0; i < n; i++) {
      const side = dir === 0 ? (i % 2 ? 1 : -1) : dir;
      this.particles.push({
        x: x + rand(-2, 2),
        y: y - 1,
        vx: side * rand(15, 45) * strength,
        vy: -rand(10, 35) * strength,
        life: 0,
        max: rand(250, 450),
        color: Math.random() < 0.5 ? C.tan : C.beige,
        gravity: 90,
        size: Math.random() < 0.3 ? 2 : 1,
        floor: true,
      });
    }
  }

  smoke(x: number, y: number, r0: number, r1: number, max: number, color: number = C.gray): void {
    this.smokes.push({ x, y, r0, r1, vy: -rand(8, 18), life: 0, max, color });
  }

  ring(x: number, y: number, r: number, max: number, color: number): void {
    this.rings.push({ x, y, r, life: 0, max, color });
  }

  streak(x0: number, y0: number, x1: number, y1: number, color: number, max = 140): void {
    this.streaks.push({ x0, y0, x1, y1, life: 0, max, color });
  }

  /** Fire, smoke, debris and a shockwave. Radius in pixels. */
  explosion(X: number, Y: number, r: number, nearFloor: boolean): void {
    this.flashes.push({ x: X, y: Y, r: Math.round(r * 0.8), life: 0 });
    this.ring(X, Y, r * 1.3, 260, C.paleYellow);
    const fire = [C.paleYellow, C.yellow, C.orange, C.brightRed];
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = r * rand(2, 5);
      this.particles.push({
        x: X,
        y: Y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 30,
        life: 0,
        max: rand(300, 600),
        color: fire[i % fire.length]!,
        gravity: 200,
        size: Math.random() < 0.3 ? 2 : 1,
        floor: true,
      });
    }
    // Rolling smoke puffs that rise and fade.
    for (let i = 0; i < 6; i++) {
      this.smoke(
        X + rand(-0.5, 0.5) * r,
        Y + rand(-0.3, 0.2) * r,
        r * 0.25,
        r * rand(0.45, 0.7),
        rand(700, 1200),
        i % 2 ? C.slate : C.gray,
      );
    }
    if (nearFloor) {
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: X + rand(-4, 4),
          y: FLOOR_Y - 1,
          vx: rand(-70, 70),
          vy: -rand(60, 170),
          life: 0,
          max: rand(600, 900),
          color: Math.random() < 0.5 ? C.brown : C.darkBrown,
          gravity: 320,
          size: Math.random() < 0.4 ? 2 : 1,
          floor: true,
        });
      }
      this.dust(X, FLOOR_Y, 10, 0, 2);
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.particles = this.particles.filter((q) => (q.life += dtMs) < q.max);
    for (const q of this.particles) {
      q.vy += q.gravity * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.floor && q.y > FLOOR_Y - 1) {
        q.y = FLOOR_Y - 1;
        q.vy *= -0.3;
        q.vx *= 0.6;
      }
      q.y = Math.min(q.y, VIEW_H - 1);
    }
    this.smokes = this.smokes.filter((s) => (s.life += dtMs) < s.max);
    for (const s of this.smokes) s.y += s.vy * dt;
    this.rings = this.rings.filter((r) => (r.life += dtMs) < r.max);
    this.flashes = this.flashes.filter((f) => (f.life += dtMs) < 110);
    this.streaks = this.streaks.filter((s) => (s.life += dtMs) < s.max);
    this.screenFlash = Math.max(0, this.screenFlash - dtMs);
  }

  /** Smoke goes behind the action; everything else on top. */
  drawBack(p: Painter): void {
    for (const s of this.smokes) {
      const t = s.life / s.max;
      const r = Math.round(s.r0 + (s.r1 - s.r0) * Math.sqrt(t));
      // Chunky dither: skip more rows as it fades.
      const skip = t < 0.4 ? 1 : t < 0.75 ? 2 : 3;
      for (let dy = -r; dy <= r; dy++) {
        if ((Math.round(s.y) + dy) % skip !== 0) continue;
        const half = Math.floor(Math.sqrt(r * r - dy * dy));
        p.rect(s.x - half, s.y + dy, half * 2 + 1, 1, s.color, 0.55 * (1 - t));
      }
    }
  }

  drawFront(p: Painter): void {
    const soft = !this.settings().flashes;
    for (const s of this.streaks) {
      const a = 1 - s.life / s.max;
      p.line(s.x0, s.y0, s.x1, s.y1, s.color, 1, a * 0.8);
      p.px(s.x0, s.y0, C.white, a);
    }
    for (const r of this.rings) {
      const t = r.life / r.max;
      const rad = r.r * (0.3 + 0.7 * Math.sqrt(t));
      const n = Math.max(12, Math.round(rad * 4));
      for (let i = 0; i < n; i++) {
        if (t > 0.5 && i % 2) continue;
        const a = (i / n) * Math.PI * 2;
        p.px(r.x + Math.cos(a) * rad, r.y + Math.sin(a) * rad * 0.8, r.color, 1 - t);
      }
    }
    for (const f of this.flashes) {
      if (soft) drawDisc(p, f.x, f.y, Math.round(f.r * 0.7), C.orange, 0.4);
      else drawDisc(p, f.x, f.y, f.r, f.life < 50 ? C.white : C.paleYellow, 0.85);
    }
    for (const q of this.particles) p.rect(q.x, q.y, q.size, q.size, q.color, 1 - q.life / q.max);
  }

  /** Full-screen flash overlay (KOs); skipped when flashes are softened. */
  drawScreen(p: Painter, w: number, h: number): void {
    if (this.screenFlash <= 0 || !this.settings().flashes) return;
    p.rect(0, 0, w, h, C.white, Math.min(0.5, this.screenFlash / 200));
  }
}
