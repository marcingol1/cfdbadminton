// Endesga 32 (lospec.com/palette-list/endesga-32), free to use. Every pixel comes from here.
export const C = {
  darkRed: 0xbe4a2f,
  rust: 0xd77643,
  tan: 0xead4aa,
  skin: 0xe4a672,
  skinDark: 0xb86f50,
  brown: 0x733e39,
  darkBrown: 0x3e2731,
  red: 0xa22633,
  brightRed: 0xe43b44,
  orange: 0xf77622,
  yellow: 0xfeae34,
  paleYellow: 0xfee761,
  green: 0x63c74d,
  midGreen: 0x3e8948,
  darkGreen: 0x265c42,
  deepGreen: 0x193c3e,
  navy: 0x124e89,
  blue: 0x0099db,
  cyan: 0x2ce8f5,
  white: 0xffffff,
  lightGray: 0xc0cbdc,
  gray: 0x8b9bb4,
  slate: 0x5a6988,
  darkSlate: 0x3a4466,
  ink: 0x262b44,
  black: 0x181425,
  pink: 0xff0044,
  purple: 0x68386c,
  mauve: 0xb55088,
  salmon: 0xf6757a,
  beige: 0xe8b796,
  rose: 0xc28569,
} as const;

export interface TeamColors {
  shirt: number;
  shirtShade: number;
  shorts: number;
  band: number;
  hair: number;
  racket: number;
}

export const TEAMS: [TeamColors, TeamColors] = [
  {
    shirt: C.brightRed,
    shirtShade: C.red,
    shorts: C.darkBrown,
    band: C.yellow,
    hair: C.darkBrown,
    racket: C.orange,
  },
  { shirt: C.blue, shirtShade: C.navy, shorts: C.ink, band: C.cyan, hair: C.black, racket: C.cyan },
];

const STANDARD: [TeamColors, TeamColors] = [{ ...TEAMS[0] }, { ...TEAMS[1] }];

/** Orange vs cyan reads apart under every common color vision deficiency. */
const COLORBLIND: [TeamColors, TeamColors] = [
  {
    shirt: C.orange,
    shirtShade: C.darkRed,
    shorts: C.darkBrown,
    band: C.paleYellow,
    hair: C.darkBrown,
    racket: C.yellow,
  },
  { ...STANDARD[1] },
];

/** HP bar colors (healthy, hurt, critical). */
export const HP_COLORS = {
  ok: C.green as number,
  warn: C.yellow as number,
  low: C.brightRed as number,
};

export type ColorMode = 'standard' | 'colorblind';

/** Switches team and HP colors everywhere (canvas and HTML). */
export function setColorMode(mode: ColorMode): void {
  const teams = mode === 'colorblind' ? COLORBLIND : STANDARD;
  Object.assign(TEAMS[0], teams[0]);
  Object.assign(TEAMS[1], teams[1]);
  Object.assign(
    HP_COLORS,
    mode === 'colorblind'
      ? { ok: C.blue, warn: C.paleYellow, low: C.pink }
      : { ok: C.green, warn: C.yellow, low: C.brightRed },
  );
  document.documentElement.classList.toggle('cb', mode === 'colorblind');
}

export const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
