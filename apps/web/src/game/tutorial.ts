import type { MatchConfig, MatchState, SimEvent } from '@deadminton/sim';
import { keyLabel } from '../input/keyboard';
import type { KeyMap } from '../input/keyboard';

/** The tutorial is a real match against an Easy Purist bot with a checklist on top. */
export const TUTORIAL_CONFIG: Partial<MatchConfig> = {
  pointsToWin: 21,
  scheme: 'standard',
  arena: 'hall',
  bestOf: 1,
  revengeTurns: false,
};

interface Progress {
  moved: number;
  lastX: number | null;
  count: number;
}

interface Step {
  title: string;
  text: (k: ControlLabels) => string;
  /** Called every frame with this frame's events; true once the step is done. */
  done: (p: Progress, events: SimEvent[], s: MatchState) => boolean;
}

/** How to name each control in the instructions, for the device the player uses. */
export interface ControlLabels {
  move: string;
  jump: string;
  hit: string;
  up: string;
  down: string;
  forward: string;
  weapon: string;
}

/** Keyboard labels from the player's (possibly remapped) keys. */
export function keyboardLabels(k: KeyMap): ControlLabels {
  const one = (codes: string[]) => keyLabel(codes[0]);
  return {
    move: `${one(k.left)} / ${one(k.right)}`,
    jump: one(k.jump),
    hit: one(k.hit),
    up: one(k.up),
    down: one(k.down),
    forward: `${one(k.right)} (toward the net)`,
    weapon: `${one(k.prev)} / ${one(k.next)}`,
  };
}

export const TOUCH_LABELS: ControlLabels = {
  move: 'the stick',
  jump: 'JUMP',
  hit: 'HIT',
  up: 'the stick up',
  down: 'the stick down',
  forward: 'the stick toward the net',
  weapon: 'WPN',
};

export const GAMEPAD_LABELS: ControlLabels = {
  move: 'the left stick',
  jump: 'A',
  hit: 'X',
  up: 'the stick up',
  down: 'the stick down',
  forward: 'the stick toward the net',
  weapon: 'LB / RB',
};
const myHits = (events: SimEvent[]) =>
  events.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.player === 0);

const STEPS: Step[] = [
  {
    title: 'MOVE',
    text: (k) => `Run left and right with ${k.move}.`,
    done: (p, _e, s) => {
      const x = s.players[0].x;
      if (p.lastX !== null) p.moved += Math.abs(x - p.lastX);
      p.lastX = x;
      return p.moved > 4;
    },
  },
  {
    title: 'JUMP',
    text: (k) => `Jump with ${k.jump}. Jumping lets you reach high shuttles.`,
    done: (_p, _e, s) => !s.players[0].grounded && s.players[0].vy > 0,
  },
  {
    title: 'HIT IT',
    text: (k) =>
      `Swing with ${k.hit} when the shuttle is near your racket. Serve when it's in your hand.`,
    done: (_p, e) => myHits(e).length > 0,
  },
  {
    title: 'RALLY',
    text: (k) =>
      `Return the shuttle 3 times. Timing matters: a well-timed ${k.hit} is more accurate.`,
    done: (p, e) => (p.count += myHits(e).length) >= 3,
  },
  {
    title: 'CLEAR',
    text: (k) => `Hold ${k.up} while you swing: a high, deep CLEAR to push the bot back.`,
    done: (_p, e) => myHits(e).some((h) => h.shot === 'clear' || h.shot === 'lift'),
  },
  {
    title: 'DROP',
    text: (k) => `Hold ${k.down} while you swing: a soft DROP that falls just over the net.`,
    done: (_p, e) => myHits(e).some((h) => h.shot === 'drop' || h.shot === 'netShot'),
  },
  {
    title: 'SMASH',
    text: (k) =>
      `When the shuttle is high, hold ${k.forward} and swing: SMASH! Jump for a steeper one.`,
    done: (_p, e) => myHits(e).some((h) => h.shot === 'smash'),
  },
  {
    title: 'LOADED SHUTTLE',
    text: (k) =>
      `Press ${k.weapon} to load a weapon (top left), then hit the shuttle. Not on a serve!`,
    done: (_p, e) => e.some((x) => x.type === 'loaded' && x.player === 0),
  },
  {
    title: 'WIN A POINT',
    text: () =>
      'Land the shuttle on the bot’s side, or make it miss. Two ways to win: points or K.O.',
    done: (_p, e) => e.some((x) => x.type === 'point' && x.winner === 0),
  },
];

export class Tutorial {
  index = 0;
  private progress: Progress = { moved: 0, lastX: null, count: 0 };
  /** Time the "done!" flash stays up before the next step. */
  private doneMs = 0;

  get total(): number {
    return STEPS.length;
  }

  get finished(): boolean {
    return this.index >= STEPS.length;
  }

  /** Advances on this frame's events. Returns true when a step was just completed. */
  update(state: MatchState, events: SimEvent[], deltaMs: number): boolean {
    if (this.finished) return false;
    if (this.doneMs > 0) {
      this.doneMs -= deltaMs;
      if (this.doneMs <= 0) {
        this.index++;
        this.progress = { moved: 0, lastX: null, count: 0 };
      }
      return false;
    }
    if (STEPS[this.index]!.done(this.progress, events, state)) {
      this.doneMs = 900;
      return true;
    }
    return false;
  }

  /** Panel HTML: step counter, title and instruction (with the player's own keys). */
  html(keys: ControlLabels): string {
    if (this.finished) return '';
    const step = STEPS[this.index]!;
    const done = this.doneMs > 0;
    const dots = STEPS.map((_, i) =>
      i < this.index || (i === this.index && done) ? '●' : i === this.index ? '◉' : '○',
    ).join('');
    return `<div class="step"><span>${this.index + 1}/${STEPS.length} · ${step.title}</span><span class="dots">${dots}</span></div>
      <p>${done ? 'NICE! ✓' : step.text(keys)}</p>`;
  }
}
