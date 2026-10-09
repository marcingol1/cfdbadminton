import Phaser from 'phaser';
import {
  SERVE_HAND_HEIGHT,
  SHOULDER_HEIGHT,
  WEAPON_TUNING,
  cos,
  degToRad,
  predictShuttle,
  shoulderOf,
  sideSign,
  sin,
} from '@deadminton/sim';
import type { ArenaId, MatchState, PlayerId, SimEvent } from '@deadminton/sim';
import { BotController } from '../game/controllers';
import type { MatchSession } from '../game/session';
import { paintHall } from './background';
import {
  drawCrate,
  drawDigits,
  drawDisc,
  drawHpBar,
  drawMine,
  drawProjectile,
  drawShield,
  drawStun,
  drawTerrain,
  drawTombstone,
} from './field';
import { Painter } from './painter';
import { C, TEAMS } from './palette';
import { drawPlayer } from './player';
import type { SwingStyle } from './player';
import { paintRooftop } from './rooftop';
import { FLOOR_Y, PX_PER_M, VIEW_H, VIEW_W, sx, sy } from './view';

export interface SceneHost {
  readonly session: MatchSession | null;
  readonly assistMarker: boolean;
  readonly showIntent: boolean;
  /** Advances the app by real time and returns the sim events of this frame. */
  frame(deltaMs: number): SimEvent[];
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
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const SHUTTLE_COLORS: Record<string, number> = {
  frag: C.darkGreen,
  shock: C.cyan,
  lead: C.slate,
  cluster: C.orange,
  ghost: C.mauve,
};

export class MatchScene extends Phaser.Scene {
  private painter!: Painter;
  private backgrounds: Partial<Record<ArenaId, Phaser.GameObjects.Image>> = {};
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private trail: { x: number; y: number }[] = [];
  private swingStyle: [SwingStyle, SwingStyle] = ['overhead', 'overhead'];
  private hurt: [number, number] = [0, 0];
  private landingX: number | null = null;
  private trajectory: { x: number; y: number }[] = [];
  private lastSession: MatchSession | null = null;
  private time0 = 0;

  constructor(private readonly host: SceneHost) {
    super('match');
  }

  create(): void {
    const paint: Record<ArenaId, (ctx: CanvasRenderingContext2D) => void> = {
      hall: paintHall,
      rooftop: paintRooftop,
    };
    for (const id of Object.keys(paint) as ArenaId[]) {
      const tex = this.textures.createCanvas(`arena-${id}`, VIEW_W, VIEW_H);
      if (!tex) continue;
      paint[id](tex.getContext());
      tex.refresh();
      this.backgrounds[id] = this.add.image(0, 0, `arena-${id}`).setOrigin(0, 0).setVisible(false);
    }
    this.painter = new Painter(this.add.graphics());
  }

  override update(_time: number, delta: number): void {
    this.time0 += delta;
    const events = this.host.frame(delta);
    const session = this.host.session;
    if (session !== this.lastSession) {
      this.lastSession = session;
      this.particles = [];
      this.flashes = [];
      this.trail = [];
      this.landingX = null;
      this.trajectory = [];
      const arena = session?.state.config.arena ?? 'hall';
      for (const [id, img] of Object.entries(this.backgrounds)) img.setVisible(id === arena);
    }
    if (!session) {
      this.painter.clear();
      return;
    }
    for (const e of events) this.onEvent(session, e);
    this.draw(session, delta);
  }

  private onEvent(session: MatchSession, e: SimEvent): void {
    const s = session.state;
    switch (e.type) {
      case 'swing': {
        const p = s.players[e.player];
        this.swingStyle[e.player] =
          s.shuttle.y > p.y + SHOULDER_HEIGHT - 0.1 ? 'overhead' : 'underhand';
        if (s.phase === 'serve' || s.shuttle.mode === 'held')
          this.swingStyle[e.player] = 'underhand';
        break;
      }
      case 'hit': {
        const smash = e.shot === 'smash';
        this.burst(
          sx(e.x),
          sy(e.y),
          smash ? 14 : 6,
          smash ? C.paleYellow : C.white,
          smash ? 90 : 50,
        );
        if (smash) {
          this.cameras.main.shake(140, 0.006);
          session.hitStop(60);
        }
        this.refreshPrediction(session);
        break;
      }
      case 'net':
        this.burst(sx(0), sy(e.y), 5, C.lightGray, 30);
        this.refreshPrediction(session);
        break;
      case 'land':
        this.burst(sx(e.x), FLOOR_Y, 8, e.inBounds ? C.tan : C.lightGray, 40, true);
        this.landingX = null;
        this.trajectory = [];
        break;
      case 'bodyHit':
        this.hurt[e.player] = 250;
        this.burst(sx(e.x), sy(e.y), 10, C.pink, 60);
        this.cameras.main.shake(100, 0.004);
        break;
      case 'damage':
        if (e.amount > 0) this.hurt[e.player] = 300;
        break;
      case 'explosion':
        this.explosion(e.x, e.y, e.radius);
        break;
      case 'shocked': {
        const p = s.players[e.player];
        this.burst(sx(p.x), sy(p.y + 1.2), 14, C.cyan, 80);
        break;
      }
      case 'heal':
      case 'shieldUp': {
        const p = s.players[e.player];
        this.burst(sx(p.x), sy(p.y + 1), 12, e.type === 'heal' ? C.green : C.cyan, 40);
        break;
      }
      case 'crateCollect': {
        const p = s.players[e.player];
        this.burst(sx(p.x), sy(p.y + 0.5), 10, C.paleYellow, 50);
        break;
      }
      case 'ko': {
        const p = s.players[e.player];
        this.burst(sx(p.x), sy(p.y + 1), 30, C.lightGray, 70);
        this.cameras.main.shake(300, 0.012);
        session.hitStop(250);
        break;
      }
      case 'point':
        this.landingX = null;
        this.trajectory = [];
        break;
      case 'newRally':
        this.trail = [];
        break;
    }
  }

  private explosion(x: number, y: number, radius: number): void {
    const X = sx(x);
    const Y = sy(y);
    const r = radius * PX_PER_M;
    this.flashes.push({ x: X, y: Y, r: Math.round(r * 0.8), life: 0 });
    const fire = [C.paleYellow, C.yellow, C.orange, C.brightRed];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = r * (2 + Math.random() * 3);
      this.particles.push({
        x: X,
        y: Y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 30,
        life: 0,
        max: 300 + Math.random() * 300,
        color: fire[i % fire.length]!,
        gravity: 200,
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: X + (Math.random() - 0.5) * r,
        y: Y + (Math.random() - 0.5) * r * 0.5,
        vx: (Math.random() - 0.5) * 20,
        vy: -15 - Math.random() * 20,
        life: 0,
        max: 700 + Math.random() * 500,
        color: Math.random() < 0.5 ? C.slate : C.gray,
        gravity: -10,
        size: 2,
      });
    }
    if (y < 0.8) {
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: X,
          y: FLOOR_Y - 1,
          vx: (Math.random() - 0.5) * 120,
          vy: -60 - Math.random() * 90,
          life: 0,
          max: 600,
          color: Math.random() < 0.5 ? C.brown : C.darkBrown,
          gravity: 300,
          size: 1,
        });
      }
    }
    this.cameras.main.shake(120 + radius * 80, 0.004 + radius * 0.004);
  }

  private refreshPrediction(session: MatchSession): void {
    const t = predictShuttle(session.state, 360);
    this.trajectory = t.points.filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x, y: p.y }));
    this.landingX = t.end?.kind === 'floor' ? t.end.x : null;
  }

  private burst(
    x: number,
    y: number,
    n: number,
    color: number,
    speed: number,
    upward = false,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: upward ? -Math.abs(Math.sin(a) * v) : Math.sin(a) * v,
        life: 0,
        max: 250 + Math.random() * 250,
        color,
        gravity: 260,
        size: 1,
      });
    }
  }

  private draw(session: MatchSession, delta: number): void {
    const p = this.painter;
    const s = session.state;
    const a = session.paused ? 1 : session.alpha;
    p.clear();

    drawTerrain(p, s);
    for (const m of s.mines) drawMine(p, m, this.time0);
    for (const c of s.crates) drawCrate(p, c);

    // AI intent overlay (watch mode): predicted flight and where each bot wants to stand.
    if (this.host.showIntent && s.shuttle.mode === 'flight') {
      for (const pt of this.trajectory) p.px(sx(pt.x), sy(pt.y), C.lightGray, 0.5);
      for (const id of [0, 1] as PlayerId[]) {
        const c = session.controllers[id];
        if (c instanceof BotController && c.bot.lastPlan && !c.bot.lastPlan.leave) {
          const x = sx(c.bot.lastPlan.standX);
          p.rect(x - 3, FLOOR_Y - 1, 7, 1, TEAMS[id].shirt);
          p.rect(x, FLOOR_Y - 4, 1, 3, TEAMS[id].shirt);
        }
      }
    }

    // Landing marker assist.
    if (
      this.host.assistMarker &&
      this.landingX !== null &&
      s.shuttle.mode === 'flight' &&
      s.shuttle.ghostTicks <= 0
    ) {
      const blink = Math.floor(this.time0 / 120) % 2 === 0;
      const x = sx(this.landingX);
      p.rect(x - 3, FLOOR_Y - 1, 7, 1, blink ? C.paleYellow : C.orange);
      p.rect(x - 1, FLOOR_Y - 3, 3, 1, blink ? C.paleYellow : C.orange);
      p.px(x, FLOOR_Y - 5, blink ? C.paleYellow : C.orange);
    }

    // Players (or their tombstones).
    for (const id of [0, 1] as PlayerId[]) {
      const pl = s.players[id];
      const px = lerp(session.prev.p[id].x, pl.x, a);
      const py = lerp(session.prev.p[id].y, pl.y, a);
      if (this.hurt[id] > 0) this.hurt[id] -= delta;
      if (pl.dead) {
        drawTombstone(p, sx(px), sy(py));
        continue;
      }
      drawPlayer(
        p,
        {
          x: sx(px),
          y: sy(py),
          player: pl,
          swingStyle: pl.throwTicks > 0 ? 'overhead' : this.swingStyle[id],
          swing:
            pl.throwTicks > 0
              ? 1 - pl.throwTicks / WEAPON_TUNING.mine.throwTicks
              : pl.swingTick < 0
                ? -1
                : (pl.swingTick + a) / s.config.tuning.swing.totalTicks,
          runPhase: px * 4.2,
          hurtFlash: this.hurt[id] > 0 && Math.floor(this.hurt[id] / 50) % 2 === 0,
        },
        TEAMS[id],
      );
      if (pl.shield > 0) drawShield(p, sx(px), sy(py), this.time0);
      if (pl.stunTicks > 0) drawStun(p, sx(px), sy(py), this.time0);
      if (s.config.scheme !== 'purist') drawHpBar(p, pl, sx(px), sy(py));
    }

    this.drawRevengeAim(s);
    for (const proj of s.projectiles) {
      drawProjectile(p, proj);
      if ((proj.kind === 'rocket' || proj.kind === 'homing') && Math.random() < 0.6) {
        this.particles.push({
          x: sx(proj.x) - Math.sign(proj.vx) * 4,
          y: sy(proj.y),
          vx: (Math.random() - 0.5) * 8,
          vy: -6,
          life: 0,
          max: 400,
          color: Math.random() < 0.3 ? C.orange : C.gray,
          gravity: -5,
          size: 1,
        });
      }
    }

    this.drawShuttle(session, a);

    // Explosion flashes.
    this.flashes = this.flashes.filter((f) => (f.life += delta) < 110);
    for (const f of this.flashes)
      drawDisc(p, f.x, f.y, f.r, f.life < 50 ? C.white : C.paleYellow, 0.85);

    // Particles.
    const dt = delta / 1000;
    this.particles = this.particles.filter((q) => (q.life += delta) < q.max);
    for (const q of this.particles) {
      q.vy += q.gravity * dt;
      q.x += q.vx * dt;
      q.y = Math.min(q.y + q.vy * dt, VIEW_H - 1);
      p.rect(q.x, q.y, q.size, q.size, q.color, 1 - q.life / q.max);
    }
  }

  /** Cork leads in the direction of travel; the color tells which weapon it carries. */
  private drawShuttle(session: MatchSession, a: number): void {
    const p = this.painter;
    const s = session.state;
    const sh = s.shuttle;
    if (sh.mode === 'gone') return;
    const hx = lerp(session.prev.s.x, sh.x, sh.mode === 'held' ? 1 : a);
    const hy =
      sh.mode === 'held'
        ? SERVE_HAND_HEIGHT + s.players[s.server].y
        : lerp(session.prev.s.y, sh.y, a);
    const X = sx(hx);
    const Y = sy(hy);
    if (sh.ghostTicks > 0) {
      // Invisible: only a faint shadow on the floor gives it away.
      p.rect(X - 1, FLOOR_Y - 1, 3, 1, C.black, 0.5);
      this.trail.length = 0;
      return;
    }
    const speed = Math.hypot(sh.vx, sh.vy);
    if (sh.mode === 'flight' && speed > 10) {
      this.trail.push({ x: X, y: Y });
      if (this.trail.length > 7) this.trail.shift();
      this.trail.forEach((t, i) => p.px(t.x, t.y, C.white, ((i + 1) / this.trail.length) * 0.45));
    } else {
      this.trail.length = 0;
    }
    let dx = 0;
    let dy = 1;
    if (sh.mode === 'flight' || sh.mode === 'dead') {
      dx = sh.vx / (speed || 1);
      dy = -sh.vy / (speed || 1);
    }
    const feather = sh.weapon === 'lead' ? C.gray : C.white;
    p.px(X - dx * 2, Y - dy * 2, C.lightGray);
    p.px(X - dx * 3, Y - dy * 3, feather);
    p.px(X - dx * 3 + dy, Y - dy * 3 - dx, C.lightGray);
    p.px(X - dx * 3 - dy, Y - dy * 3 + dx, C.lightGray);
    p.px(X - dx, Y - dy, feather);
    p.rect(X, Y, 1, 1, feather);
    const cork = sh.weapon ? SHUTTLE_COLORS[sh.weapon]! : C.orange;
    p.rect(X + dx - 0.5, Y + dy - 0.5, 2, 2, cork);
    if (sh.weapon === 'frag') {
      const blink = sh.fuseTicks < 60 ? 80 : 250;
      if (Math.floor(this.time0 / blink) % 2 === 0) p.px(X + dx, Y + dy, C.brightRed);
      drawDigits(
        p,
        String(Math.max(1, Math.ceil(sh.fuseTicks / 60))),
        X,
        Y - 11,
        sh.fuseTicks < 60 ? C.brightRed : C.paleYellow,
      );
    } else if (sh.weapon === 'shock' && Math.random() < 0.3) {
      p.px(X + (Math.random() - 0.5) * 6, Y + (Math.random() - 0.5) * 6, C.cyan);
    }
  }

  /** Revenge Turn: a reticle along the aim angle (or the Air Strike cursor). */
  private drawRevengeAim(s: MatchState): void {
    const rv = s.revenge;
    if (!rv || rv.fired) return;
    const p = this.painter;
    const shooter = s.players[rv.shooter];
    const w = shooter.revengeWeapon;
    if (w === 'airstrike') {
      const x = sx(sideSign(rv.target) * rv.cursor);
      for (let y = sy(7); y < FLOOR_Y; y += 4) p.px(x, y, C.brightRed);
      p.rect(x - 3, sy(7) - 6, 7, 1, C.brightRed);
      p.rect(x - 2, sy(7) - 5, 5, 1, C.brightRed);
      p.px(x, sy(7) - 4, C.brightRed);
      return;
    }
    if (w !== 'rocket' && w !== 'mortar' && w !== 'homing') return;
    const sh = shoulderOf(shooter);
    const ang = degToRad(rv.angle);
    const dirX = shooter.facing * cos(ang);
    const dirY = sin(ang);
    const X = sx(sh.x);
    const Y = sy(sh.y);
    for (let i = 4; i <= 24; i += 4) p.px(X + dirX * i, Y - dirY * i, C.white, 0.6);
    const cx = X + dirX * 30;
    const cy = Y - dirY * 30;
    p.rect(cx - 3, cy, 2, 1, C.brightRed);
    p.rect(cx + 2, cy, 2, 1, C.brightRed);
    p.rect(cx, cy - 3, 1, 2, C.brightRed);
    p.rect(cx, cy + 2, 1, 2, C.brightRed);
    if (rv.charging) {
      const len = Math.round(rv.power * 24);
      for (let i = 0; i < len; i++)
        p.px(
          X + dirX * (4 + i),
          Y - dirY * (4 + i),
          i > 16 ? C.brightRed : i > 8 ? C.orange : C.yellow,
        );
    }
  }
}

export const VIEW = { width: VIEW_W, height: VIEW_H, pxPerM: PX_PER_M };
