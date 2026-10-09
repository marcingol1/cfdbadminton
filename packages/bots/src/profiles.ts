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
  },
  medium: {
    name: 'Medium',
    reactionTicks: 14,
    predictionError: 0.3,
    footwork: 0.85,
    timingNoise: 1.2,
    shotIQ: 0.65,
    aggression: 0.6,
  },
  hard: {
    name: 'Hard',
    reactionTicks: 6,
    predictionError: 0.05,
    footwork: 1,
    timingNoise: 0.4,
    shotIQ: 0.92,
    aggression: 0.85,
  },
};
