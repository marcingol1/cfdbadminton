import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, keyLabel, rebind, resolveKeys } from '../src/input/keyboard';
import type { KeyOverrides } from '../src/input/keyboard';

describe('key remapping', () => {
  it('uses the defaults until something is changed', () => {
    expect(resolveKeys('solo', {})).toEqual(DEFAULT_KEYS.solo);
  });

  it('binds a free key to an action', () => {
    const o: KeyOverrides = {};
    rebind(o, 'solo', 'hit', 'KeyL');
    expect(resolveKeys('solo', o).hit).toEqual(['KeyL']);
    expect(resolveKeys('p1', o)).toEqual(DEFAULT_KEYS.p1);
  });

  it('moves a taken key and gives the other action the old key', () => {
    const o: KeyOverrides = {};
    // K is FIRE in the solo layout; binding it to SWING hands FIRE the old swing key (J).
    rebind(o, 'solo', 'hit', 'KeyK');
    const keys = resolveKeys('solo', o);
    expect(keys.hit).toEqual(['KeyK']);
    expect(keys.fire).toEqual(['KeyJ']);
  });

  it('keeps the other keys of a multi-key action', () => {
    const o: KeyOverrides = {};
    // Left is A or ←; taking ← for JUMP leaves A on LEFT.
    rebind(o, 'solo', 'jump', 'ArrowLeft');
    const keys = resolveKeys('solo', o);
    expect(keys.jump).toEqual(['ArrowLeft']);
    expect(keys.left).toEqual(['KeyA']);
  });

  it('never leaves an action without a key', () => {
    const o: KeyOverrides = {};
    for (const code of ['KeyJ', 'KeyK', 'KeyQ', 'KeyE', 'KeyR', 'Space'])
      rebind(o, 'solo', 'hit', code);
    const keys = resolveKeys('solo', o);
    for (const codes of Object.values(keys)) expect(codes.length).toBeGreaterThan(0);
  });

  it('names keys for the screen', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('ShiftLeft')).toBe('L-SHIFT');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Digit5')).toBe('5');
    expect(keyLabel('Numpad0')).toBe('NUM0');
    expect(keyLabel(undefined)).toBe('—');
  });
});
