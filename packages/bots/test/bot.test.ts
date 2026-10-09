import { describe, expect, it } from 'vitest';
import { runBotMatch } from '../src';

describe('bots', () => {
  it('bot-vs-bot matches always finish with a valid winner and sane state', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = runBotMatch('medium', 'medium', seed * 101, { pointsToWin: 7 });
      expect(r.winner === 0 || r.winner === 1).toBe(true);
      expect(Math.max(...r.score)).toBeGreaterThanOrEqual(7);
      expect(r.hits).toBeGreaterThan(r.rallies);
      const s = r.final;
      for (const n of [s.shuttle.x, s.shuttle.y, s.players[0].x, s.players[1].x])
        expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('hard beats easy', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 6; seed++)
      if (runBotMatch('easy', 'hard', seed, { pointsToWin: 7 }).winner === 1) hardWins++;
    expect(hardWins).toBeGreaterThanOrEqual(5);
  });
});
