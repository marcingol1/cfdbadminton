import { Bot } from '@deadminton/bots';
import type { Difficulty } from '@deadminton/bots';
import { NEUTRAL_INPUT } from '@deadminton/sim';
import type { InputFrame, MatchState, PlayerId } from '@deadminton/sim';
import type { InputDevice } from '../input/device';

/** Anything that produces one InputFrame per tick for one player. */
export interface Controller {
  readonly kind: 'human' | 'bot';
  readonly label: string;
  sample(state: MatchState): InputFrame;
}

export class HumanController implements Controller {
  readonly kind = 'human';
  constructor(
    readonly label: string,
    private readonly devices: InputDevice[],
  ) {}

  sample(): InputFrame {
    let moveX = 0;
    let moveY = 0;
    let buttons = 0;
    for (const d of this.devices) {
      const f = d.sample();
      if (Math.abs(f.moveX) > Math.abs(moveX)) moveX = f.moveX;
      if (Math.abs(f.moveY) > Math.abs(moveY)) moveY = f.moveY;
      buttons |= f.buttons;
    }
    return moveX === 0 && moveY === 0 && buttons === 0 ? NEUTRAL_INPUT : { moveX, moveY, buttons };
  }
}

export class BotController implements Controller {
  readonly kind = 'bot';
  readonly bot: Bot;
  readonly label: string;
  constructor(id: PlayerId, difficulty: Difficulty, seed: number) {
    this.bot = new Bot(id, difficulty, seed);
    this.label = `BOT ${this.bot.profile.name.toUpperCase()}`;
  }

  sample(state: MatchState): InputFrame {
    return this.bot.think(state);
  }
}
