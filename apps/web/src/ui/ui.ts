import type { Difficulty } from '@deadminton/bots';
import type { MatchState, PointReason, PointsToWin, SimEvent, Tuning } from '@deadminton/sim';
import type { MatchSession } from '../game/session';

export type Screen = 'menu' | 'help' | 'hud' | 'pause' | 'over';

export interface UiSettings {
  difficulty: Difficulty;
  botA: Difficulty;
  botB: Difficulty;
  pointsToWin: PointsToWin;
  assistMarker: boolean;
  muted: boolean;
}

export interface UiActions {
  playBot(): void;
  playLocal(): void;
  watch(): void;
  resume(): void;
  pause(): void;
  restart(): void;
  menu(): void;
  setSpeed(speed: number): void;
  togglePauseWatch(): void;
  stepWatch(): void;
  toggleIntent(): void;
  settingsChanged(): void;
  tuningChanged(path: string, value: number): void;
}

const REASON_TEXT: Record<PointReason, string> = {
  in: 'IN!',
  out: 'OUT!',
  ownSide: 'NET!',
  body: 'BODY HIT!',
  ceiling: 'CEILING!',
  serveShort: 'SHORT SERVE!',
};

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

interface TuningKnob {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const KNOBS: TuningKnob[] = [
  { path: 'shuttle.terminalVelocity', label: 'Shuttle terminal v', min: 5, max: 10, step: 0.1 },
  { path: 'shuttle.windCompensation', label: 'Wind compensation', min: 0, max: 1, step: 0.05 },
  { path: 'player.runSpeed', label: 'Run speed', min: 3, max: 8, step: 0.1 },
  { path: 'player.jumpVelocity', label: 'Jump velocity', min: 3.5, max: 7, step: 0.1 },
  { path: 'player.reach', label: 'Racket reach', min: 0.6, max: 1.3, step: 0.01 },
  { path: 'swing.activeEnd', label: 'Swing window end', min: 5, max: 14, step: 1 },
  { path: 'shots.smash.speed', label: 'Smash speed', min: 30, max: 70, step: 1 },
  { path: 'shots.clear.angle', label: 'Clear angle', min: 30, max: 55, step: 1 },
];

export function getPath(obj: unknown, path: string): number {
  return path.split('.').reduce((o, k) => (o as Record<string, unknown>)[k], obj) as number;
}

export function setPath(obj: unknown, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => (o as Record<string, unknown>)[k], obj) as Record<
    string,
    number
  >;
  target[last] = value;
}

const chip = (group: string, value: string | number, label: string, on: boolean) =>
  `<button class="chip${on ? ' on' : ''}" data-set="${group}" data-value="${value}">${label}</button>`;

export class Ui {
  private screen: Screen = 'menu';
  private readonly menuEl: HTMLElement;
  private readonly hudEl: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly watchEl: HTMLElement;
  private readonly tuningEl: HTMLElement;
  private bannerTimer = 0;
  private hudKey = '';

  constructor(
    private readonly root: HTMLElement,
    readonly settings: UiSettings,
    private readonly actions: UiActions,
  ) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" hidden></div>
       <div class="banner" hidden></div>
       <div class="hint" hidden></div>
       <div class="watchbar" hidden></div>
       <div class="overlay" hidden></div>
       <div class="menu"></div>
       <div class="tuning" hidden></div>
       <button class="pause-btn" hidden aria-label="Pause">❚❚</button>`,
    );
    this.menuEl = root.querySelector('.menu')!;
    this.hudEl = root.querySelector('.hud')!;
    this.overlayEl = root.querySelector('.overlay')!;
    this.watchEl = root.querySelector('.watchbar')!;
    this.tuningEl = root.querySelector('.tuning')!;
    root.addEventListener('click', (e) => this.onClick(e));
    root.querySelector('.pause-btn')!.addEventListener('click', () => this.actions.pause());
    this.renderMenu();
  }

  get current(): Screen {
    return this.screen;
  }

  show(screen: Screen, session?: MatchSession): void {
    this.screen = screen;
    const inMatch = screen === 'hud' || screen === 'pause' || screen === 'over';
    this.menuEl.hidden = screen !== 'menu' && screen !== 'help';
    this.hudEl.hidden = !inMatch;
    this.overlayEl.hidden = screen !== 'pause' && screen !== 'over';
    this.root.querySelector<HTMLElement>('.pause-btn')!.hidden =
      screen !== 'hud' || session?.mode === 'watch';
    this.watchEl.hidden = !(screen === 'hud' && session?.mode === 'watch');
    this.root.querySelector<HTMLElement>('.hint')!.hidden = true;
    if (screen !== 'hud') {
      this.root.querySelector<HTMLElement>('.banner')!.hidden = true;
      this.bannerTimer = 0;
    }
    if (screen === 'menu') this.renderMenu();
    if (screen === 'help') this.renderHelp();
    if (screen === 'pause') this.renderPause();
    if (screen === 'over' && session) this.renderOver(session);
    if (session?.mode === 'watch') this.renderWatch(session);
    this.hudKey = '';
  }

  toggleTuning(state: MatchState | null): void {
    this.tuningEl.hidden = !this.tuningEl.hidden;
    if (!this.tuningEl.hidden) this.renderTuning(state?.config.tuning ?? null);
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-set]');
    if (!el) return;
    const set = el.dataset.set;
    if (set) {
      const v = el.dataset.value!;
      if (set === 'difficulty' || set === 'botA' || set === 'botB')
        this.settings[set] = v as Difficulty;
      if (set === 'points') this.settings.pointsToWin = Number(v) as PointsToWin;
      if (set === 'speed') return this.actions.setSpeed(Number(v));
      this.actions.settingsChanged();
      if (this.screen === 'menu') this.renderMenu();
      return;
    }
    switch (el.dataset.action) {
      case 'playBot':
        return this.actions.playBot();
      case 'playLocal':
        return this.actions.playLocal();
      case 'watch':
        return this.actions.watch();
      case 'help':
        return this.show('help');
      case 'back':
        return this.show('menu');
      case 'resume':
        return this.actions.resume();
      case 'restart':
        return this.actions.restart();
      case 'menu':
        return this.actions.menu();
      case 'marker':
        this.settings.assistMarker = !this.settings.assistMarker;
        this.actions.settingsChanged();
        return this.renderPause();
      case 'sound':
        this.settings.muted = !this.settings.muted;
        this.actions.settingsChanged();
        return this.renderPause();
      case 'watchPause':
        return this.actions.togglePauseWatch();
      case 'watchStep':
        return this.actions.stepWatch();
      case 'intent':
        return this.actions.toggleIntent();
      case 'tuningClose':
        this.tuningEl.hidden = true;
        return;
    }
  }

  private renderMenu(): void {
    const s = this.settings;
    this.menuEl.innerHTML = `
      <h1 class="title">DEAD<span>MINTON</span></h1>
      <p class="tagline">badminton. but deadly.</p>
      <div class="menu-grid">
        <button class="big" data-action="playBot">PLAY VS BOT</button>
        <div class="chips">${DIFFS.map((d) => chip('difficulty', d, d.toUpperCase(), s.difficulty === d)).join('')}</div>
        <button class="big" data-action="playLocal">LOCAL 2 PLAYERS</button>
        <div class="chips small-note">keyboard halves or 2 gamepads</div>
        <button class="big" data-action="watch">WATCH BOTS</button>
        <div class="chips">${DIFFS.map((d) => chip('botA', d, d[0]!.toUpperCase(), s.botA === d)).join('')}<span class="vs">vs</span>${DIFFS.map((d) => chip('botB', d, d[0]!.toUpperCase(), s.botB === d)).join('')}</div>
        <span class="label">POINTS</span>
        <div class="chips">${([7, 11, 21] as const).map((p) => chip('points', p, String(p), s.pointsToWin === p)).join('')}</div>
      </div>
      <button class="link" data-action="help">HOW TO PLAY</button>
      <p class="footer">M1 preview · pure badminton · weapons arrive in M2</p>`;
  }

  private renderHelp(): void {
    this.menuEl.innerHTML = `
      <h2>HOW TO PLAY</h2>
      <div class="help">
        <p><b>Win the rally</b>: land the shuttle in on the other side, or make your opponent hit it out, into the net, or with their body. First to ${this.settings.pointsToWin}, win by 2.</p>
        <p><b>Move</b> A / D or ← →. <b>Jump</b> Space. <b>Swing</b> J (or click / tap HIT).</p>
        <p><b>Hold a direction while you swing</b>:<br>
          ↑ W — clear (high and deep) · ↓ S — drop / net shot<br>
          → toward the net — <b>smash</b> when the shuttle is high (jump!), else a drive<br>
          nothing — safe clear / lift</p>
        <p><b>Timing</b>: meet the shuttle at the racket's sweet spot. Bad timing sends it long, short, or into the net. Watch the <b>wind</b>.</p>
        <p><b>Serve</b>: J to serve. ↑ high serve · → flick · nothing / ↓ short serve. It must land past the short service line.</p>
        <p><b>Local 2P</b>: left player WASD + L-Shift jump + Space swing · right player arrows + R-Shift jump + Enter swing.</p>
        <p>Esc pauses · \` opens the tuning panel.</p>
      </div>
      <button class="big" data-action="back">BACK</button>`;
  }

  private renderPause(): void {
    const s = this.settings;
    this.overlayEl.innerHTML = `
      <h2>PAUSED</h2>
      <button class="big" data-action="resume">RESUME</button>
      <button class="big" data-action="restart">RESTART</button>
      <button class="big" data-action="menu">MENU</button>
      <div class="chips">
        <button class="chip${s.assistMarker ? ' on' : ''}" data-action="marker">LANDING MARKER</button>
        <button class="chip${s.muted ? '' : ' on'}" data-action="sound">SOUND</button>
      </div>`;
  }

  private renderOver(session: MatchSession): void {
    const st = session.state;
    const w = st.winner ?? 0;
    const name = session.controllers[w].label;
    const s = session.stats;
    this.overlayEl.innerHTML = `
      <h2 class="${w === 0 ? 'p1' : 'p2'}">${name} WINS</h2>
      <p class="final">${st.score[0]} – ${st.score[1]}</p>
      <table class="stats">
        <tr><td>${s.winners[0]}</td><th>winners</th><td>${s.winners[1]}</td></tr>
        <tr><td>${s.errors[0]}</td><th>errors</th><td>${s.errors[1]}</td></tr>
        <tr><td>${s.smashes[0]}</td><th>smashes</th><td>${s.smashes[1]}</td></tr>
        <tr><td colspan="3">longest rally: ${s.longestRally} shots</td></tr>
      </table>
      <button class="big" data-action="restart">REMATCH</button>
      <button class="big" data-action="menu">MENU</button>`;
  }

  renderWatch(session: MatchSession): void {
    const speeds = [0.5, 1, 2, 4, 8];
    this.watchEl.innerHTML = `
      ${speeds.map((v) => chip('speed', v, `${v}×`, session.speed === v)).join('')}
      <button class="chip" data-action="watchPause">${session.paused ? '▶' : '❚❚'}</button>
      <button class="chip" data-action="watchStep">STEP</button>
      <button class="chip" data-action="intent">AI&nbsp;INTENT</button>
      <span class="seed">seed ${session.seed}</span>
      <button class="chip" data-action="menu">MENU</button>`;
  }

  private renderTuning(tuning: Tuning | null): void {
    if (!tuning) {
      this.tuningEl.innerHTML = '<p>Start a match to tune it.</p>';
      return;
    }
    this.tuningEl.innerHTML =
      `<h3>TUNING <button class="chip" data-action="tuningClose">✕</button></h3>` +
      KNOBS.map((k) => {
        const v = getPath(tuning, k.path);
        return `<label>${k.label} <output>${v}</output>
          <input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" data-path="${k.path}"></label>`;
      }).join('') +
      `<p class="small-note">Applies live to this match and the next ones.</p>`;
    this.tuningEl.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) =>
      input.addEventListener('input', () => {
        input.previousElementSibling!.textContent = input.value;
        this.actions.tuningChanged(input.dataset.path!, Number(input.value));
      }),
    );
  }

  /** Called every frame while a match is shown. */
  update(session: MatchSession, events: SimEvent[], deltaMs: number): void {
    const st = session.state;
    for (const e of events) {
      if (e.type === 'point')
        this.banner(`${session.controllers[e.winner].label} · ${REASON_TEXT[e.reason]}`, e.winner);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= deltaMs;
      if (this.bannerTimer <= 0) this.root.querySelector<HTMLElement>('.banner')!.hidden = true;
    }

    const wind = st.wind;
    const arrows =
      wind === 0 ? '·' : (wind > 0 ? '▶' : '◀').repeat(Math.min(3, Math.ceil(Math.abs(wind) * 2)));
    const key = `${st.score[0]}|${st.score[1]}|${st.server}|${wind}|${st.phase}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      const serving = (id: 0 | 1) =>
        st.server === id && st.phase === 'serve' ? '<i class="serve-dot"></i>' : '';
      this.hudEl.innerHTML = `
        <div class="side p1"><span class="name">${session.controllers[0].label}</span>${serving(0)}<span class="score">${st.score[0]}</span></div>
        <div class="wind" title="wind">WIND <b>${arrows}</b> ${Math.abs(wind).toFixed(1)}</div>
        <div class="side p2"><span class="score">${st.score[1]}</span>${serving(1)}<span class="name">${session.controllers[1].label}</span></div>`;
      if (session.mode === 'watch') this.renderWatch(session);
    }

    const hint = this.root.querySelector<HTMLElement>('.hint')!;
    const humanServing = st.phase === 'serve' && session.controllers[st.server].kind === 'human';
    hint.hidden = !(humanServing && this.screen === 'hud');
    if (!hint.hidden) {
      const who = session.mode === 'local2p' ? `${session.controllers[st.server].label}: ` : '';
      hint.textContent = `${who}SWING TO SERVE · ↑ HIGH · → FLICK · — SHORT`;
    }
  }

  private banner(text: string, winner: 0 | 1): void {
    const el = this.root.querySelector<HTMLElement>('.banner')!;
    el.textContent = text;
    el.className = `banner ${winner === 0 ? 'p1' : 'p2'}`;
    el.hidden = false;
    this.bannerTimer = 1300;
  }
}
