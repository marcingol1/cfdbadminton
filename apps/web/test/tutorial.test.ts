import { describe, expect, it } from 'vitest';
import { createMatch } from '@deadminton/sim';
import type { SimEvent } from '@deadminton/sim';
import { TOUCH_LABELS, TUTORIAL_CONFIG, Tutorial, keyboardLabels } from '../src/game/tutorial';
import { resolveKeys } from '../src/input/keyboard';

const hit = (shot: string, player: 0 | 1 = 0): SimEvent =>
  ({ type: 'hit', player, shot, quality: 1, x: 0, y: 2, speed: 10, weapon: null }) as SimEvent;

describe('tutorial', () => {
  it('walks through every step on the matching actions', () => {
    const t = new Tutorial();
    const s = createMatch(TUTORIAL_CONFIG, 1);
    const advance = (events: SimEvent[] = []) => {
      t.update(s, events, 16);
      t.update(s, [], 1000); // the "NICE!" pause
    };
    // MOVE: 4 m of running.
    for (let x = -3; x <= 2; x += 0.5) {
      s.players[0].x = x;
      t.update(s, [], 16);
    }
    t.update(s, [], 1000);
    expect(t.index).toBe(1);
    // JUMP.
    s.players[0].grounded = false;
    s.players[0].vy = 3;
    advance();
    s.players[0].grounded = true;
    expect(t.index).toBe(2);
    advance([hit('serveHigh')]);
    expect(t.index).toBe(3);
    // RALLY: three returns, the bot's hits don't count.
    advance([hit('clear'), hit('clear', 1)]);
    expect(t.index).toBe(3);
    advance([hit('drive'), hit('drop')]);
    expect(t.index).toBe(4);
    advance([hit('drop')]);
    expect(t.index).toBe(4); // CLEAR wants a clear
    advance([hit('clear')]);
    advance([hit('netShot')]);
    advance([hit('smash')]);
    expect(t.index).toBe(7);
    advance([{ type: 'loaded', player: 0, weapon: 'frag' }]);
    advance([{ type: 'point', winner: 1, reason: 'in', score: [0, 1] }]);
    expect(t.finished).toBe(false);
    advance([{ type: 'point', winner: 0, reason: 'in', score: [1, 1] }]);
    expect(t.finished).toBe(true);
  });

  it('shows the player their own keys', () => {
    const t = new Tutorial();
    const keys = resolveKeys('solo', { solo: { left: ['KeyH'], right: ['KeyL'] } });
    expect(t.html(keyboardLabels(keys))).toContain('H / L');
    expect(t.html(keyboardLabels(keys))).toContain('1/9');
    expect(t.html(TOUCH_LABELS)).toContain('with the stick');
  });
});
