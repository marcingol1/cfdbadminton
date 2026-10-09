import Phaser from 'phaser';
import { SERVE_HAND_HEIGHT, SHOULDER_HEIGHT, predictShuttle } from '@deadminton/sim';
import type { PlayerId, SimEvent } from '@deadminton/sim';
import { BotController } from '../game/controllers';
import type { MatchSession } from '../game/session';
import { paintHall } from './background';
import { Painter } from './painter';
import { C, TEAMS } from './palette';
import { drawPlayer } from './player';
import type { SwingStyle } from './player';
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
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class MatchScene extends Phaser.Scene {
  private painter!: Painter;
  private particles: Particle[] = [];
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
    const tex = this.textures.createCanvas('hall', VIEW_W, VIEW_H);
    if (tex) {
      paintHall(tex.getContext());
      tex.refresh();
      this.add.image(0, 0, 'hall').setOrigin(0, 0);
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
      this.trail = [];
      this.landingX = null;
      this.trajectory = [];
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
        this.burst(sx(e.x), FLOOR_Y, 8, e.inBounds ? C.tan : C.lightGray, 40, -1);
        this.landingX = null;
        this.trajectory = [];
        break;
      case 'bodyHit':
        this.hurt[e.player] = 250;
        this.burst(sx(e.x), sy(e.y), 10, C.pink, 60);
        this.cameras.main.shake(100, 0.004);
        break;
      case 'point':
        this.landingX = null;
        this.trajectory = [];
        break;
      case 'newRally':
        this.trail = [];
        break;
    }
  }

  private refreshPrediction(session: MatchSession): void {
    const t = predictShuttle(session.state, 360);
    this.trajectory = t.points.filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x, y: p.y }));
    this.landingX = t.end?.kind === 'floor' ? t.end.x : null;
  }

  private burst(x: number, y: number, n: number, color: number, speed: number, upward = 0): void {
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
      });
    }
  }

  private draw(session: MatchSession, delta: number): void {
    const p = this.painter;
    const s = session.state;
    const a = session.paused ? 1 : session.alpha;
    p.clear();

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
    if (this.host.assistMarker && this.landingX !== null && s.shuttle.mode === 'flight') {
      const blink = Math.floor(this.time0 / 120) % 2 === 0;
      const x = sx(this.landingX);
      p.rect(x - 3, FLOOR_Y - 1, 7, 1, blink ? C.paleYellow : C.orange);
      p.rect(x - 1, FLOOR_Y - 3, 3, 1, blink ? C.paleYellow : C.orange);
      p.px(x, FLOOR_Y - 5, blink ? C.paleYellow : C.orange);
    }

    // Players.
    for (const id of [0, 1] as PlayerId[]) {
      const pl = s.players[id];
      const px = lerp(session.prev.p[id].x, pl.x, a);
      const py = lerp(session.prev.p[id].y, pl.y, a);
      if (this.hurt[id] > 0) this.hurt[id] -= delta;
      drawPlayer(
        p,
        {
          x: sx(px),
          y: sy(py),
          player: pl,
          swingStyle: this.swingStyle[id],
          swing: pl.swingTick < 0 ? -1 : (pl.swingTick + a) / s.config.tuning.swing.totalTicks,
          runPhase: px * 4.2,
          hurtFlash: this.hurt[id] > 0 && Math.floor(this.hurt[id] / 50) % 2 === 0,
        },
        TEAMS[id],
      );
    }

    // Shuttle with motion trail. Cork leads in the direction of travel.
    const sh = s.shuttle;
    const hx = lerp(session.prev.s.x, sh.x, sh.mode === 'held' ? 1 : a);
    const hy =
      sh.mode === 'held'
        ? SERVE_HAND_HEIGHT + s.players[s.server].y
        : lerp(session.prev.s.y, sh.y, a);
    const X = sx(hx);
    const Y = sy(hy);
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
    } else if (sh.mode === 'grounded') {
      dx = 0;
      dy = 1;
    }
    p.px(X - dx * 2, Y - dy * 2, C.lightGray);
    p.px(X - dx * 3, Y - dy * 3, C.white);
    p.px(X - dx * 3 + dy, Y - dy * 3 - dx, C.lightGray);
    p.px(X - dx * 3 - dy, Y - dy * 3 + dx, C.lightGray);
    p.px(X - dx, Y - dy, C.white);
    p.rect(X, Y, 1, 1, C.white);
    p.px(X + dx, Y + dy, C.orange);

    // Particles.
    const dt = delta / 1000;
    this.particles = this.particles.filter((q) => (q.life += delta) < q.max);
    for (const q of this.particles) {
      q.vy += q.gravity * dt;
      q.x += q.vx * dt;
      q.y = Math.min(q.y + q.vy * dt, FLOOR_Y - 1);
      p.px(q.x, q.y, q.color, 1 - q.life / q.max);
    }
  }
}

export const VIEW = { width: VIEW_W, height: VIEW_H, pxPerM: PX_PER_M };
