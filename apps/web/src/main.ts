import '@fontsource/press-start-2p';
import './style.css';
import Phaser from 'phaser';
import type { Difficulty, Personality } from '@deadminton/bots';
import { DEFAULT_TUNING, parseReplay, replayFrames } from '@deadminton/sim';
import type { MatchConfig, Replay, SimEvent, Tuning } from '@deadminton/sim';
import { Music } from './audio/music';
import { Sfx } from './audio/sfx';
import { CHALLENGES, loadCompleted, markCompleted } from './game/challenges';
import type { Challenge } from './game/challenges';
import { BotController, HumanController, ReplayController } from './game/controllers';
import type { Controller } from './game/controllers';
import { MatchSession } from './game/session';
import type { SessionMode } from './game/session';
import {
  GAMEPAD_LABELS,
  TOUCH_LABELS,
  TUTORIAL_CONFIG,
  Tutorial,
  keyboardLabels,
} from './game/tutorial';
import type { InputDevice } from './input/device';
import { GamepadDevice } from './input/gamepad';
import { KeyboardDevice, resolveKeys } from './input/keyboard';
import { TouchDevice, isTouchDevice } from './input/touch';
import type { FxSettings } from './render/fx';
import { setColorMode } from './render/palette';
import { MatchScene } from './render/scene';
import type { SceneHost } from './render/scene';
import { VIEW_H, VIEW_W } from './render/view';
import { haptic } from './platform/haptics';
import { initNative, isNative, keepAwake } from './platform/native';
import { FpsMeter } from './ui/fps';
import type { KeyLayout } from './ui/keyhints';
import { Ui, setPath } from './ui/ui';
import type { UiSettings } from './ui/ui';

const SETTINGS_KEY = 'deadminton.settings';
const REPLAY_KEY = 'deadminton.lastReplay';

function loadSettings(): UiSettings {
  const defaults: UiSettings = {
    difficulty: 'medium',
    botA: 'hard',
    botB: 'medium',
    style: 'balanced',
    styleA: 'berserker',
    styleB: 'purist',
    pointsToWin: 11,
    scheme: 'standard',
    arena: 'hall',
    bestOf: 1,
    revenge: false,
    assistMarker: true,
    keyHints: true,
    // On by default while developing in the browser; off in the store apps.
    showFps: !isNative(),
    muted: false,
    shake: 'full',
    flashes: true,
    sfxVolume: 0.8,
    musicVolume: 0.6,
    colors: 'standard',
    gameSpeed: 1,
    keys: {},
    touchLefty: false,
    touchSize: 'medium',
    haptics: true,
    detail: 'high',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

const randomSeed = () => (Math.random() * 0xffffffff) >>> 0;

/** `?seed=123` pins the seed of every match started from the menu (see docs/AI_AND_SEEDS.md). */
function urlSeed(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw) >>> 0;
}

class App implements SceneHost {
  session: MatchSession | null = null;
  showIntent = false;
  private readonly ui: Ui;
  private readonly sfx = new Sfx();
  private readonly music = new Music(this.sfx);
  private readonly fps: FpsMeter;
  private lastReplay: Replay | null = null;
  /** The replay currently (or last) being watched, for WATCH AGAIN. */
  private playing: Replay | null = null;
  private readonly settings = loadSettings();
  private readonly tuning: Tuning = structuredClone(DEFAULT_TUNING);
  private readonly touch: TouchDevice | null;
  private readonly mouseHit: KeyboardDevice;
  private lastMode: SessionMode = 'vsBot';
  private startWasDown = false;
  /** Time since the match ended, before the results overlay appears. */
  private overMs = 0;
  /** The challenge being played (vs Bot with a fixed setup), if any. */
  private challenge: Challenge | null = null;
  private tutorial: Tutorial | null = null;

  constructor(private readonly stage: HTMLElement) {
    this.ui = new Ui(
      stage,
      this.settings,
      {
        playBot: () => {
          this.challenge = null;
          this.start('vsBot');
        },
        watchReplay: () => {
          const replay = this.session?.replay ?? this.loadLastReplay();
          if (replay) this.startReplay(replay);
        },
        saveReplay: () => {
          const replay = this.session?.replay ?? this.loadLastReplay();
          if (replay) this.downloadReplay(replay);
        },
        loadReplayFile: (file) => {
          file
            .text()
            .then((text) => this.startReplay(parseReplay(JSON.parse(text))))
            .catch((err: unknown) =>
              this.ui.replayError(err instanceof Error ? err.message : 'Could not read that file.'),
            );
        },
        hasLastReplay: () => this.loadLastReplay() !== null,
        playLocal: () => this.start('local2p'),
        tutorial: () => this.start('tutorial'),
        challenge: (id) => {
          this.challenge = CHALLENGES.find((c) => c.id === id) ?? null;
          this.start('vsBot');
        },
        completedChallenges: () => loadCompleted(),
        watch: () => this.start('watch'),
        resume: () => this.resume(),
        pause: () => this.pause(),
        restart: () => this.start(this.lastMode),
        menu: () => this.toMenu(),
        setSpeed: (v) => {
          if (this.session) {
            this.session.speed = v;
            this.ui.renderWatch(this.session);
          }
        },
        togglePauseWatch: () => {
          if (this.session) {
            this.session.paused = !this.session.paused;
            this.ui.renderWatch(this.session);
          }
        },
        stepWatch: () => {
          if (this.session) {
            this.session.paused = true;
            this.pendingEvents.push(...this.session.tick());
            this.ui.renderWatch(this.session);
          }
        },
        toggleIntent: () => (this.showIntent = !this.showIntent),
        settingsChanged: () => this.saveSettings(),
        tuningChanged: (path, value) => {
          setPath(this.tuning, path, value);
          if (this.session) {
            setPath(this.session.state.config.tuning, path, value);
            this.session.tuningEdited = true;
          }
        },
      },
      isTouchDevice(),
    );
    // Fixed to the whole screen, so on wide phones the controls sit beside the game.
    this.touch = isTouchDevice() ? new TouchDevice(document.body) : null;
    this.touch?.setVisible(false);
    this.configureTouch();
    this.mouseHit = new KeyboardDevice({
      left: [],
      right: [],
      up: [],
      down: [],
      jump: [],
      hit: [],
      fire: [],
      prev: [],
      next: [],
      fuse: [],
    });
    this.sfx.muted = this.settings.muted;
    this.sfx.setLevels(this.settings.sfxVolume, this.settings.musicVolume);
    this.sfx.onUnlock = () => this.music.resume();
    setColorMode(this.settings.colors);
    this.fps = new FpsMeter(stage);
    this.fps.setVisible(this.settings.showFps);

    stage.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if ((e.target as HTMLElement).tagName !== 'CANVAS' || this.ui.current !== 'hud') return;
      // Left click swings, right click fires (hold to charge in a Revenge Turn).
      if (e.button === 2) this.mouseHit.externalFire = true;
      else this.mouseHit.externalHit = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.mouseHit.externalFire = false;
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'Backquote') this.ui.toggleTuning(this.session?.state ?? null);
      if (e.code === 'F3') {
        e.preventDefault();
        this.settings.showFps = !this.settings.showFps;
        this.saveSettings();
      }
    });
    document.addEventListener('visibilitychange', () => document.hidden && this.pause());
    this.toMenu();
    void initNative({
      onBack: () => this.ui.back(),
      onPause: () => this.pause(),
    });
  }

  get fx(): FxSettings {
    const s = this.settings;
    return {
      shake: s.shake === 'full' ? 1 : s.shake === 'reduced' ? 0.4 : 0,
      flashes: s.flashes,
      low: s.detail === 'low',
    };
  }

  get assistMarker(): boolean {
    return this.settings.assistMarker;
  }

  private pendingEvents: SimEvent[] = [];

  /** The game speed assist slows real time in matches with a human playing. */
  private applySpeedAssist(): void {
    const s = this.session;
    if (s && (s.mode === 'vsBot' || s.mode === 'local2p' || s.mode === 'tutorial'))
      s.speed = this.settings.gameSpeed;
  }

  private configureTouch(): void {
    const s = this.settings;
    this.touch?.configure({
      leftHanded: s.touchLefty,
      size: s.touchSize,
      onPress: () => s.haptics && haptic('tick'),
    });
  }

  private saveSettings(): void {
    this.configureTouch();
    setColorMode(this.settings.colors);
    this.applySpeedAssist();
    this.sfx.muted = this.settings.muted;
    this.sfx.setLevels(this.settings.sfxVolume, this.settings.musicVolume);
    this.fps.setVisible(this.settings.showFps);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Private mode or blocked storage: settings just don't persist.
    }
  }

  private config(mode: SessionMode): Partial<MatchConfig> {
    // The title screen shows off: bots play Chaos (lots of weapons) behind the menu.
    if (mode === 'attract')
      return {
        pointsToWin: 11,
        scheme: 'chaos',
        arena: 'hall',
        revengeTurns: true,
        tuning: this.tuning,
      };
    if (mode === 'tutorial') return { ...TUTORIAL_CONFIG, tuning: this.tuning };
    if (mode === 'vsBot' && this.challenge)
      return { bestOf: 1, revengeTurns: false, ...this.challenge.config, tuning: this.tuning };
    const s = this.settings;
    return {
      pointsToWin: s.pointsToWin,
      scheme: s.scheme,
      arena: s.arena,
      bestOf: s.bestOf,
      revengeTurns: s.revenge,
      tuning: this.tuning,
    };
  }

  /** Plays a recorded match back through the normal session (inputs come from the file). */
  private startReplay(replay: Replay): void {
    const frames = replayFrames(replay);
    const controllers: [Controller, Controller] = [
      new ReplayController(0, frames, replay.labels[0]),
      new ReplayController(1, frames, replay.labels[1]),
    ];
    this.lastMode = 'replay';
    this.playing = replay;
    this.session = new MatchSession('replay', controllers, replay.config, replay.seed, replay);
    this.ui.challengeResult = null;
    this.overMs = 0;
    this.music.play('match');
    this.showIntent = false;
    this.ui.show('hud', this.session);
  }

  private saveLastReplay(replay: Replay): void {
    this.lastReplay = replay;
    try {
      localStorage.setItem(REPLAY_KEY, JSON.stringify(replay));
    } catch {
      // Storage full or blocked: the replay is still available until the page closes.
    }
  }

  private loadLastReplay(): Replay | null {
    if (this.lastReplay) return this.lastReplay;
    try {
      const raw = localStorage.getItem(REPLAY_KEY);
      return raw ? parseReplay(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private downloadReplay(replay: Replay): void {
    const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deadminton-replay-${replay.seed}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private start(mode: SessionMode): void {
    if (mode === 'replay') {
      const replay = this.playing ?? this.loadLastReplay();
      if (replay) this.startReplay(replay);
      return;
    }
    if (mode !== 'attract') this.lastMode = mode;
    const seed = (mode !== 'attract' ? urlSeed() : null) ?? randomSeed();
    let controllers: [Controller, Controller];
    const s = this.settings;
    switch (mode) {
      case 'vsBot':
      case 'tutorial': {
        const devices: InputDevice[] = [
          new KeyboardDevice(() => resolveKeys('solo', this.settings.keys)),
          new GamepadDevice(0),
          this.mouseHit,
        ];
        if (this.touch) devices.push(this.touch);
        const ch = mode === 'vsBot' ? this.challenge : null;
        controllers = [
          new HumanController('YOU', devices),
          mode === 'tutorial'
            ? new BotController(1, 'easy', seed, 'purist')
            : new BotController(1, ch?.bot ?? s.difficulty, seed, ch?.style ?? s.style),
        ];
        break;
      }
      case 'local2p':
        controllers = [
          new HumanController('P1', [
            new KeyboardDevice(() => resolveKeys('p1', this.settings.keys)),
            new GamepadDevice(0),
          ]),
          new HumanController('P2', [
            new KeyboardDevice(() => resolveKeys('p2', this.settings.keys)),
            new GamepadDevice(1),
          ]),
        ];
        break;
      case 'watch':
      case 'attract': {
        const a: Difficulty = mode === 'attract' ? 'hard' : s.botA;
        const b: Difficulty = mode === 'attract' ? 'hard' : s.botB;
        const styleA: Personality = mode === 'attract' ? 'berserker' : s.styleA;
        const styleB: Personality = mode === 'attract' ? 'balanced' : s.styleB;
        controllers = [
          new BotController(0, a, seed, styleA),
          new BotController(1, b, seed + 1, styleB),
        ];
        break;
      }
    }
    this.session = new MatchSession(mode, controllers, this.config(mode), seed);
    if (mode === 'tutorial' && !this.tutorial) this.tutorial = new Tutorial();
    if (mode !== 'tutorial') this.tutorial = null;
    if (mode !== 'vsBot' && mode !== 'attract') this.challenge = null;
    this.ui.challengeResult = null;
    this.applySpeedAssist();
    this.overMs = 0;
    this.music.play(mode === 'attract' ? 'menu' : 'match');
    this.showIntent = false;
    if (mode === 'attract') this.ui.show('menu');
    else this.ui.show('hud', this.session);
  }

  private toMenu(): void {
    this.start('attract');
  }

  private pause(): void {
    const mode = this.session?.mode;
    if (!this.session || this.ui.current !== 'hud' || mode === 'watch' || mode === 'replay') return;
    this.session.paused = true;
    this.ui.show('pause', this.session);
  }

  private togglePause(): void {
    if (this.ui.current === 'pause') this.resume();
    else this.pause();
  }

  private resume(): void {
    if (!this.session || this.ui.current !== 'pause') return;
    this.session.paused = false;
    this.ui.show('hud', this.session);
  }

  frame(deltaMs: number): SimEvent[] {
    this.fps.frame(deltaMs);
    const session = this.session;
    if (!session) return [];
    const start = new GamepadDevice(0).startPressed();
    if (start && !this.startWasDown) this.togglePause();
    this.startWasDown = start;

    const events = [...this.pendingEvents, ...session.advance(deltaMs)];
    this.pendingEvents = [];
    // Touch controls only while a touch player is actually playing (not over menus).
    const humanTouch = session.mode === 'vsBot' || session.mode === 'tutorial';
    this.touch?.setVisible(humanTouch && this.ui.current === 'hud');
    keepAwake(
      (humanTouch || session.mode === 'local2p') &&
        (this.ui.current === 'hud' || this.ui.current === 'pause'),
    );
    const audible = session.mode !== 'attract';
    if (audible) this.music.intensity = this.intensity(session);
    for (const e of events) {
      if (audible) this.playSound(e, session);
      if (humanTouch && this.settings.haptics) this.vibrate(e, session);
      if (audible && e.type === 'matchOver') this.music.play(null);
      if (e.type === 'matchOver' && session.mode === 'attract') {
        // Attract mode loops forever behind the menu.
        setTimeout(() => this.session === session && this.toMenu(), 1500);
      }
    }
    if (session.mode !== 'attract') {
      this.ui.update(session, events, deltaMs, this.keyLayouts(session));
      if (this.tutorial && session.mode === 'tutorial' && this.ui.current === 'hud') {
        if (this.tutorial.update(session.state, events, deltaMs)) this.sfx.play('pickup');
        if (this.tutorial.finished) {
          this.sfx.play('win');
          session.paused = true;
          this.ui.show('done', session);
        } else {
          const layout = this.keyLayouts(session)[0];
          this.ui.renderTutorial(
            this.tutorial.html(
              layout === 'touch'
                ? TOUCH_LABELS
                : layout === 'gamepad'
                  ? GAMEPAD_LABELS
                  : keyboardLabels(resolveKeys('solo', this.settings.keys)),
            ),
          );
        }
      }
      if (session.state.phase === 'matchOver' && this.ui.current === 'hud') {
        // Let the KO tumble (or the winning point) play out before the results.
        this.overMs += deltaMs;
        const wait = session.speed > 2 ? 0 : session.state.winReason === 'ko' ? 2800 : 1500;
        if (this.overMs < wait) return events;
        if (session.mode === 'tutorial') {
          // Ran out of points before finishing: keep the progress, start a fresh rally.
          this.start('tutorial');
          return events;
        }
        if (session.replay && !session.tuningEdited) this.saveLastReplay(session.replay);
        const ch = this.challenge;
        if (ch && session.mode === 'vsBot') {
          const passed = ch.passed(session);
          if (passed) markCompleted(ch.id);
          this.ui.challengeResult = { title: ch.title, goal: ch.goal, passed };
        }
        this.ui.show('over', session);
      }
    }
    return events;
  }

  /** 2 when the next point (or shot) can decide the match, 1 when someone is hurting. */
  private intensity(session: MatchSession): number {
    const s = session.state;
    const target = s.config.pointsToWin;
    const lead = Math.max(...s.score);
    const matchPoint = lead >= target - 1 && s.score[0] !== s.score[1];
    if (matchPoint || s.suddenDeath || s.phase === 'revenge') return 2;
    if (s.config.scheme !== 'purist' && s.players.some((p) => p.hp <= 40)) return 1;
    return lead >= target / 2 ? 1 : 0;
  }

  /** Which controls each human is using, for the on-screen key hints. */
  private keyLayouts(session: MatchSession): [KeyLayout | null, KeyLayout | null] {
    const pad = (i: number) => new GamepadDevice(i).connected();
    switch (session.mode) {
      case 'vsBot':
      case 'tutorial':
        return [this.touch ? 'touch' : pad(0) ? 'gamepad' : 'solo', null];
      case 'local2p':
        return [pad(0) ? 'gamepad' : 'p1', pad(1) ? 'gamepad' : 'p2'];
      default:
        return [null, null];
    }
  }

  /** Vibration for what happens to you (player 0) in a game you play. */
  private vibrate(e: SimEvent, session: MatchSession): void {
    switch (e.type) {
      case 'hit':
        if (e.player === 0) haptic(e.shot === 'smash' ? 'medium' : 'light');
        return;
      case 'bodyHit':
        if (e.player === 0) haptic('heavy');
        return;
      case 'explosion': {
        const me = session.state.players[0];
        if (Math.hypot(e.x - me.x, e.y - me.y) < 4) haptic('medium');
        return;
      }
      case 'ko':
        return haptic('ko');
    }
  }

  /** Only the Sports Hall has an audience. */
  private cheer(session: MatchSession, level: number): void {
    if (session.state.config.arena === 'hall') this.sfx.play('cheer', level);
  }

  private playSound(e: SimEvent, session: MatchSession): void {
    if (session.speed > 2) return;
    switch (e.type) {
      case 'swing':
        return this.sfx.play('swing');
      case 'hit':
        return this.sfx.play(e.shot === 'smash' ? 'smash' : 'hit', 0.5 + e.quality * 0.5);
      case 'net':
        return this.sfx.play('net');
      case 'land':
        return this.sfx.play('land');
      case 'bodyHit':
        return this.sfx.play('body');
      case 'point':
        this.cheer(session, 0.5);
        return this.sfx.play('point');
      case 'matchOver':
        this.cheer(session, 1);
        return this.sfx.play('win');
      case 'explosion':
        return this.sfx.play('explosion', Math.min(1.5, e.radius / 1.2));
      case 'revengeFire':
        return e.weapon ? this.sfx.play('launch') : undefined;
      case 'throw':
        return this.sfx.play('swing');
      case 'shocked':
        return this.sfx.play('zap');
      case 'mineArmed':
      case 'mineTriggered':
        return this.sfx.play('beep');
      case 'crateCollect':
      case 'heal':
      case 'shieldUp':
        return this.sfx.play('pickup');
      case 'select':
      case 'fuse':
        return this.sfx.play('tick');
      case 'ko':
        this.sfx.muffle(1300);
        this.sfx.play('thud');
        return this.sfx.play('ko');
      case 'revengeStart':
        return this.sfx.play('alarm');
    }
  }
}

function fitStage(stage: HTMLElement): void {
  const w = Math.min(window.innerWidth, (window.innerHeight * VIEW_W) / VIEW_H);
  stage.style.width = `${w}px`;
  stage.style.height = `${(w * VIEW_H) / VIEW_W}px`;
  stage.style.setProperty('--u', `${w / VIEW_W}px`);
}

const stage = document.getElementById('stage')!;
fitStage(stage);
window.addEventListener('resize', () => fitStage(stage));

const app = new App(stage);
new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  pixelArt: true,
  backgroundColor: '#181425',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { keyboard: false, gamepad: false },
  banner: false,
  scene: new MatchScene(app),
});

// Exposed for end-to-end tests and debugging.
(window as unknown as { deadminton: App; deadmintonMusic: typeof Music }).deadminton = app;
(window as unknown as { deadmintonMusic: typeof Music }).deadmintonMusic = Music;
