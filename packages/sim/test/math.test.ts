import { describe, expect, it } from 'vitest';
import { atan, atan2, cos, hashValue, nextFloat, nextInt, seedRng, sin } from '../src';

describe('deterministic math', () => {
  it('sin/cos match Math within 1e-10 over many periods', () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-10);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-10);
    }
  });

  it('atan and atan2 match Math in every quadrant', () => {
    for (let x = -20; x <= 20; x += 0.0173)
      expect(Math.abs(atan(x) - Math.atan(x))).toBeLessThan(1e-11);
    for (let a = 0; a < 2 * Math.PI; a += 0.01) {
      const y = Math.sin(a) * 3;
      const x = Math.cos(a) * 3;
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-11);
    }
    expect(atan2(0, 0)).toBe(0);
  });
});

describe('PRNG', () => {
  it('is reproducible from a seed and differs between seeds', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    const c = seedRng(43);
    const seqA = Array.from({ length: 50 }, () => nextFloat(a));
    expect(Array.from({ length: 50 }, () => nextFloat(b))).toEqual(seqA);
    expect(Array.from({ length: 50 }, () => nextFloat(c))).not.toEqual(seqA);
  });

  it('stays in range', () => {
    const r = seedRng(7);
    for (let i = 0; i < 10000; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(r, 3, 5);
      expect(n === 3 || n === 4 || n === 5).toBe(true);
    }
  });
});

describe('hashValue', () => {
  it('is key-order independent and sensitive to the last bit of a float', () => {
    expect(hashValue({ a: 1, b: [2, 'x'] })).toBe(hashValue({ b: [2, 'x'], a: 1 }));
    expect(hashValue({ a: 0.1 + 0.2 })).not.toBe(hashValue({ a: 0.3 }));
  });
});
