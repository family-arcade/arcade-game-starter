/**
 * Star Catch: the rules. Pure code: no screen, no network, no clock.
 *
 * `step(world, dt, inputs)` takes the world as it is and returns the next one.
 * Randomness comes from `world.seed`, so the same world and the same inputs
 * always give the same result. That makes the game easy to test, and lets the
 * host run the game while guests only draw what the host sends.
 *
 * Things to change: the numbers just below (a good first experiment).
 */

export const WIDTH = 600;
export const HEIGHT = 720;

export const WIN_SCORE = 10;
export const TIME_LIMIT = 60; // seconds
export const BLOB_RADIUS = 28;
export const BLOB_SPEED = 330; // pixels per second at full push
export const BOT_SPEED = 0.7; // the computer blob is a bit slower
export const STAR_RADIUS = 16;
export const MAX_STARS = 8;
export const STEP = 1 / 60;

export interface Blob {
  id: string;
  name: string;
  colour: string;
  x: number;
  y: number;
  score: number;
  /** true for the computer blob */
  bot: boolean;
}

export interface Star {
  id: number;
  x: number;
  y: number;
  vy: number;
}

export type Phase = 'ready' | 'playing' | 'over';

export interface World {
  phase: Phase;
  /** seconds played this round */
  time: number;
  blobs: Blob[];
  stars: Star[];
  nextStarId: number;
  /** seconds until the next star appears */
  spawnIn: number;
  /** random number state; step() advances it */
  seed: number;
  /** ids of the winner(s) once phase is 'over' */
  winners: string[];
}

/** What a player is pushing: -1 to 1 on each axis (left/up are negative). */
export interface Input {
  dx: number;
  dy: number;
}
export type Inputs = Record<string, Input | undefined>;

export interface Seat {
  id: string;
  name: string;
  colour: string;
}

export const BOT_ID = 'bot';
export const BOT_SEAT: Seat = { id: BOT_ID, name: 'Computer', colour: '#8a93a6' };

/** mulberry32 as a pure function: returns the number and the next seed. */
export function nextRandom(seed: number): [number, number] {
  let a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function startSpot(index: number): { x: number; y: number } {
  const xs = [0.5, 0.2, 0.8, 0.35, 0.65];
  return { x: WIDTH * xs[index % xs.length], y: HEIGHT - BLOB_RADIUS - 24 };
}

function makeBlob(seat: Seat, index: number): Blob {
  return { id: seat.id, name: seat.name, colour: seat.colour, ...startSpot(index), score: 0, bot: seat.id === BOT_ID };
}

/**
 * A fresh world waiting to start. If only one person is playing, a computer
 * blob joins them so there is someone to race.
 */
export function newWorld(seed: number, seats: Seat[]): World {
  const all = seats.length === 1 ? [...seats, BOT_SEAT] : seats;
  return {
    phase: 'ready',
    time: 0,
    blobs: all.map(makeBlob),
    stars: [],
    nextStarId: 1,
    spawnIn: 0.4,
    seed: seed >>> 0,
    winners: [],
  };
}

/** Begin the round: everyone back to 0, stars start falling. */
export function startRound(world: World): World {
  return {
    ...world,
    phase: 'playing',
    time: 0,
    stars: [],
    spawnIn: 0.4,
    winners: [],
    blobs: world.blobs.map((b, i) => ({ ...b, score: 0, ...startSpot(i) })),
  };
}

/** A computer blob keeps a lone player company; with two or more people it leaves. */
function settleBot(world: World): World {
  const humans = world.blobs.filter((b) => !b.bot);
  const hasBot = world.blobs.some((b) => b.bot);
  if (humans.length === 1 && !hasBot) return { ...world, blobs: [...humans, makeBlob(BOT_SEAT, 1)] };
  if (humans.length !== 1 && hasBot) return { ...world, blobs: humans };
  return world;
}

/** Someone joined. They start at 0 wherever there is room. */
export function addBlob(world: World, seat: Seat): World {
  if (world.blobs.some((b) => b.id === seat.id)) return world;
  const humans = world.blobs.filter((b) => !b.bot);
  return settleBot({ ...world, blobs: [...world.blobs, makeBlob(seat, humans.length)] });
}

/** Someone left. */
export function removeBlob(world: World, id: string): World {
  return settleBot({ ...world, blobs: world.blobs.filter((b) => b.id !== id) });
}

function botInput(bot: Blob, stars: Star[]): Input {
  let best: Star | null = null;
  let bestDist = Infinity;
  for (const s of stars) {
    // Prefer stars it can still reach: lower on the screen is more urgent.
    const d = Math.hypot(s.x - bot.x, s.y - bot.y) - s.y * 0.15;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best) return { dx: 0, dy: 0 };
  const gap = best.x - bot.x;
  return { dx: clamp(gap / 20, -1, 1) * BOT_SPEED, dy: 0 };
}

/** Advance the world by `dt` seconds. Returns a new world; the old one is untouched. */
export function step(world: World, dt: number, inputs: Inputs): World {
  if (world.phase !== 'playing') return world;

  let seed = world.seed;
  const rand = () => {
    const [v, s] = nextRandom(seed);
    seed = s;
    return v;
  };

  // 1. move the blobs
  const blobs = world.blobs.map((b) => {
    const input = b.bot ? botInput(b, world.stars) : (inputs[b.id] ?? { dx: 0, dy: 0 });
    let dx = clamp(Number.isFinite(input.dx) ? input.dx : 0, -1, 1);
    let dy = clamp(Number.isFinite(input.dy) ? input.dy : 0, -1, 1);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    return {
      ...b,
      x: clamp(b.x + dx * BLOB_SPEED * dt, BLOB_RADIUS, WIDTH - BLOB_RADIUS),
      y: clamp(b.y + dy * BLOB_SPEED * dt, BLOB_RADIUS, HEIGHT - BLOB_RADIUS),
    };
  });

  // 2. stars fall; a star touching a blob is caught by the nearest one
  const stars: Star[] = [];
  for (const s of world.stars) {
    const star = { ...s, y: s.y + s.vy * dt };
    let catcher: Blob | null = null;
    let nearest = Infinity;
    for (const b of blobs) {
      const d = Math.hypot(star.x - b.x, star.y - b.y);
      if (d < BLOB_RADIUS + STAR_RADIUS && d < nearest) {
        nearest = d;
        catcher = b;
      }
    }
    if (catcher) catcher.score += 1;
    else if (star.y < HEIGHT + STAR_RADIUS) stars.push(star);
  }

  // 3. new stars appear at the top
  let nextStarId = world.nextStarId;
  let spawnIn = world.spawnIn - dt;
  while (spawnIn <= 0) {
    if (stars.length < MAX_STARS) {
      stars.push({
        id: nextStarId++,
        x: STAR_RADIUS + rand() * (WIDTH - 2 * STAR_RADIUS),
        y: -STAR_RADIUS,
        vy: 110 + rand() * 90,
      });
    }
    spawnIn += 0.45 + rand() * 0.5;
  }

  // 4. is it over?
  const time = world.time + dt;
  const top = Math.max(...blobs.map((b) => b.score));
  const over = top >= WIN_SCORE || time >= TIME_LIMIT;
  return {
    ...world,
    blobs,
    stars,
    nextStarId,
    spawnIn,
    seed,
    time: over ? Math.min(time, TIME_LIMIT) : time,
    phase: over ? 'over' : 'playing',
    winners: over && top > 0 ? blobs.filter((b) => b.score === top).map((b) => b.id) : [],
  };
}
