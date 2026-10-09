// sfc32: small, fast, good-quality 32-bit PRNG using only integer ops (deterministic everywhere).
// The state lives inside MatchState so snapshots and replays capture it.

export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  const rng: RngState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  for (let i = 0; i < 16; i++) nextU32(rng);
  return rng;
}

export function nextU32(rng: RngState): number {
  let [a, b, c, d] = rng;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  rng[0] = a;
  rng[1] = b;
  rng[2] = c;
  rng[3] = d;
  return t >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: RngState): number {
  return nextU32(rng) / 4294967296;
}

/** Uniform float in [lo, hi). */
export function nextRange(rng: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(rng);
}

/** Uniform integer in [lo, hi]. */
export function nextInt(rng: RngState, lo: number, hi: number): number {
  return lo + (nextU32(rng) % (hi - lo + 1));
}
