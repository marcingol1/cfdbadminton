import { describe, expect, it } from 'vitest';
import { parseBotSpec, runBotMatch } from '../src';
import type { BotSpec } from '../src';

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Weapon uses per rally, in Chaos so ammo limits don't hide the difference. */
function weaponRate(spec: BotSpec, matches = 10): number {
  let uses = 0;
  let rallies = 0;
  for (let seed = 1; seed <= matches; seed++) {
    const r = runBotMatch(spec, { difficulty: 'medium', personality: 'purist' }, seed * 31, {
      pointsToWin: 7,
      scheme: 'chaos',
    });
    uses += total(r.weapons);
    rallies += r.rallies;
  }
  return uses / rallies;
}

describe('bot personalities', () => {
  it('parses difficulty:personality specs', () => {
    expect(parseBotSpec('hard')).toEqual({ difficulty: 'hard', personality: 'balanced' });
    expect(parseBotSpec('easy:berserker')).toEqual({
      difficulty: 'easy',
      personality: 'berserker',
    });
    expect(() => parseBotSpec('hard:pacifist')).toThrow(/personality/);
  });

  it('a Purist never loads a weapon or throws a mine', () => {
    const r = runBotMatch(
      { difficulty: 'hard', personality: 'purist' },
      { difficulty: 'hard', personality: 'purist' },
      7,
      { pointsToWin: 7 },
    );
    expect(total(r.weapons)).toBe(0);
    expect(r.winReason).toBe('points');
  });

  it('a Berserker uses far more weapons than a Balanced bot', () => {
    const berserker = weaponRate({ difficulty: 'medium', personality: 'berserker' });
    const balanced = weaponRate({ difficulty: 'medium', personality: 'balanced' });
    // Measured over 20 matches: about 1.45× (1.25 vs 0.87 weapons per rally).
    expect(berserker).toBeGreaterThan(balanced * 1.3);
  });

  it('a Purist with Revenge Turns on patches up instead of shooting while ahead', () => {
    const r = runBotMatch(
      { difficulty: 'medium', personality: 'purist' },
      { difficulty: 'medium', personality: 'purist' },
      3,
      { pointsToWin: 7, revengeTurns: true, revengeChance: 1 },
    );
    const shots = (r.weapons.rocket ?? 0) + (r.weapons.mortar ?? 0) + (r.weapons.homing ?? 0);
    const calm = (r.weapons.skip ?? 0) + (r.weapons.medkit ?? 0) + (r.weapons.shield ?? 0);
    expect(calm).toBeGreaterThan(shots);
  });
});
