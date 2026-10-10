import type { PlayerState } from '@deadminton/sim';
import {
  BANDS,
  DEFAULT_LOOKS,
  EXTRAS,
  HAIR,
  HAIR_STYLES,
  KITS,
  RACKETS,
  SHORTS,
  SKIN_TONES,
  cleanName,
  randomLook,
  teamColors,
} from '../render/looks';
import type { Look } from '../render/looks';
import { CanvasPainter } from '../render/painter';
import { css } from '../render/palette';
import { drawPlayer } from '../render/player';
import type { Mood, SwingStyle } from '../render/player';
import type { UiSettings } from './ui';

type Field = Exclude<keyof Look, 'name'>;

const swatch = (field: Field, i: number, color: number, on: boolean, label: string) =>
  `<button class="swatch${on ? ' on' : ''}" data-lopt="${field}" data-value="${i}" style="background:${css(color)}" aria-label="${label}" title="${label}"></button>`;

const chip = (field: Field, value: string, label: string, on: boolean) =>
  `<button class="chip${on ? ' on' : ''}" data-lopt="${field}" data-value="${value}">${label}</button>`;

const row = (label: string, body: string) =>
  `<span class="label">${label}</span><div class="chips swatches">${body}</div>`;

/** The player's looks: colors, hair, accessories and name, with an animated preview. */
export class LockerPanel {
  private who: 0 | 1 = 0;
  private container: HTMLElement | null = null;
  private frame = 0;

  constructor(
    private readonly settings: UiSettings,
    private readonly changed: () => void,
    private readonly back: () => void,
  ) {}

  private get look(): Look {
    return this.settings.looks[this.who];
  }

  render(container: HTMLElement): void {
    this.container = container;
    const l = this.look;
    const sw = (field: Field, colors: readonly number[], names?: readonly string[]) =>
      colors
        .map((c, i) =>
          c < 0
            ? `<button class="swatch none${l[field] === i ? ' on' : ''}" data-lopt="${field}" data-value="${i}" aria-label="none" title="none">✕</button>`
            : swatch(field, i, c, l[field] === i, names?.[i] ?? `${field} ${i + 1}`),
        )
        .join('');
    container.innerHTML = `<div class="locker">
      <h2>LOCKER</h2>
      <div class="chips tabs">
        <button class="chip${this.who === 0 ? ' on' : ''}" data-lopt="who" data-value="0">PLAYER 1</button>
        <button class="chip${this.who === 1 ? ' on' : ''}" data-lopt="who" data-value="1">PLAYER 2 · LOCAL</button>
      </div>
      <div class="locker-body">
        <div class="preview">
          <canvas width="64" height="64"></canvas>
          <input class="name" maxlength="10" spellcheck="false" autocomplete="off" value="${l.name}" aria-label="Name">
          <div class="chips"><button class="chip" data-lopt="random" data-value="">RANDOM</button><button class="chip" data-lopt="reset" data-value="">RESET</button></div>
        </div>
        <div class="settings-grid two locker-grid">
          ${row(
            'SKIN',
            sw(
              'skin',
              SKIN_TONES.map(([c]) => c),
            ),
          )}
          ${row('HAIR', HAIR_STYLES.map((h) => chip('hairStyle', h, h.toUpperCase(), l.hairStyle === h)).join(''))}
          ${row('HAIR COLOR', sw('hair', HAIR))}
          ${row(
            'SHIRT',
            sw(
              'kit',
              KITS.map((k) => k.shirt),
              KITS.map((k) => k.name),
            ),
          )}
          ${row('SHORTS', sw('shorts', SHORTS))}
          ${row('HEADBAND', sw('band', BANDS))}
          ${row('RACKET', sw('racket', RACKETS))}
          ${row('EXTRA', EXTRAS.map((e) => chip('extra', e, e.toUpperCase(), l.extra === e)).join(''))}
        </div>
      </div>
      <p class="small-note">Looks are cosmetic. If both players pick the same color, the second one switches kit.</p>
      <button class="big" data-lopt="back" data-value="">BACK</button>
    </div>`;
    const root = container.querySelector<HTMLElement>('.locker')!;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-lopt]');
      if (el) this.apply(el.dataset.lopt!, el.dataset.value!);
    });
    const input = root.querySelector<HTMLInputElement>('input.name')!;
    input.addEventListener('change', () => {
      this.look.name = cleanName(input.value, DEFAULT_LOOKS[this.who].name);
      input.value = this.look.name;
      this.changed();
    });
    this.animate(root.querySelector('canvas')!);
  }

  /** Stops the preview animation (leaving the screen). */
  close(): void {
    cancelAnimationFrame(this.frame);
    this.container = null;
  }

  private apply(name: string, value: string): void {
    const looks = this.settings.looks;
    switch (name) {
      case 'back':
        this.close();
        return this.back();
      case 'who':
        this.who = value === '1' ? 1 : 0;
        break;
      case 'random':
        looks[this.who] = randomLook(this.look.name);
        break;
      case 'reset':
        looks[this.who] = { ...DEFAULT_LOOKS[this.who], name: this.look.name };
        break;
      case 'hairStyle':
        this.look.hairStyle = value as Look['hairStyle'];
        break;
      case 'extra':
        this.look.extra = value as Look['extra'];
        break;
      default:
        (this.look as unknown as Record<string, number>)[name] = Number(value);
    }
    this.changed();
    if (this.container) {
      cancelAnimationFrame(this.frame);
      this.render(this.container);
    }
  }

  /** Loops the player through idle, run, swings, a jump and a celebration. */
  private animate(canvas: HTMLCanvasElement): void {
    const painter = new CanvasPainter(canvas.getContext('2d')!);
    const start = performance.now();
    const tick = (now: number) => {
      if (!canvas.isConnected) return;
      const ms = now - start;
      const t = (ms / 1000) % 6;
      let swing = -1;
      let style: SwingStyle = 'overhead';
      let mood: Mood = null;
      let vx = 0;
      let vy = 0;
      let grounded = true;
      let lift = 0;
      if (t >= 1.2 && t < 2.8) vx = 5;
      else if (t >= 2.8 && t < 3.3) swing = (t - 2.8) / 0.27;
      else if (t >= 3.5 && t < 4.0) {
        swing = (t - 3.5) / 0.27;
        style = 'underhand';
      } else if (t >= 4.1 && t < 4.9) {
        const j = (t - 4.1) / 0.8;
        grounded = false;
        vy = 1 - 2 * j;
        lift = Math.round(Math.sin(j * Math.PI) * 12);
      } else if (t >= 4.9) mood = 'win';
      if (swing > 1) swing = -1;
      const player = { facing: 1, grounded, vx, vy, stunTicks: 0 } as unknown as PlayerState;
      painter.clear();
      painter.rect(14, 61, 36, 1, 0x3a4466);
      drawPlayer(
        painter,
        {
          x: 26,
          y: 60 - lift,
          player,
          swingStyle: style,
          swing,
          runPhase: ms / 50,
          hurtFlash: false,
          squash: 0,
          lean: vx > 0 ? 1 : 0,
          bob: Math.floor(ms / 520) % 2,
          flinch: 0,
          ready: t < 1.2,
          mood,
          time: ms,
        },
        teamColors(this.look, this.settings.colors === 'colorblind'),
      );
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
