/**
 * The rules of your game. This file is the pattern to follow; replace the
 * example below with your game.
 *
 * Pure code: no screen, no network, no clock. `step(world, dt, inputs)` takes
 * the world as it is and returns the next one, and never changes the old one.
 * Randomness comes from `world.seed`, so the same world and the same inputs
 * always give the same result. That makes the game easy to test, and lets the
 * host run the rules while guests only send input and draw what the host sends.
 *
 * The example only counts time and how many people are here.
 */

/** Everything the game needs to remember. Plain data only, so it can be sent to guests. */
export interface World {
  /** Seed for random numbers (use it, do not call Math.random in here). */
  seed: number;
  /** Seconds since the game began. */
  time: number;
  /** How many people are in the game right now. */
  here: number;
}

/** What one player is doing right now: `dx` and `dy` run from -1 to 1. */
export interface Input {
  dx: number;
  dy: number;
}

/** Input from each person, by their id. */
export type Inputs = Record<string, Input>;

/** The world at the very start. */
export function createWorld(seed: number): World {
  return { seed, time: 0, here: 0 };
}

/** One small step in time (`dt` seconds). Returns the next world. */
export function step(world: World, dt: number, inputs: Inputs): World {
  return { ...world, time: world.time + dt, here: Object.keys(inputs).length };
}
