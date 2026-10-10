import { describe, expect, it } from 'vitest';
import {
  BOT_LOOKS,
  DEFAULT_LOOKS,
  KITS,
  botLook,
  cleanName,
  randomLook,
  resolveClash,
  sameFamily,
  sanitizeLook,
  teamColors,
} from '../src/render/looks';

describe('player looks', () => {
  it('cleans names to what the pixel font can show', () => {
    expect(cleanName('  marcin  g!', 'YOU')).toBe('MARCIN G');
    expect(cleanName('abcdefghijklmnop', 'YOU')).toBe('ABCDEFGHIJ');
    expect(cleanName('!!!', 'YOU')).toBe('YOU');
  });

  it('repairs looks from storage or replay files', () => {
    const fallback = DEFAULT_LOOKS[0];
    expect(sanitizeLook(null, fallback)).toEqual(fallback);
    const bad = sanitizeLook(
      { kit: 99, hairStyle: 'afro', name: 'ok', skin: 4, extra: 'cap' },
      fallback,
    );
    expect(bad.kit).toBe(fallback.kit);
    expect(bad.hairStyle).toBe(fallback.hairStyle);
    expect(bad.skin).toBe(4);
    expect(bad.extra).toBe('cap');
    expect(bad.name).toBe('OK');
  });

  it('the second player changes kit when both would look alike', () => {
    const me = { ...DEFAULT_LOOKS[0], kit: 11 }; // black
    const bot = resolveClash(me, botLook('berserker'), BOT_LOOKS.berserker.away);
    expect(sameFamily(me, bot)).toBe(false);
    // Different colors are left alone.
    const blue = resolveClash(DEFAULT_LOOKS[0], DEFAULT_LOOKS[1]);
    expect(blue.kit).toBe(DEFAULT_LOOKS[1].kit);
    // Every possible pair ends up distinguishable.
    for (let a = 0; a < KITS.length; a++)
      for (let b = 0; b < KITS.length; b++) {
        const first = { ...DEFAULT_LOOKS[0], kit: a };
        expect(sameFamily(first, resolveClash(first, { ...DEFAULT_LOOKS[1], kit: b }))).toBe(false);
      }
  });

  it('turns any look into drawable colors; colorblind mode shows red kits orange', () => {
    for (let i = 0; i < 50; i++) {
      const c = teamColors(randomLook('X'), false);
      for (const v of [c.shirt, c.shirtShade, c.shorts, c.hair, c.racket, c.skin, c.skinDark])
        expect(Number.isInteger(v)).toBe(true);
    }
    expect(teamColors(DEFAULT_LOOKS[0], true).shirt).toBe(KITS[1]!.shirt);
    expect(teamColors({ ...DEFAULT_LOOKS[0], band: 0 }, false).band).toBeNull();
  });
});
