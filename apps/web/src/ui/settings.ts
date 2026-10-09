import { KEY_ACTIONS, keyLabel, rebind, resolveKeys } from '../input/keyboard';
import type { BindingSet, KeyAction } from '../input/keyboard';
import type { UiSettings } from './ui';

export type SettingsTab = 'general' | 'access' | 'controls';

const TABS: [SettingsTab, string][] = [
  ['general', 'SOUND & VIDEO'],
  ['access', 'ACCESSIBILITY'],
  ['controls', 'CONTROLS'],
];

const SETS: [BindingSet, string][] = [
  ['solo', 'SOLO'],
  ['p1', '2P LEFT'],
  ['p2', '2P RIGHT'],
];

const opt = (name: string, value: string, label: string, on: boolean) =>
  `<button class="chip${on ? ' on' : ''}" data-sopt="${name}" data-value="${value}">${label}</button>`;

const row = (label: string, body: string, note = '') =>
  `<span class="label">${label}</span><div class="chips">${body}${note ? `<span class="small-note">${note}</span>` : ''}</div>`;

const slider = (name: string, value: number) =>
  `<input type="range" min="0" max="100" step="5" value="${Math.round(value * 100)}" data-vol="${name}"><output>${Math.round(value * 100)}%</output>`;

/** The settings screen, shown from the main menu or the pause menu. */
export class SettingsPanel {
  private tab: SettingsTab = 'general';
  private set: BindingSet = 'solo';
  private capturing: KeyAction | null = null;
  private container: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => this.capture(e);

  constructor(
    private readonly settings: UiSettings,
    private readonly changed: () => void,
    private readonly back: () => void,
  ) {}

  render(container: HTMLElement): void {
    this.container = container;
    const s = this.settings;
    let body: string;
    if (this.tab === 'general') {
      body = `<div class="settings-grid two">
        ${row('MUSIC', slider('music', s.musicVolume))}
        ${row('EFFECTS', slider('sfx', s.sfxVolume))}
        ${row('SOUND', opt('sound', 'on', 'ON', !s.muted) + opt('sound', 'off', 'OFF', s.muted))}
        ${row('SCREEN SHAKE', opt('shake', 'full', 'FULL', s.shake === 'full') + opt('shake', 'reduced', 'REDUCED', s.shake === 'reduced') + opt('shake', 'off', 'OFF', s.shake === 'off'))}
        ${row('FLASHES', opt('flashes', 'on', 'FULL', s.flashes) + opt('flashes', 'off', 'SOFT', !s.flashes))}
        ${row('FPS COUNTER', opt('fps', 'on', 'ON', s.showFps) + opt('fps', 'off', 'OFF', !s.showFps), 'F3')}
      </div>`;
    } else if (this.tab === 'access') {
      body = `<div class="settings-grid two">
        ${row('COLORS', opt('colors', 'standard', 'STANDARD', s.colors === 'standard') + opt('colors', 'colorblind', 'COLORBLIND-SAFE', s.colors === 'colorblind'))}
        ${row('GAME SPEED', [1, 0.85, 0.7].map((v) => opt('speed', String(v), `${Math.round(v * 100)}%`, s.gameSpeed === v)).join(''), 'slows matches with humans in them')}
        ${row('LANDING MARKER', opt('marker', 'on', 'ON', s.assistMarker) + opt('marker', 'off', 'OFF', !s.assistMarker))}
        ${row('KEY HINTS', opt('hints', 'on', 'ON', s.keyHints) + opt('hints', 'off', 'OFF', !s.keyHints))}
        ${row('SCREEN SHAKE', opt('shake', 'full', 'FULL', s.shake === 'full') + opt('shake', 'reduced', 'REDUCED', s.shake === 'reduced') + opt('shake', 'off', 'OFF', s.shake === 'off'))}
        ${row('FLASHES', opt('flashes', 'on', 'FULL', s.flashes) + opt('flashes', 'off', 'SOFT', !s.flashes))}
      </div>`;
    } else {
      const keys = resolveKeys(this.set, s.keys);
      body = `<div class="chips">${SETS.map(([v, l]) => opt('set', v, l, this.set === v)).join('')}</div>
        <div class="settings-grid two keymap">
        ${KEY_ACTIONS.map(({ action, label }) => {
          const text =
            this.capturing === action ? 'PRESS A KEY…' : keys[action].map(keyLabel).join(' / ');
          return `<span class="label">${label}</span><button class="chip key${this.capturing === action ? ' on' : ''}" data-sopt="bind" data-value="${action}">${text}</button>`;
        }).join('')}
        </div>
        <div class="chips"><button class="chip" data-sopt="reset" data-value="${this.set}">RESET ${SETS.find(([v]) => v === this.set)![1]} KEYS</button><span class="small-note">Esc cancels · gamepads use fixed buttons</span></div>`;
    }
    container.innerHTML = `<div class="settings">
      <h2>SETTINGS</h2>
      <div class="chips tabs">${TABS.map(([v, l]) => opt('tab', v, l, this.tab === v)).join('')}</div>
      ${body}
      <button class="big" data-sopt="back" data-value="">BACK</button>
    </div>`;
    const root = container.querySelector<HTMLElement>('.settings')!;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-sopt]');
      if (el) this.apply(el.dataset.sopt!, el.dataset.value!);
    });
    root.querySelectorAll<HTMLInputElement>('input[data-vol]').forEach((input) =>
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100;
        if (input.dataset.vol === 'music') s.musicVolume = v;
        else s.sfxVolume = v;
        input.nextElementSibling!.textContent = `${input.value}%`;
        this.changed();
      }),
    );
  }

  /** Stops waiting for a key (leaving the screen). */
  close(): void {
    if (this.capturing) window.removeEventListener('keydown', this.onKey, true);
    this.capturing = null;
  }

  private apply(name: string, value: string): void {
    const s = this.settings;
    switch (name) {
      case 'tab':
        this.close();
        this.tab = value as SettingsTab;
        break;
      case 'set':
        this.close();
        this.set = value as BindingSet;
        break;
      case 'back':
        this.close();
        return this.back();
      case 'sound':
        s.muted = value === 'off';
        break;
      case 'shake':
        s.shake = value as UiSettings['shake'];
        break;
      case 'flashes':
        s.flashes = value === 'on';
        break;
      case 'fps':
        s.showFps = value === 'on';
        break;
      case 'colors':
        s.colors = value as UiSettings['colors'];
        break;
      case 'speed':
        s.gameSpeed = Number(value);
        break;
      case 'marker':
        s.assistMarker = value === 'on';
        break;
      case 'hints':
        s.keyHints = value === 'on';
        break;
      case 'bind':
        if (!this.capturing) window.addEventListener('keydown', this.onKey, true);
        this.capturing = value as KeyAction;
        break;
      case 'reset':
        delete s.keys[value as BindingSet];
        break;
    }
    this.changed();
    if (this.container) this.render(this.container);
  }

  /** Captures the next key press for the action being remapped. */
  private capture(e: KeyboardEvent): void {
    const action = this.capturing;
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== 'Escape' && e.code !== 'F3' && e.code !== 'Backquote')
      rebind(this.settings.keys, this.set, action, e.code);
    this.close();
    this.changed();
    if (this.container) this.render(this.container);
  }
}
