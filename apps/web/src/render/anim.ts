import type { PlayerState } from '@deadminton/sim';
import type { Effects } from './fx';
import type { Ragdoll } from './player';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Render-only animation state for one player: squash and stretch, lean, footstep dust,
 * hurt flinches, the racket smear and the KO ragdoll. Fed once per frame.
 */
export class PlayerAnim {
  squash = 0;
  lean = 0;
  flinch = 0;
  hurtMs = 0;
  /** Racket head positions during the active part of a swing. */
  smear: { x: number; y: number }[] = [];
  ragdoll: Ragdoll | null = null;
  /** Time since the ragdoll came to rest. */
  restMs = 0;
  /** Time since the tombstone started dropping (-1 = not yet). */
  tombMs = -1;
  private wasGrounded = true;
  private lastVx = 0;
  private lastVy = 0;
  private stepSign = 0;

  reset(): void {
    this.squash = 0;
    this.lean = 0;
    this.flinch = 0;
    this.hurtMs = 0;
    this.smear = [];
    this.ragdoll = null;
    this.restMs = 0;
    this.tombMs = -1;
    this.wasGrounded = true;
    this.lastVx = 0;
    this.lastVy = 0;
  }

  hurt(): void {
    this.hurtMs = 300;
    this.flinch = 3;
  }

  /** X, Y: feet in screen pixels. */
  update(pl: PlayerState, X: number, Y: number, runPhase: number, dtMs: number, fx: Effects): void {
    // Frozen (hit-stop, pause): nothing moves, so nothing new should happen.
    if (dtMs <= 0) return;
    const dt = dtMs / 1000;
    if (pl.grounded && !this.wasGrounded) {
      const impact = clamp(-this.lastVy / 7, 0, 1);
      this.squash = 0.35 + impact * 0.65;
      fx.dust(X, Y, 3 + Math.round(impact * 6), 0, 0.6 + impact);
    } else if (!pl.grounded && this.wasGrounded && pl.vy > 1) {
      this.squash = -0.7;
      fx.dust(X, Y, 4, 0, 0.8);
    }
    if (pl.grounded) {
      // Footfalls and sharp turns kick up a little dust.
      if (Math.abs(pl.vx) > 2.5) {
        const s = Math.sign(Math.sin(runPhase));
        if (s !== this.stepSign && Math.random() < 0.6) fx.dust(X, Y, 1, -Math.sign(pl.vx), 0.6);
        this.stepSign = s;
      }
      if (Math.abs(this.lastVx) > 2.5 && Math.sign(pl.vx) !== Math.sign(this.lastVx))
        fx.dust(X, Y, 5, Math.sign(this.lastVx), 1);
    }
    const step = dt * 5;
    this.squash = Math.abs(this.squash) <= step ? 0 : this.squash - Math.sign(this.squash) * step;
    const target = pl.grounded ? clamp(pl.vx * pl.facing * 0.45, -2, 2) : 0;
    this.lean += (target - this.lean) * Math.min(1, dt * 15);
    this.flinch = Math.max(0, this.flinch - dt * 20);
    this.hurtMs = Math.max(0, this.hurtMs - dtMs);
    this.wasGrounded = pl.grounded;
    this.lastVx = pl.vx;
    this.lastVy = pl.vy;
  }

  /** Idle breathing: 1 px down every other half second. */
  bob(pl: PlayerState, swinging: boolean, timeMs: number): number {
    if (!pl.grounded || swinging || Math.abs(pl.vx) > 0.3) return 0;
    return Math.floor((timeMs + pl.id * 330) / 520) % 2;
  }

  /** Starts the KO tumble from the player's last position and velocity. */
  knockOut(pl: PlayerState, X: number, Y: number): void {
    const away = pl.vx !== 0 ? Math.sign(pl.vx) : -pl.facing;
    this.ragdoll = {
      x: X,
      y: Y - 20,
      vx: pl.vx * 24 + away * 50,
      vy: -pl.vy * 24 - 140,
      rot: 0,
      spin: away * (6 + Math.random() * 4),
      t: 0,
      settled: false,
      facing: pl.facing,
    };
    this.restMs = 0;
    this.tombMs = -1;
  }

  /** Ragdoll physics; ground is where the body rests (screen y). Returns true on a bounce. */
  stepRagdoll(dtMs: number, ground: number, fx: Effects): boolean {
    const rd = this.ragdoll;
    if (!rd) return false;
    const dt = dtMs / 1000;
    rd.t += dt;
    if (rd.settled) {
      this.restMs += dtMs;
      const lying = rd.rot >= 0 ? Math.PI / 2 : -Math.PI / 2;
      rd.rot += (lying - rd.rot) * Math.min(1, dt * 12);
      rd.y += (ground - rd.y) * Math.min(1, dt * 12);
      if (this.restMs > 450 && this.tombMs < 0) this.tombMs = 0;
      if (this.tombMs >= 0) this.tombMs += dtMs;
      return false;
    }
    rd.vy += 700 * dt;
    rd.x += rd.vx * dt;
    rd.y += rd.vy * dt;
    rd.rot += rd.spin * dt;
    if (rd.y >= ground) {
      rd.y = ground;
      if (rd.vy > 70) {
        fx.dust(rd.x, ground + 5, 6, 0, 1.2);
        rd.vy *= -0.35;
        rd.vx *= 0.55;
        rd.spin *= 0.5;
        return true;
      }
      rd.settled = true;
      rd.vx = 0;
      rd.vy = 0;
      // Fold the rotation into -π..π so it lies down the short way.
      rd.rot = Math.atan2(Math.sin(rd.rot), Math.cos(rd.rot));
    }
    return false;
  }
}
