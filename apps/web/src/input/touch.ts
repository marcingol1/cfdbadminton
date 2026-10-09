import { Buttons, quantizeAxis } from '@deadminton/sim';
import type { InputFrame } from '@deadminton/sim';
import type { InputDevice } from './device';

export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/**
 * On-screen controls: a floating virtual stick on the left half, HIT and JUMP buttons on the
 * right. Multi-touch, so you can run and swing at the same time.
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

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="touch-stick-zone"><div class="touch-base"><div class="touch-knob"></div></div></div>
      <button class="touch-btn touch-jump" aria-label="Jump">JUMP</button>
      <button class="touch-btn touch-hit" aria-label="Swing">HIT</button>
      <button class="touch-btn touch-fire" aria-label="Fire">FIRE</button>
      <button class="touch-btn touch-weapon" aria-label="Next weapon">WPN</button>
      <button class="touch-btn touch-fuse" aria-label="Fuse">FUSE</button>`;
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
      navigator.vibrate?.(8);
      set(true);
    });
    const up = () => {
      el.classList.remove('pressed');
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private updateStick(e: PointerEvent): void {
    const max = 40;
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
    this.root.style.display = v ? '' : 'none';
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
