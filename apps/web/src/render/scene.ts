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
import { PlayerAnim } from './anim';
import { paintHall } from './background';
import { Crowd } from './crowd';
import {
  drawCrate,
  drawDigits,
  drawHpBar,
  drawMine,
  drawProjectile,
  drawShield,
  drawStun,
  drawTerrain,
  drawTombstone,
} from './field';
import { Effects } from './fx';
import type { FxSettings } from './fx';
import { Painter } from './painter';
import { C, TEAMS } from './palette';
import { drawPlayer, drawRagdoll } from './player';
import type { Mood, SwingStyle } from './player';
import { paintRooftop } from './rooftop';
import { FLOOR_Y, PX_PER_M, VIEW_H, VIEW_W, sx, sy } from './view';

export interface SceneHost {
  readonly session: MatchSession | null;
  readonly assistMarker: boolean;
  readonly showIntent: boolean;
  readonly fx: FxSettings;
  /** Advances the app by real time and returns the sim events of this frame. */
  frame(deltaMs: number): SimEvent[];
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
  private readonly fx: Effects;
  private readonly crowd = new Crowd();
  private readonly poses: [PlayerAnim, PlayerAnim] = [new PlayerAnim(), new PlayerAnim()];
  private trail: { x: number; y: number }[] = [];
  private swingStyle: [SwingStyle, SwingStyle] = ['overhead', 'overhead'];
  private landingX: number | null = null;
  private trajectory: { x: number; y: number }[] = [];
  private lastSession: MatchSession | null = null;
  /** Whose celebration is showing, and for how long (Infinity once the match is over). */
  private moodWinner: PlayerId = 0;
  private moodMs = 0;
  /** A smash leaves a hot trail for a moment. */
  private smashMs = 0;
  private cheerMs = 0;
  private time0 = 0;

  constructor(private readonly host: SceneHost) {
    super('match');
    this.fx = new Effects(() => host.fx);
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
      this.fx.clear();
      for (const a of this.poses) a.reset();
      this.trail = [];
      this.landingX = null;
      this.trajectory = [];
      this.moodMs = 0;
      this.smashMs = 0;
      const arena = session?.state.config.arena ?? 'hall';
      for (const [id, img] of Object.entries(this.backgrounds)) img.setVisible(id === arena);
    }
    if (!session) {
      this.painter.clear();
      return;
    }
    for (const e of events) this.onEvent(session, e);
    this.draw(session, delta * session.timeScale);
  }

  private shake(ms: number, intensity: number): void {
    const k = this.host.fx.shake;
    if (k > 0) this.cameras.main.shake(ms, intensity * k);
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
        const X = sx(e.x);
        const Y = sy(e.y);
        const perfect = e.quality >= 0.95;
        this.fx.burst(X, Y, smash ? 14 : 6, smash ? C.paleYellow : C.white, smash ? 90 : 50);
        if (e.quality >= 0.8)
          this.fx.ring(X, Y, perfect ? 11 : 7, 150, perfect ? C.paleYellow : C.white);
        if (smash) {
          this.shake(e.jump ? 200 : 140, e.jump ? 0.009 : 0.006);
          session.hitStop(perfect || e.jump ? 90 : 60);
          if (e.jump) this.fx.ring(X, Y, 14, 220, C.orange);
          this.smashMs = 450;
          this.crowd.cheer(e.player, 0.45);
        } else if (perfect) {
          session.hitStop(35);
        }
        this.refreshPrediction(session);
        break;
      }
      case 'net':
        this.fx.burst(sx(0), sy(e.y), 5, C.lightGray, 30);
        this.refreshPrediction(session);
        break;
      case 'land':
        this.fx.burst(sx(e.x), FLOOR_Y, 8, e.inBounds ? C.tan : C.lightGray, 40, { upward: true });
        this.fx.dust(sx(e.x), FLOOR_Y, 4, 0, 0.8);
        this.landingX = null;
        this.trajectory = [];
        this.smashMs = 0;
        break;
      case 'bodyHit':
        this.poses[e.player].hurt();
        this.fx.burst(sx(e.x), sy(e.y), 10, C.pink, 60);
        this.shake(100, 0.004);
        break;
      case 'damage':
        if (e.amount > 0) this.poses[e.player].hurt();
        break;
      case 'explosion': {
        this.fx.explosion(sx(e.x), sy(e.y), e.radius * PX_PER_M, e.y < 0.8);
        this.shake(120 + e.radius * 80, 0.004 + e.radius * 0.004);
        this.crowd.cheer(null, 0.5);
        break;
      }
      case 'shocked': {
        const p = s.players[e.player];
        this.fx.burst(sx(p.x), sy(p.y + 1.2), 14, C.cyan, 80);
        this.fx.ring(sx(p.x), sy(p.y + 1.2), 14, 200, C.cyan);
        break;
      }
      case 'heal':
      case 'shieldUp': {
        const p = s.players[e.player];
        const color = e.type === 'heal' ? C.green : C.cyan;
        this.fx.burst(sx(p.x), sy(p.y + 1), 12, color, 40, { gravity: -40 });
        this.fx.ring(sx(p.x), sy(p.y + 1), 16, 300, color);
        break;
      }
      case 'crateCollect': {
        const p = s.players[e.player];
        this.fx.burst(sx(p.x), sy(p.y + 0.5), 10, C.paleYellow, 50);
        break;
      }
      case 'mineTriggered':
        this.fx.ring(sx(e.x), FLOOR_Y - 2, 10, 250, C.brightRed);
        break;
      case 'revengeFire': {
        if (!e.weapon) break;
        const sh = shoulderOf(s.players[e.player]);
        this.fx.burst(sx(sh.x), sy(sh.y), 8, C.orange, 60);
        this.fx.smoke(sx(sh.x), sy(sh.y), 2, 7, 600);
        this.shake(80, 0.003);
        break;
      }
      case 'ko': {
        const p = s.players[e.player];
        this.poses[e.player].knockOut(p, sx(p.x), sy(p.y));
        this.fx.burst(sx(p.x), sy(p.y + 1), 30, C.lightGray, 70);
        this.fx.ring(sx(p.x), sy(p.y + 1), 30, 400, C.white);
        this.fx.screenFlash = 160;
        this.shake(400, 0.014);
        session.hitStop(120);
        session.slowMo(1300, 0.3);
        this.crowd.cheer((1 - e.player) as PlayerId, 1);
        break;
      }
      case 'point':
        this.landingX = null;
        this.trajectory = [];
        this.moodWinner = e.winner;
        this.moodMs = 1300;
        this.crowd.cheer(e.winner, 0.9);
        break;
      case 'matchOver':
        this.moodWinner = e.winner;
        this.moodMs = Infinity;
        this.crowd.cheer(e.winner, 1);
        break;
      case 'newRally':
        this.trail = [];
        this.moodMs = 0;
        break;
    }
  }

  private refreshPrediction(session: MatchSession): void {
    const t = predictShuttle(session.state, 360);
    this.trajectory = t.points.filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x, y: p.y }));
    this.landingX = t.end?.kind === 'floor' ? t.end.x : null;
  }

  private mood(id: PlayerId): Mood {
    if (this.moodMs <= 0) return null;
    return id === this.moodWinner ? 'win' : 'lose';
  }

  /** dt: effect time this frame (0 while frozen or paused, shorter in slow motion). */
  private draw(session: MatchSession, dt: number): void {
    const p = this.painter;
    const s = session.state;
    const a = session.paused ? 1 : session.alpha;
    p.clear();
    this.fx.update(dt);
    this.moodMs -= dt;
    this.smashMs -= dt;
    if (this.moodMs === Infinity && (this.cheerMs -= dt) <= 0) {
      this.cheerMs = 1600;
      this.crowd.cheer(this.moodWinner, 1);
    }

    if (s.config.arena === 'hall' && !this.host.fx.low) this.crowd.draw(p, dt, this.time0);
    drawTerrain(p, s);
    this.fx.drawBack(p);
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

    for (const id of [0, 1] as PlayerId[]) this.drawOne(session, id, a, dt);

    this.drawRevengeAim(s);
    for (const proj of s.projectiles) {
      drawProjectile(p, proj);
      if ((proj.kind === 'rocket' || proj.kind === 'homing') && dt > 0 && Math.random() < 0.5)
        this.fx.smoke(sx(proj.x) - Math.sign(proj.vx) * 4, sy(proj.y), 1, 3, 450);
    }

    this.drawShuttle(session, a, dt);
    this.fx.drawFront(p);
    this.fx.drawScreen(p, VIEW_W, VIEW_H);
  }

  /** One player: alive (with smear and celebrations), tumbling, or under a tombstone. */
  private drawOne(session: MatchSession, id: PlayerId, a: number, dt: number): void {
    const p = this.painter;
    const s = session.state;
    const pl = s.players[id];
    const anim = this.poses[id];
    const px = lerp(session.prev.p[id].x, pl.x, a);
    const py = lerp(session.prev.p[id].y, pl.y, a);
    const X = sx(px);
    const Y = sy(py);
    const runPhase = px * 4.2;

    if (pl.dead) {
      if (!anim.ragdoll) {
        drawTombstone(p, X, Y);
        return;
      }
      if (anim.stepRagdoll(dt, Y - 5, this.fx)) this.shake(60, 0.002);
      const rd = anim.ragdoll;
      const dropT = anim.tombMs < 0 ? -1 : Math.min(1, anim.tombMs / 180);
      if (dropT < 1) drawRagdoll(p, rd, TEAMS[id]);
      if (dropT >= 0) {
        if (dropT >= 1 && anim.tombMs - dt < 180) {
          this.fx.dust(rd.x, Y, 10, 0, 1.5);
          this.shake(120, 0.005);
        }
        drawTombstone(p, Math.round(rd.x), Y - Math.round((1 - dropT) * 60));
      }
      return;
    }

    anim.update(pl, X, Y, runPhase, dt, this.fx);
    const swinging = pl.swingTick >= 0 || pl.throwTicks > 0;
    const mood = swinging ? null : this.mood(id);
    // Match winners bounce on the spot.
    const hop =
      mood === 'win' && this.moodMs === Infinity && pl.grounded
        ? Math.round(Math.abs(Math.sin(this.time0 / 160)) * 4)
        : 0;
    const swing =
      pl.throwTicks > 0
        ? 1 - pl.throwTicks / WEAPON_TUNING.mine.throwTicks
        : pl.swingTick < 0
          ? -1
          : (pl.swingTick + a) / s.config.tuning.swing.totalTicks;

    // Racket smear: fading arc through the last few racket-head positions.
    const sm = anim.smear;
    for (let i = 1; i < sm.length; i++) {
      const alpha = (i / sm.length) * 0.55;
      p.line(sm[i - 1]!.x, sm[i - 1]!.y, sm[i]!.x, sm[i]!.y, C.white, 2, alpha);
    }

    const head = drawPlayer(
      p,
      {
        x: X,
        y: Y - hop,
        player: pl,
        swingStyle: pl.throwTicks > 0 ? 'overhead' : this.swingStyle[id],
        swing,
        runPhase,
        hurtFlash: anim.hurtMs > 0 && Math.floor(anim.hurtMs / 50) % 2 === 0,
        squash: hop > 0 ? 0 : anim.squash,
        lean: anim.lean,
        bob: anim.bob(pl, swinging, this.time0),
        flinch: anim.flinch,
        // Ready stance while the shuttle is coming this way (or waiting for a serve).
        ready:
          (s.phase === 'rally' && s.shuttle.mode === 'flight' && s.rally.lastHitter !== id) ||
          (s.phase === 'serve' && s.server !== id),
        mood,
        time: this.time0,
      },
      TEAMS[id],
    );
    if (swing >= 0.05 && swing <= 0.7 && pl.throwTicks <= 0) {
      if (dt > 0 || sm.length === 0) sm.push(head);
      if (sm.length > 5) sm.shift();
    } else if (sm.length) {
      sm.shift();
    }
    if (pl.shield > 0) drawShield(p, X, Y, this.time0);
    if (pl.stunTicks > 0) drawStun(p, X, Y, this.time0);
    if (s.config.scheme !== 'purist') drawHpBar(p, pl, X, Y);
  }

  /** Cork leads in the direction of travel; the color tells which weapon it carries. */
  private drawShuttle(session: MatchSession, a: number, dt: number): void {
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
    // Floor shadow: shows where the shuttle is over the court, smaller and fainter when high.
    if (sh.mode === 'flight' || sh.mode === 'dead') {
      const h = Math.max(0, hy);
      const w = Math.max(1, 5 - Math.round(h / 2));
      p.rect(
        X - Math.floor(w / 2),
        FLOOR_Y - 1,
        w,
        1,
        C.black,
        0.15 + 0.35 * Math.max(0, 1 - h / 9),
      );
    }
    if (sh.ghostTicks > 0) {
      // Invisible: only the shadow gives it away.
      this.trail.length = 0;
      return;
    }
    // Above the top of the screen (Rooftop lifts): an arrow at the edge, with the height.
    if (Y < 3) {
      const ax = Math.max(4, Math.min(VIEW_W - 5, X));
      p.px(ax, 1, C.paleYellow);
      p.rect(ax - 1, 2, 3, 1, C.paleYellow);
      p.rect(ax - 2, 3, 5, 1, C.paleYellow);
      drawDigits(p, String(Math.round(hy)), ax, 6, C.paleYellow);
      this.trail.length = 0;
      return;
    }
    const speed = Math.hypot(sh.vx, sh.vy);
    const hot = this.smashMs > 0 && sh.mode === 'flight';
    if (sh.mode === 'flight' && speed > 10) {
      if (dt > 0 || this.trail.length === 0) this.trail.push({ x: X, y: Y });
      const max = hot ? 11 : 7;
      while (this.trail.length > max) this.trail.shift();
      const color = hot ? C.paleYellow : C.white;
      this.trail.forEach((t, i) => {
        const alpha = ((i + 1) / this.trail.length) * (hot ? 0.8 : 0.45);
        p.px(t.x, t.y, color, alpha);
        if (hot) p.px(t.x, t.y + 1, C.orange, alpha * 0.6);
      });
    } else {
      this.trail.length = 0;
    }
    if (hot && dt > 0 && speed > 20 && Math.random() < 0.5) {
      // Speed lines behind a smash.
      const ux = sh.vx / speed;
      const uy = -sh.vy / speed;
      const off = (Math.random() - 0.5) * 6;
      this.fx.streak(
        X - ux * 6 - uy * off,
        Y - uy * 6 + ux * off,
        X - ux * 16 - uy * off,
        Y - uy * 16 + ux * off,
        C.paleYellow,
      );
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
