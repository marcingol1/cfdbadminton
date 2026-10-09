import type { Difficulty } from '@deadminton/bots';
import { REVENGE_TURN_TICKS } from '@deadminton/sim';
import type {
  ArenaId,
  MatchState,
  PlayerState,
  PointReason,
  PointsToWin,
  SchemeId,
  SimEvent,
  Tuning,
  WeaponId,
} from '@deadminton/sim';
import type { MatchSession } from '../game/session';
import { VIEW_H, VIEW_W, sx, sy } from '../render/view';
import { keyHints } from './keyhints';
import type { KeyLayout } from './keyhints';

export type Screen = 'menu' | 'help' | 'hud' | 'pause' | 'over';

export interface UiSettings {
  difficulty: Difficulty;
  botA: Difficulty;
  botB: Difficulty;
  pointsToWin: PointsToWin;
  scheme: SchemeId;
  arena: ArenaId;
  bestOf: 1 | 3;
  /** Revenge Turns on a random share of lost points (off by default). */
  revenge: boolean;
  assistMarker: boolean;
  keyHints: boolean;
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
  netTouch: 'TOUCHED THE NET!',
};

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

const WEAPON_LABEL: Record<WeaponId, string> = {
  frag: 'FRAG',
  shock: 'SHOCK',
  lead: 'LEAD',
  cluster: 'CLUSTER',
  ghost: 'GHOST',
  mine: 'MINE',
  rocket: 'ROCKET',
  mortar: 'MORTAR',
  homing: 'HOMING',
  airstrike: 'AIR STRIKE',
  medkit: 'MEDKIT',
  shield: 'SHIELD',
};

/** Weapon chip text: the selected weapon, its ammo, and the fuse for Frags. */
function weaponChip(st: MatchState, p: PlayerState): string {
  const revenge = st.phase === 'revenge' && st.revenge?.shooter === p.id;
  const w = revenge ? p.revengeWeapon : p.rallyWeapon;
  if (w === null) return revenge ? 'SKIP TURN' : 'SHUTTLE';
  const ammo = p.ammo[w] < 0 ? '∞' : `×${p.ammo[w]}`;
  const fuse = w === 'frag' ? ` ⏱${p.fuse}s` : '';
  return `${WEAPON_LABEL[w]} ${ammo}${fuse}`;
}

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
       <div class="revenge" hidden></div>
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
    if (screen !== 'hud') this.root.querySelector<HTMLElement>('.revenge')!.hidden = true;
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
      if (set === 'scheme') this.settings.scheme = v as SchemeId;
      if (set === 'arena') this.settings.arena = v as ArenaId;
      if (set === 'bestOf') this.settings.bestOf = Number(v) as 1 | 3;
      if (set === 'revenge') this.settings.revenge = v === 'on';
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
      case 'keyHints':
        this.settings.keyHints = !this.settings.keyHints;
        this.hudKey = '';
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
      </div>
      <div class="settings-grid">
        <span class="label">WEAPONS</span>
        <div class="chips">${(['purist', 'standard', 'chaos'] as const).map((v) => chip('scheme', v, v.toUpperCase(), s.scheme === v)).join('')}</div>
        <span class="label">ARENA</span>
        <div class="chips">${chip('arena', 'hall', 'HALL', s.arena === 'hall')}${chip('arena', 'rooftop', 'ROOFTOP', s.arena === 'rooftop')}</div>
        <span class="label">POINTS</span>
        <div class="chips">${([7, 11, 21] as const).map((p) => chip('points', p, String(p), s.pointsToWin === p)).join('')}</div>
        <span class="label">GAMES</span>
        <div class="chips">${chip('bestOf', 1, '1', s.bestOf === 1)}${chip('bestOf', 3, 'BEST OF 3', s.bestOf === 3)}</div>
        <span class="label">REVENGE</span>
        <div class="chips">${chip('revenge', 'off', 'OFF', !s.revenge)}${chip('revenge', 'on', 'ON · RANDOM', s.revenge)}</div>
      </div>
      <button class="link" data-action="help">HOW TO PLAY</button>
      <p class="footer">M2 preview · weapons, KOs, Revenge Turns · personalities arrive in M3</p>`;
  }

  private renderHelp(): void {
    this.menuEl.innerHTML = `
      <h2>HOW TO PLAY</h2>
      <div class="help">
        <p><b>Two ways to win</b>: first to ${this.settings.pointsToWin} points (win by 2), or knock your opponent out (0 HP). A KO ends the match at once. Blow yourself up and your opponent wins.</p>
        <p><b>Rally</b>: land the shuttle in on the other side, or make your opponent hit it out, into the net, or with their body. Damage alone never ends a rally.</p>
        <p><b>Move</b> A / D · <b>Jump</b> Space · <b>Swing</b> J or left click. Hold a direction while swinging: ↑ clear · ↓ drop / net shot · → (toward the net) <b>smash</b> when the shuttle is high, else a drive. Timing decides accuracy. Watch the <b>wind</b>.</p>
        <p><b>Loaded shuttles</b>: Q / E picks a weapon for your next hit, R sets the Frag fuse (1–5 s). <b>Frag</b> explodes when its fuse runs out, even if they hit it back (hot potato!). <b>Shock</b> hurts and stuns whoever hits it next. <b>Lead</b> flies fast and hurts on a body hit. <b>Cluster</b> splits into bomblets on landing. <b>Ghost</b> turns invisible after the net. <b>Mine</b>: select it and press K to throw it onto their side.</p>
        <p><b>Revenge Turn</b> (optional, off by default): when it's on, losing a point sometimes (about 1 in 5) gives you one Worms-style shot. Q / E picks Rocket, Mortar, Homing Missile, Air Strike, Medkit, Shield (or skip). ↑ / ↓ aims, hold K (or right click) to charge, release to fire. Your opponent can run to dodge. Revenge shots never score points.</p>
        <p><b>Crates</b> parachute in: walk into them for ammo, health or a shield. Shoot them and they explode. Heavy weapons unlock after a few rallies.</p>
        <p><b>Local 2P</b>: left player WASD, L-Shift jump, Space swing, F fire, Q/E weapons, R fuse · right player arrows, R-Shift jump, Enter swing, / fire, [ ] weapons, \\ fuse. <b>Gamepad</b>: A jump, X swing, Y/RT fire, LB/RB weapons, B fuse.</p>
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
        <button class="chip${s.keyHints ? ' on' : ''}" data-action="keyHints">KEY HINTS</button>
        <button class="chip${s.muted ? '' : ' on'}" data-action="sound">SOUND</button>
      </div>`;
  }

  private renderOver(session: MatchSession): void {
    const st = session.state;
    const w = st.winner ?? 0;
    const name = session.controllers[w].label;
    const s = session.stats;
    const how = st.winReason === 'ko' ? ' BY K.O.' : '';
    this.overlayEl.innerHTML = `
      <h2 class="${w === 0 ? 'p1' : 'p2'}">${name} WINS${how}</h2>
      <p class="final">${st.score[0]} – ${st.score[1]}</p>
      <table class="stats">
        <tr><td>${s.winners[0]}</td><th>winners</th><td>${s.winners[1]}</td></tr>
        <tr><td>${s.errors[0]}</td><th>errors</th><td>${s.errors[1]}</td></tr>
        <tr><td>${s.smashes[0]}</td><th>smashes</th><td>${s.smashes[1]}</td></tr>
        <tr><td>${s.damageTaken[0]}</td><th>damage taken</th><td>${s.damageTaken[1]}</td></tr>
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
  update(
    session: MatchSession,
    events: SimEvent[],
    deltaMs: number,
    layouts: [KeyLayout | null, KeyLayout | null],
  ): void {
    const st = session.state;
    const name = (id: 0 | 1) => session.controllers[id].label;
    for (const e of events) {
      switch (e.type) {
        case 'point':
          this.banner(`${name(e.winner)} · ${REASON_TEXT[e.reason]}`, e.winner);
          break;
        case 'ko':
          this.banner('K.O.!', e.player === 0 ? 1 : 0, 'big');
          break;
        case 'suddenDeath':
          this.banner('SUDDEN DEATH · 1 HP · NEXT POINT WINS', st.server, 'big');
          break;
        case 'gameOver':
          this.banner(`GAME ${name(e.winner)} · ${e.games[0]}–${e.games[1]}`, e.winner, 'big');
          break;
        case 'revengeStart':
          this.banner(`REVENGE TURN · ${name(e.shooter)}`, e.shooter);
          break;
        case 'damage':
          if (e.amount > 0) this.float(`-${e.amount}`, e.x, e.y, 'dmg');
          break;
        case 'heal':
          if (e.amount > 0)
            this.float(
              `+${e.amount}`,
              st.players[e.player].x,
              st.players[e.player].y + 1.8,
              'heal',
            );
          break;
        case 'shieldUp':
          this.float('SHIELD', st.players[e.player].x, st.players[e.player].y + 1.8, 'shield');
          break;
        case 'shocked':
          this.float('ZAP!', st.players[e.player].x, st.players[e.player].y + 2, 'shield');
          break;
        case 'crateCollect': {
          const what =
            e.contents === 'weapon' && e.weapon
              ? `+1 ${WEAPON_LABEL[e.weapon]}`
              : e.contents.toUpperCase();
          this.float(what, st.players[e.player].x, st.players[e.player].y + 2.1, 'heal');
          break;
        }
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= deltaMs;
      if (this.bannerTimer <= 0) this.root.querySelector<HTMLElement>('.banner')!.hidden = true;
    }

    const weapons = st.config.scheme !== 'purist';
    const wind = st.wind;
    const arrows =
      wind === 0 ? '·' : (wind > 0 ? '▶' : '◀').repeat(Math.min(3, Math.ceil(Math.abs(wind) * 2)));
    const pl = st.players;
    const key = [
      st.score.join(),
      st.games.join(),
      st.server,
      wind,
      st.phase,
      st.suddenDeath,
      ...pl.map((p) => `${p.hp}/${p.shield}/${weaponChip(st, p)}`),
      this.settings.keyHints,
      ...layouts,
      st.revenge ? `${st.revenge.shooter}${st.revenge.fired}` : '-',
      ...pl.map((p) => `${p.rallyWeapon}${p.dead}`),
    ].join('|');
    if (key !== this.hudKey) {
      this.hudKey = key;
      const serving = (id: 0 | 1) =>
        st.server === id && st.phase === 'serve' ? '<i class="serve-dot"></i>' : '';
      const hp = (p: PlayerState) =>
        weapons
          ? `<span class="hp"><i style="width:${p.hp}%" class="${p.hp > 60 ? 'ok' : p.hp > 30 ? 'warn' : 'low'}"></i>${p.shield > 0 ? `<b style="width:${p.shield}%"></b>` : ''}</span><span class="hp-num">${p.hp}</span>`
          : '';
      const chipHtml = (p: PlayerState) =>
        weapons ? `<span class="weapon">${weaponChip(st, p)}</span>` : '';
      const keys = (id: 0 | 1) => {
        const layout = layouts[id];
        if (!layout || !this.settings.keyHints) return '';
        const html = keyHints(st, id, layout);
        return html ? `<div class="row keys">${html}</div>` : '';
      };
      const games =
        st.config.bestOf > 1
          ? `<span class="games">${'●'.repeat(st.games[0])}${'○'.repeat(2 - st.games[0])} GAMES ${'○'.repeat(2 - st.games[1])}${'●'.repeat(st.games[1])}</span>`
          : '';
      this.hudEl.innerHTML = `
        <div class="side p1"><div class="row"><span class="name">${name(0)}</span>${serving(0)}<span class="score">${st.score[0]}</span></div><div class="row sub">${hp(pl[0])}${chipHtml(pl[0])}</div>${keys(0)}</div>
        <div class="center"><div class="wind" title="wind">WIND <b>${arrows}</b> ${Math.abs(wind).toFixed(1)}</div>${games}${st.suddenDeath ? '<span class="sudden">SUDDEN DEATH</span>' : ''}</div>
        <div class="side p2"><div class="row"><span class="score">${st.score[1]}</span>${serving(1)}<span class="name">${name(1)}</span></div><div class="row sub">${chipHtml(pl[1])}${hp(pl[1])}</div>${keys(1)}</div>`;
      if (session.mode === 'watch') this.renderWatch(session);
    }

    // Revenge Turn bar: who shoots, time left, weapon, charge.
    const rvEl = this.root.querySelector<HTMLElement>('.revenge')!;
    const rv = st.revenge;
    rvEl.hidden = !(rv && !rv.fired && this.screen === 'hud');
    if (rv && !rvEl.hidden) {
      const secs = Math.ceil(rv.ticksLeft / 60);
      const shooter = pl[rv.shooter];
      const aimed =
        shooter.revengeWeapon === 'rocket' ||
        shooter.revengeWeapon === 'mortar' ||
        shooter.revengeWeapon === 'homing';
      rvEl.className = `revenge ${rv.shooter === 0 ? 'p1' : 'p2'}`;
      rvEl.innerHTML = `<span>REVENGE · ${name(rv.shooter)}</span><span class="time${secs <= 3 ? ' low' : ''}">${secs}s</span><span>${weaponChip(st, shooter)}${aimed ? ` · ${Math.round(rv.angle)}°` : ''}</span>${aimed ? `<span class="power"><i style="width:${Math.round(rv.power * 100)}%"></i></span>` : ''}`;
      rvEl.style.setProperty('--t', String(rv.ticksLeft / REVENGE_TURN_TICKS));
    }

    const hint = this.root.querySelector<HTMLElement>('.hint')!;
    const humanServing = st.phase === 'serve' && session.controllers[st.server].kind === 'human';
    // With key hints on, the shooter's own hint row already explains aiming.
    const humanRevenge =
      rv &&
      !rv.fired &&
      session.controllers[rv.shooter].kind === 'human' &&
      !this.settings.keyHints;
    hint.hidden = !((humanServing || humanRevenge) && this.screen === 'hud');
    if (!hint.hidden) {
      const who = (id: 0 | 1) => (session.mode === 'local2p' ? `${name(id)}: ` : '');
      hint.textContent = humanRevenge
        ? `${who(rv!.shooter)}↑↓ AIM · HOLD FIRE TO CHARGE · RELEASE TO SHOOT · WEAPON ◀▶`
        : `${who(st.server)}SWING TO SERVE · ↑ HIGH · → FLICK · — SHORT`;
    }
  }

  /** A short text that floats up from a world position (damage numbers and pickups). */
  private float(text: string, x: number, y: number, cls: string): void {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${(sx(x) / VIEW_W) * 100}%`;
    el.style.top = `${(sy(y) / VIEW_H) * 100}%`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  private banner(text: string, winner: 0 | 1, size = ''): void {
    const el = this.root.querySelector<HTMLElement>('.banner')!;
    el.textContent = text;
    el.className = `banner ${winner === 0 ? 'p1' : 'p2'} ${size}`;
    el.hidden = false;
    this.bannerTimer = 1300;
  }
}
