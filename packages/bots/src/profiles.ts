export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotProfile {
  name: string;
  /** Ticks after the opponent's hit before the bot starts reading the shuttle. */
  reactionTicks: number;
  /** Max error in meters when choosing where to stand. */
  predictionError: number;
  /** Fraction of full running speed the bot uses (and plans with). */
  footwork: number;
  /** Max swing timing error in ticks. */
  timingNoise: number;
  /** Probability of choosing a sensible shot instead of a random one. */
  shotIQ: number;
  /** Probability of smashing when a smash is available. */
  aggression: number;
  /** Chance to load a weapon shuttle into a shot (and to throw a mine). */
  weaponUse: number;
  /** Revenge Turn aim error, degrees (and Air Strike cursor error × 0.05 m). */
  aimNoise: number;
  /** Revenge Turn charge error, fraction of full power. */
  powerNoise: number;
  /** Chance to notice an incoming projectile and dodge it. */
  dodge: number;
}

export const DIFFICULTIES: Record<Difficulty, BotProfile> = {
  easy: {
    name: 'Easy',
    reactionTicks: 22,
    predictionError: 0.6,
    footwork: 0.7,
    timingNoise: 2.5,
    shotIQ: 0.35,
    aggression: 0.3,
    weaponUse: 0.1,
    aimNoise: 10,
    powerNoise: 0.12,
    dodge: 0.3,
  },
  medium: {
    name: 'Medium',
    reactionTicks: 14,
    predictionError: 0.3,
    footwork: 0.85,
    timingNoise: 1.2,
    shotIQ: 0.65,
    aggression: 0.6,
    weaponUse: 0.22,
    aimNoise: 4,
    powerNoise: 0.05,
    dodge: 0.7,
  },
  hard: {
    name: 'Hard',
    reactionTicks: 6,
    predictionError: 0.05,
    footwork: 1,
    timingNoise: 0.4,
    shotIQ: 0.92,
    aggression: 0.85,
    weaponUse: 0.32,
    aimNoise: 1.2,
    powerNoise: 0.015,
    dodge: 1,
  },
};

/**
 * Personality = what the bot *wants* (difficulty = how well it plays).
 * Purist plays for points, Berserker hunts KOs, Balanced weighs the situation.
 */
export type Personality = 'purist' | 'balanced' | 'berserker';

export interface PersonalityTraits {
  name: string;
  /** Multiplier on the chance to load a weapon shuttle. */
  weaponUse: number;
  /** Multiplier on the chance to throw a mine. */
  mineUse: number;
  /** Relative weights for choosing a loaded shot. */
  loadedWeights: { frag: number; lead: number; shock: number; cluster: number; ghost: number };
  /** Extra ticks of fuse the bot wants before it dares to return a live Frag. */
  fragMargin: number;
  /** Probability of giving up the point rather than returning a Shock Shuttle when it hurts. */
  shockFear: number;
  /** Multiplier on smash aggression. */
  aggression: number;
  /**
   * Revenge Turn attitude. 'utility': heal / shield / skip unless clearly behind on points.
   * 'value': attack only when it's worth it. 'always': attack with whatever does most damage.
   */
  revenge: 'utility' | 'value' | 'always';
  /** Balanced only: scale weapon use with the situation (opponent low on HP, big lead). */
  situational: boolean;
}

export const PERSONALITIES: Record<Personality, PersonalityTraits> = {
  purist: {
    name: 'Purist',
    weaponUse: 0,
    mineUse: 0,
    loadedWeights: { frag: 0, lead: 0, shock: 0, cluster: 0, ghost: 0 },
    fragMargin: 30,
    shockFear: 1,
    aggression: 1,
    revenge: 'utility',
    situational: false,
  },
  balanced: {
    name: 'Balanced',
    weaponUse: 1,
    mineUse: 1,
    loadedWeights: { frag: 3, lead: 2, shock: 2, cluster: 1, ghost: 1 },
    fragMargin: 15,
    shockFear: 0.5,
    aggression: 1,
    revenge: 'value',
    situational: true,
  },
  berserker: {
    name: 'Berserker',
    weaponUse: 2.5,
    mineUse: 3,
    loadedWeights: { frag: 5, lead: 3, shock: 1, cluster: 2, ghost: 0 },
    fragMargin: 4,
    shockFear: 0,
    aggression: 1.25,
    revenge: 'always',
    situational: false,
  },
};

/** "hard", "hard:berserker" → difficulty + personality (default Balanced). */
export interface BotSpec {
  difficulty: Difficulty;
  personality: Personality;
}

export function parseBotSpec(text: string): BotSpec {
  const [d = 'medium', p = 'balanced'] = text.split(':');
  if (!(d in DIFFICULTIES))
    throw new Error(`Unknown difficulty "${d}". Use: ${Object.keys(DIFFICULTIES).join(', ')}`);
  if (!(p in PERSONALITIES))
    throw new Error(`Unknown personality "${p}". Use: ${Object.keys(PERSONALITIES).join(', ')}`);
  return { difficulty: d as Difficulty, personality: p as Personality };
}
