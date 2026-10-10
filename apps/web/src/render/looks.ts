import type { Personality } from '@deadminton/bots';
import { C } from './palette';
import type { TeamColors } from './palette';

// Player customization. Purely cosmetic: looks never reach the simulation, so they can't
// change a match or break a replay. Every option is an index into a small palette list
// (all from Endesga 32), which keeps saved looks tiny and always valid pixel art.

export type HairStyle = 'short' | 'long' | 'spiky' | 'mohawk' | 'ponytail' | 'bald';
export type Extra = 'none' | 'glasses' | 'cap' | 'wristbands';

export interface Look {
  name: string;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  kit: number;
  shorts: number;
  /** 0 = no headband. */
  band: number;
  racket: number;
  extra: Extra;
}

export const SKIN_TONES: [number, number][] = [
  [C.tan, C.beige],
  [C.beige, C.rose],
  [C.skin, C.skinDark],
  [C.skinDark, C.brown],
  [C.brown, C.darkBrown],
];

/** Shirt colors with their shade, and the "family" used to detect clashing kits. */
export const KITS: { name: string; shirt: number; shade: number; family: number }[] = [
  { name: 'RED', shirt: C.brightRed, shade: C.red, family: 0 },
  { name: 'ORANGE', shirt: C.orange, shade: C.darkRed, family: 0 },
  { name: 'PINK', shirt: C.salmon, shade: C.mauve, family: 0 },
  { name: 'YELLOW', shirt: C.yellow, shade: C.rust, family: 1 },
  { name: 'GREEN', shirt: C.green, shade: C.midGreen, family: 2 },
  { name: 'TEAL', shirt: C.cyan, shade: C.blue, family: 3 },
  { name: 'BLUE', shirt: C.blue, shade: C.navy, family: 3 },
  { name: 'NAVY', shirt: C.navy, shade: C.ink, family: 3 },
  { name: 'PURPLE', shirt: C.mauve, shade: C.purple, family: 4 },
  { name: 'WHITE', shirt: C.white, shade: C.lightGray, family: 5 },
  { name: 'GRAY', shirt: C.gray, shade: C.slate, family: 5 },
  { name: 'BLACK', shirt: C.ink, shade: C.black, family: 6 },
];

export const SHORTS = [C.darkBrown, C.ink, C.black, C.white, C.navy, C.red, C.darkGreen, C.slate];
export const HAIR = [C.black, C.darkBrown, C.brown, C.rust, C.yellow, C.lightGray, C.pink, C.cyan];
/** Index 0 means no headband. */
export const BANDS = [-1, C.yellow, C.cyan, C.white, C.brightRed, C.green, C.pink, C.orange];
export const RACKETS = [C.orange, C.cyan, C.yellow, C.green, C.pink, C.white, C.brightRed, C.mauve];
export const HAIR_STYLES: HairStyle[] = ['short', 'long', 'spiky', 'mohawk', 'ponytail', 'bald'];
export const EXTRAS: Extra[] = ['none', 'glasses', 'cap', 'wristbands'];

export const DEFAULT_LOOKS: [Look, Look] = [
  {
    name: 'YOU',
    skin: 2,
    hair: 1,
    hairStyle: 'short',
    kit: 0,
    shorts: 0,
    band: 1,
    racket: 0,
    extra: 'none',
  },
  {
    name: 'P2',
    skin: 1,
    hair: 0,
    hairStyle: 'short',
    kit: 6,
    shorts: 1,
    band: 2,
    racket: 1,
    extra: 'none',
  },
];

/** Each bot personality has its own kit, so you can tell them apart (plus an away kit). */
export const BOT_LOOKS: Record<Personality, { look: Look; away: number }> = {
  purist: {
    look: {
      name: '',
      skin: 1,
      hair: 2,
      hairStyle: 'short',
      kit: 9,
      shorts: 4,
      band: 5,
      racket: 3,
      extra: 'none',
    },
    away: 4,
  },
  balanced: {
    look: { ...DEFAULT_LOOKS[1], name: '' },
    away: 3,
  },
  berserker: {
    look: {
      name: '',
      skin: 3,
      hair: 6,
      hairStyle: 'mohawk',
      kit: 11,
      shorts: 5,
      band: 4,
      racket: 6,
      extra: 'wristbands',
    },
    away: 8,
  },
};

/** A contrasting kit for each kit, used when two players would look alike. */
function awayKit(kit: number): number {
  const family = KITS[kit]?.family ?? 0;
  // Warm kits go blue; everything else goes red, unless that's its own family.
  return family === 0 ? 6 : family === 3 ? 1 : 0;
}

export function sameFamily(a: Look, b: Look): boolean {
  return KITS[a.kit]?.family === KITS[b.kit]?.family;
}

/**
 * The second player changes kit when both would wear the same color family. `preferred`
 * is the away kit to try first (bots have their own).
 */
export function resolveClash(first: Look, second: Look, preferred?: number): Look {
  if (!sameFamily(first, second)) return second;
  const away = { ...second, kit: preferred ?? awayKit(second.kit) };
  return sameFamily(first, away) ? { ...second, kit: awayKit(first.kit) } : away;
}

export function botLook(personality: Personality): Look {
  return { ...BOT_LOOKS[personality].look };
}

/** Colors the renderer draws a player with. */
export function teamColors(look: Look, colorblind: boolean): TeamColors {
  // Colorblind mode keeps red kits apart from blue ones by showing them orange.
  const kit = KITS[colorblind && look.kit === 0 ? 1 : look.kit] ?? KITS[0]!;
  const [skin, skinDark] = SKIN_TONES[look.skin] ?? SKIN_TONES[2]!;
  const band = BANDS[look.band] ?? -1;
  return {
    shirt: kit.shirt,
    shirtShade: kit.shade,
    shorts: SHORTS[look.shorts] ?? C.darkBrown,
    band: band < 0 ? null : band,
    hair: HAIR[look.hair] ?? C.black,
    racket: RACKETS[look.racket] ?? C.orange,
    skin,
    skinDark,
    hairStyle: look.hairStyle,
    extra: look.extra,
  };
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const index = (a: readonly unknown[]) => Math.floor(Math.random() * a.length);

export function randomLook(name: string): Look {
  return {
    name,
    skin: index(SKIN_TONES),
    hair: index(HAIR),
    hairStyle: pick(HAIR_STYLES),
    kit: index(KITS),
    shorts: index(SHORTS),
    band: index(BANDS),
    racket: index(RACKETS),
    extra: pick(EXTRAS),
  };
}

/** Upper case letters, digits and spaces, at most 10 characters (the pixel font's set). */
export function cleanName(raw: string, fallback: string): string {
  const name = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10);
  return name || fallback;
}

/** Repairs a look loaded from storage or a replay file (unknown fields fall back). */
export function sanitizeLook(raw: unknown, fallback: Look): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Look, unknown>>;
  const idx = (v: unknown, list: readonly unknown[], d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < list.length ? v : d;
  return {
    name: typeof r.name === 'string' ? cleanName(r.name, fallback.name) : fallback.name,
    skin: idx(r.skin, SKIN_TONES, fallback.skin),
    hair: idx(r.hair, HAIR, fallback.hair),
    hairStyle: HAIR_STYLES.includes(r.hairStyle as HairStyle)
      ? (r.hairStyle as HairStyle)
      : fallback.hairStyle,
    kit: idx(r.kit, KITS, fallback.kit),
    shorts: idx(r.shorts, SHORTS, fallback.shorts),
    band: idx(r.band, BANDS, fallback.band),
    racket: idx(r.racket, RACKETS, fallback.racket),
    extra: EXTRAS.includes(r.extra as Extra) ? (r.extra as Extra) : fallback.extra,
  };
}
