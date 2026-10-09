import { Buttons, quantizeAxis } from '@deadminton/sim';
import type { InputFrame } from '@deadminton/sim';
import type { InputDevice } from './device';

export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export interface TouchOptions {
  /** Buttons on the left and the stick on the right. */
  leftHanded: boolean;
  size: 'small' | 'medium' | 'large';
  /** Called on every button press (a light haptic tick). */
  onPress?: () => void;
}

/**
 * On-screen controls: a floating virtual stick on one side, HIT, JUMP, FIRE, WPN and FUSE
 * buttons on the other. They cover the whole screen (not just the 16:9 game frame), so on
 * wide phones they sit in the side bars, and they keep clear of notches. Multi-touch, so
 * you can run and swing at the same time.
 */
export class TouchDevice implements InputDevice {
  readonly root: HTMLElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0 };
  private hitTaps = 0;
  private hitHeld = false;
  private jumpTaps = 0;
  private jumpHeld = false;
  private fireTaps = 0;
  private fireHeld = false;
  private weaponTaps = 0;
  private fuseTaps = 0;
  private readonly knob: HTMLElement;
  private readonly base: HTMLElement;
  private options: TouchOptions = { leftHanded: false, size: 'medium' };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="touch-stick-zone"><div class="touch-base"><div class="touch-knob"></div></div></div>
      <div class="touch-buttons">
        <button class="touch-btn touch-jump" aria-label="Jump"><span>JUMP</span></button>
        <button class="touch-btn touch-hit" aria-label="Swing"><span>HIT</span></button>
        <button class="touch-btn touch-fire" aria-label="Fire"><span>FIRE</span></button>
        <button class="touch-btn touch-weapon" aria-label="Next weapon"><span>WPN</span></button>
        <button class="touch-btn touch-fuse" aria-label="Fuse"><span>FUSE</span></button>
      </div>`;
    parent.appendChild(this.root);
    this.base = this.root.querySelector('.touch-base')!;
    this.knob = this.root.querySelector('.touch-knob')!;
    const zone = this.root.querySelector<HTMLElement>('.touch-stick-zone')!;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.removeProperty('bottom');
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
      this.updateStick(e);
    });
    zone.addEventListener(
      'pointermove',
      (e) => e.pointerId === this.stickId && this.updateStick(e),
    );
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.vec = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      // Back to its resting spot.
      this.base.style.left = '';
      this.base.style.top = '';
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    this.bindButton('.touch-hit', (down) => {
      this.hitHeld = down;
      if (down) this.hitTaps++;
    });
    this.bindButton('.touch-jump', (down) => {
      this.jumpHeld = down;
      if (down) this.jumpTaps++;
    });
    this.bindButton('.touch-fire', (down) => {
      this.fireHeld = down;
      if (down) this.fireTaps++;
    });
    this.bindButton('.touch-weapon', (down) => {
      if (down) this.weaponTaps++;
    });
    this.bindButton('.touch-fuse', (down) => {
      if (down) this.fuseTaps++;
    });
  }

  private bindButton(selector: string, set: (down: boolean) => void): void {
    const el = this.root.querySelector<HTMLElement>(selector)!;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      this.options.onPress?.();
      set(true);
    });
    const up = () => {
      el.classList.remove('pressed');
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  configure(options: TouchOptions): void {
    this.options = options;
    this.root.classList.toggle('lefty', options.leftHanded);
    this.root.dataset.size = options.size;
  }

  private updateStick(e: PointerEvent): void {
    // The stick travels about a tenth of the screen height.
    const max = Math.max(28, window.innerHeight * 0.1);
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.vec = { x: dx / max, y: -dy / max };
  }

  setVisible(v: boolean): void {
    if (this.root.hidden === !v) return;
    this.root.hidden = !v;
    if (!v) {
      // Drop anything held, so a finger lifted over a menu doesn't keep running.
      this.stickId = null;
      this.vec = { x: 0, y: 0 };
      this.hitHeld = this.jumpHeld = this.fireHeld = false;
      this.knob.style.transform = '';
      this.base.classList.remove('active');
    }
  }

  sample(): InputFrame {
    const dz = (v: number) => (Math.abs(v) < 0.3 ? 0 : v);
    let buttons = 0;
    if (this.hitTaps > 0 || this.hitHeld) buttons |= Buttons.HIT;
    if (this.jumpTaps > 0 || this.jumpHeld) buttons |= Buttons.JUMP;
    if (this.fireTaps > 0 || this.fireHeld) buttons |= Buttons.FIRE;
    if (this.weaponTaps > 0) buttons |= Buttons.WEAPON_NEXT;
    if (this.fuseTaps > 0) buttons |= Buttons.FUSE;
    this.hitTaps = 0;
    this.jumpTaps = 0;
    this.fireTaps = 0;
    this.weaponTaps = 0;
    this.fuseTaps = 0;
    return { moveX: quantizeAxis(dz(this.vec.x)), moveY: quantizeAxis(dz(this.vec.y)), buttons };
  }
}
