import { describe, expect, it } from 'vitest';
import { createWorld, step } from './rules';

// Tests for the rules. Add one for every rule your game has.
describe('rules', () => {
  it('starts empty, at time zero', () => {
    expect(createWorld(1)).toEqual({ seed: 1, time: 0, here: 0 });
  });

  it('counts time', () => {
    let w = createWorld(1);
    for (let i = 0; i < 60; i++) w = step(w, 1 / 60, {});
    expect(w.time).toBeCloseTo(1, 5);
  });

  it('counts who is here', () => {
    const w = step(createWorld(1), 0, { a: { dx: 0, dy: 0 }, b: { dx: 1, dy: 0 } });
    expect(w.here).toBe(2);
  });

  it('returns a new world and leaves the old one alone', () => {
    const before = createWorld(7);
    const after = step(before, 1, {});
    expect(after).not.toBe(before);
    expect(before.time).toBe(0);
  });
});
