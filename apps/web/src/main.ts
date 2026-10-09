import '@fontsource/press-start-2p';
import './style.css';
import Phaser from 'phaser';
import type { Difficulty, Personality } from '@deadminton/bots';
import { DEFAULT_TUNING, parseReplay, replayFrames } from '@deadminton/sim';
import type { MatchConfig, Replay, SimEvent, Tuning } from '@deadminton/sim';
import { Sfx } from './audio/sfx';
import { BotController, HumanController, ReplayController } from './game/controllers';
import type { Controller } from './game/controllers';
import { MatchSession } from './game/session';
import type { SessionMode } from './game/session';
import type { InputDevice } from './input/device';
import { GamepadDevice } from './input/gamepad';
import { KeyboardDevice, P1_SPLIT_KEYS, P2_SPLIT_KEYS, SOLO_KEYS } from './input/keyboard';
import { TouchDevice, isTouchDevice } from './input/touch';
import { MatchScene } from './render/scene';
import type { SceneHost } from './render/scene';
import { VIEW_H, VIEW_W } from './render/view';
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
    showFps: true,
    muted: false,
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

  constructor(private readonly stage: HTMLElement) {
    this.ui = new Ui(stage, this.settings, {
      playBot: () => this.start('vsBot'),
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
    });
    this.touch = isTouchDevice() ? new TouchDevice(stage) : null;
    this.touch?.setVisible(false);
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
  }

  get assistMarker(): boolean {
    return this.settings.assistMarker;
  }

  private pendingEvents: SimEvent[] = [];

  private saveSettings(): void {
    this.sfx.muted = this.settings.muted;
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
    this.showIntent = false;
    this.touch?.setVisible(false);
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
      case 'vsBot': {
        const devices: InputDevice[] = [
          new KeyboardDevice(SOLO_KEYS),
          new GamepadDevice(0),
          this.mouseHit,
        ];
        if (this.touch) devices.push(this.touch);
        controllers = [
          new HumanController('YOU', devices),
          new BotController(1, s.difficulty, seed, s.style),
        ];
        break;
      }
      case 'local2p':
        controllers = [
          new HumanController('P1', [new KeyboardDevice(P1_SPLIT_KEYS), new GamepadDevice(0)]),
          new HumanController('P2', [new KeyboardDevice(P2_SPLIT_KEYS), new GamepadDevice(1)]),
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
    this.showIntent = false;
    this.touch?.setVisible(mode === 'vsBot');
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
    const audible = session.mode !== 'attract';
    for (const e of events) {
      if (audible) this.playSound(e, session);
      if (e.type === 'matchOver' && session.mode === 'attract') {
        // Attract mode loops forever behind the menu.
        setTimeout(() => this.session === session && this.toMenu(), 1500);
      }
    }
    if (session.mode !== 'attract') {
      this.ui.update(session, events, deltaMs, this.keyLayouts(session));
      if (session.state.phase === 'matchOver' && this.ui.current === 'hud') {
        if (session.replay && !session.tuningEdited) this.saveLastReplay(session.replay);
        this.ui.show('over', session);
        this.touch?.setVisible(false);
      }
    }
    return events;
  }

  /** Which controls each human is using, for the on-screen key hints. */
  private keyLayouts(session: MatchSession): [KeyLayout | null, KeyLayout | null] {
    const pad = (i: number) => new GamepadDevice(i).connected();
    switch (session.mode) {
      case 'vsBot':
        return [this.touch ? 'touch' : pad(0) ? 'gamepad' : 'solo', null];
      case 'local2p':
        return [pad(0) ? 'gamepad' : 'p1', pad(1) ? 'gamepad' : 'p2'];
      default:
        return [null, null];
    }
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
        return this.sfx.play('point');
      case 'matchOver':
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
(window as unknown as { deadminton: App }).deadminton = app;
