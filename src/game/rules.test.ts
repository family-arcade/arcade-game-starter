import { describe, expect, it } from 'vitest';
import {
  BLOB_RADIUS,
  BLOB_SPEED,
  BOT_ID,
  HEIGHT,
  STEP,
  TIME_LIMIT,
  WIDTH,
  WIN_SCORE,
  addBlob,
  newWorld,
  removeBlob,
  startRound,
  step,
  type Inputs,
  type Seat,
  type World,
} from './rules';

const klara: Seat = { id: 'host', name: 'Klara', colour: '#e0405f' };
const zoe: Seat = { id: 'g1', name: 'Zoë', colour: '#3d6bd6' };

function run(world: World, seconds: number, inputs: Inputs | ((w: World) => Inputs) = {}): World {
  let w = world;
  for (let i = 0; i < Math.round(seconds / STEP) && w.phase === 'playing'; i++) {
    w = step(w, STEP, typeof inputs === 'function' ? inputs(w) : inputs);
  }
  return w;
}

const playing = (seats: Seat[], seed = 1) => startRound(newWorld(seed, seats));

describe('newWorld / startRound', () => {
  it('waits in "ready" until the round starts', () => {
    const w = newWorld(1, [klara, zoe]);
    expect(w.phase).toBe('ready');
    expect(step(w, STEP, {})).toBe(w);
    expect(startRound(w).phase).toBe('playing');
  });

  it('a lone player gets a computer blob; two people do not', () => {
    expect(newWorld(1, [klara]).blobs.map((b) => b.id)).toEqual(['host', BOT_ID]);
    expect(newWorld(1, [klara, zoe]).blobs.map((b) => b.id)).toEqual(['host', 'g1']);
  });

  it('blobs get their player colour and name, and start apart on the floor', () => {
    const [a, b] = newWorld(1, [klara, zoe]).blobs;
    expect(a).toMatchObject({ name: 'Klara', colour: '#e0405f', score: 0 });
    expect(b.colour).toBe('#3d6bd6');
    expect(a.x).not.toBe(b.x);
    expect(a.y).toBeGreaterThan(HEIGHT / 2);
  });

  it('startRound zeroes scores and clears stars', () => {
    const w = run(playing([klara, zoe]), 5);
    expect(w.stars.length).toBeGreaterThan(0);
    const again = startRound({ ...w, blobs: w.blobs.map((b) => ({ ...b, score: 4 })), phase: 'over' });
    expect(again.blobs.every((b) => b.score === 0)).toBe(true);
    expect(again.stars).toEqual([]);
    expect(again.phase).toBe('playing');
  });
});

describe('step is pure and seeded', () => {
  it('does not change the world it was given', () => {
    const w = playing([klara, zoe]);
    const before = JSON.stringify(w);
    step(w, STEP, { host: { dx: 1, dy: 0 } });
    expect(JSON.stringify(w)).toBe(before);
  });

  it('the same seed and inputs always give the same game', () => {
    const inputs = { host: { dx: 0.5, dy: 0 } };
    const a = run(playing([klara, zoe], 42), 10, inputs);
    const b = run(playing([klara, zoe], 42), 10, inputs);
    expect(a).toEqual(b);
    expect(run(playing([klara, zoe], 43), 10, inputs)).not.toEqual(a);
  });

  it('stars appear at the top and fall', () => {
    const w = run(playing([klara, zoe]), 1);
    expect(w.stars.length).toBeGreaterThan(0);
    const first = w.stars[0];
    const next = step(w, STEP, {});
    expect(next.stars.find((s) => s.id === first.id)!.y).toBeGreaterThan(first.y);
  });

  it('never has more than 8 stars, and stars leave at the bottom', () => {
    let w = playing([klara, zoe]);
    let most = 0;
    for (let i = 0; i < 60 * 20 && w.phase === 'playing'; i++) {
      w = step(w, STEP, {});
      most = Math.max(most, w.stars.length);
    }
    expect(most).toBeLessThanOrEqual(8);
    expect(w.stars.every((s) => s.y < HEIGHT + 20)).toBe(true);
  });
});

describe('moving', () => {
  it('moves at the blob speed and stops at the walls', () => {
    const w = playing([klara, zoe]);
    const x0 = w.blobs[0].x;
    const moved = step(w, STEP, { host: { dx: 1, dy: 0 } });
    expect(moved.blobs[0].x - x0).toBeCloseTo(BLOB_SPEED * STEP, 5);
    const far = run(w, 5, { host: { dx: 1, dy: 0 } });
    expect(far.blobs[0].x).toBe(WIDTH - BLOB_RADIUS);
    const up = run(w, 5, { host: { dx: -1, dy: -1 } });
    expect(up.blobs[0].x).toBe(BLOB_RADIUS);
    expect(up.blobs[0].y).toBe(BLOB_RADIUS);
  });

  it('diagonals are not faster, and silly inputs are tamed', () => {
    const w = playing([klara, zoe]);
    const a = step(w, STEP, { host: { dx: 1, dy: 1 } }).blobs[0];
    expect(Math.hypot(a.x - w.blobs[0].x, a.y - w.blobs[0].y)).toBeCloseTo(BLOB_SPEED * STEP, 5);
    const b = step(w, STEP, { host: { dx: 1e9, dy: NaN } }).blobs[0];
    expect(b.x - w.blobs[0].x).toBeCloseTo(BLOB_SPEED * STEP, 5);
    expect(b.y).toBe(w.blobs[0].y);
  });
});

describe('catching stars', () => {
  it('touching a star scores a point and removes the star', () => {
    const w0 = playing([klara, zoe]);
    const me = w0.blobs[0];
    const w = { ...w0, spawnIn: 99, stars: [{ id: 99, x: me.x, y: me.y - 5, vy: 0 }] };
    const next = step(w, STEP, {});
    expect(next.blobs[0].score).toBe(1);
    expect(next.blobs[1].score).toBe(0);
    expect(next.stars.find((s) => s.id === 99)).toBeUndefined();
  });

  it('a star out of reach is not caught', () => {
    const w0 = playing([klara, zoe]);
    const w = { ...w0, spawnIn: 99, stars: [{ id: 99, x: 5, y: 100, vy: 0 }] };
    const next = step(w, STEP, {});
    expect(next.blobs.every((b) => b.score === 0)).toBe(true);
    expect(next.stars).toHaveLength(1);
  });

  it('when two blobs touch the same star, only the nearer one scores', () => {
    const w0 = playing([klara, zoe]);
    const blobs = [{ ...w0.blobs[0], x: 300, y: 300 }, { ...w0.blobs[1], x: 320, y: 300 }];
    const w = { ...w0, blobs, spawnIn: 99, stars: [{ id: 99, x: 312, y: 300, vy: 0 }] };
    const next = step(w, STEP, {});
    expect(next.blobs.map((b) => b.score)).toEqual([0, 1]);
  });
});

describe('ending the round', () => {
  it('first to 10 wins', () => {
    const w0 = playing([klara, zoe]);
    const w = { ...w0, blobs: [{ ...w0.blobs[0], score: WIN_SCORE - 1 }, w0.blobs[1]], spawnIn: 99, stars: [{ id: 1, x: w0.blobs[0].x, y: w0.blobs[0].y, vy: 0 }] };
    const next = step(w, STEP, {});
    expect(next.phase).toBe('over');
    expect(next.winners).toEqual(['host']);
    expect(step(next, STEP, {})).toBe(next); // nothing moves after the end
  });

  it('after 60 seconds the most stars wins; a tie shares the win', () => {
    const w0 = playing([klara, zoe]);
    const nearEnd = { ...w0, time: TIME_LIMIT - STEP / 2, blobs: [{ ...w0.blobs[0], score: 3 }, { ...w0.blobs[1], score: 5 }] };
    const next = step(nearEnd, STEP, {});
    expect(next.phase).toBe('over');
    expect(next.winners).toEqual(['g1']);

    const tied = step({ ...nearEnd, blobs: nearEnd.blobs.map((b) => ({ ...b, score: 4 })) }, STEP, {});
    expect(tied.winners.sort()).toEqual(['g1', 'host']);
  });

  it('nobody wins a round with no stars caught', () => {
    const w0 = playing([klara, zoe]);
    const next = step({ ...w0, time: TIME_LIMIT }, STEP, {});
    expect(next.phase).toBe('over');
    expect(next.winners).toEqual([]);
  });

  it('a whole round with nobody playing ends by the clock', () => {
    const w = run(playing([klara, zoe], 7), 61);
    expect(w.phase).toBe('over');
    expect(w.time).toBeLessThanOrEqual(TIME_LIMIT);
  });
});

describe('the computer blob', () => {
  it('chases stars and scores over a minute, but not as well as a good player', () => {
    const w = run(playing([klara], 3), 60);
    const bot = w.blobs.find((b) => b.id === BOT_ID)!;
    expect(bot.score).toBeGreaterThan(2);
  });

  it('is deterministic', () => {
    expect(run(playing([klara], 5), 20)).toEqual(run(playing([klara], 5), 20));
  });
});

describe('people coming and going', () => {
  it('a joiner takes a seat at 0 and the computer blob leaves', () => {
    const w = addBlob(newWorld(1, [klara]), zoe);
    expect(w.blobs.map((b) => b.id)).toEqual(['host', 'g1']);
    expect(w.blobs[1].score).toBe(0);
  });

  it('adding the same person twice changes nothing', () => {
    const w = newWorld(1, [klara, zoe]);
    expect(addBlob(w, zoe)).toBe(w);
  });

  it('when all but one leave, the computer comes back', () => {
    const w = removeBlob(newWorld(1, [klara, zoe]), 'g1');
    expect(w.blobs.map((b) => b.id)).toEqual(['host', BOT_ID]);
  });
});
