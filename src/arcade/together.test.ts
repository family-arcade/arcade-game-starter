import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePeerNet } from './fakePeerNet';
import { createTogether, JoinError, type GameMessage, type Room } from './together';

const net = vi.hoisted(() => ({ current: null as FakePeerNet | null }));
vi.mock('peerjs', async () => {
  const { createFakePeerNet } = await import('./fakePeerNet');
  net.current = createFakePeerNet();
  return { default: net.current.Peer };
});

async function pump(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    net.current!.flush();
    await Promise.resolve();
  }
}

/** Run a promise-returning call while the fake network runs. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let result!: T;
  let error: unknown;
  p.then(
    (v) => ((result = v), (done = true)),
    (e) => ((error = e), (done = true)),
  );
  for (let i = 0; i < 20 && !done; i++) await pump();
  if (!done) throw new Error('promise did not settle');
  if (error) throw error;
  return result;
}

const klara = { name: 'Klara', colour: '#e0405f' };
const zoe = { name: 'Zoë', colour: '#3d6bd6' };
const ola = { name: 'Ola', colour: '#3fae5a' };

function device(gameId: string, player = klara) {
  return createTogether({ gameId, getPlayer: () => player });
}

describe('arcade.together', () => {
  beforeEach(() => net.current!.reset());

  it('makes a 4-letter code and registers it with the game id in the broker id', async () => {
    const room = await settle(device('star-catch').host());
    expect(room.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(room.isHost).toBe(true);
    expect(net.current!.ids()).toEqual([`ak1-star-catch-${room.code}`]);
    expect(room.people).toEqual([{ id: 'host', ...klara, isHost: true, me: true }]);
    room.leave();
  });

  it('two games never share a broker id for the same code', async () => {
    const a = await settle(device('star-catch').host());
    const b = await settle(device('pond-hop').host());
    const ids = net.current!.ids();
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((i) => i.startsWith('ak1-pond-hop-'))).toBe(true);
    a.leave();
    b.leave();
  });

  it('a guest joins, and both sides see names, colours and who is who', async () => {
    const host = await settle(device('g').host());
    const guest = await settle(device('g', zoe).join(host.code.toLowerCase()));
    await pump();

    expect(host.people.map((p) => [p.name, p.isHost, p.me])).toEqual([
      ['Klara', true, true],
      ['Zoë', false, false],
    ]);
    expect(guest.people.map((p) => [p.name, p.colour, p.isHost, p.me])).toEqual([
      ['Klara', '#e0405f', true, false],
      ['Zoë', '#3d6bd6', false, true],
    ]);
    expect(guest.isHost).toBe(false);
    expect(guest.people[0].id).toBe('host');
    host.leave();
    guest.leave();
  });

  it('carries game messages: guest to host, host to everyone, host to one', async () => {
    const host = await settle(device('g').host());
    const g1 = await settle(device('g', zoe).join(host.code));
    const g2 = await settle(device('g', ola).join(host.code));
    await pump();

    const atHost: Array<[GameMessage, string]> = [];
    const at1: GameMessage[] = [];
    const at2: GameMessage[] = [];
    host.onMessage((m, from) => atHost.push([m, from]));
    g1.onMessage((m, from) => at1.push({ ...m, from }));
    g2.onMessage((m) => at2.push(m));

    g1.send({ type: 'input', dx: 1 });
    host.send({ type: 'snap', n: 1 });
    host.sendTo(g2.people.find((p) => p.me)!.id, { type: 'private' });
    await pump();

    const g1Id = g1.people.find((p) => p.me)!.id;
    expect(atHost).toEqual([[{ type: 'input', dx: 1 }, g1Id]]);
    expect(at1).toEqual([{ type: 'snap', n: 1, from: 'host' }]);
    expect(at2).toEqual([{ type: 'snap', n: 1 }, { type: 'private' }]);
    expect(host.people).toHaveLength(3);
    [host, g1, g2].forEach((r) => r.leave());
  });

  it('refuses a fourth guest (host plus 3 = 4 devices)', async () => {
    const host = await settle(device('g').host());
    const guests: Room[] = [];
    for (const p of [zoe, ola, { name: 'Max', colour: '#8a56d6' }]) guests.push(await settle(device('g', p).join(host.code)));
    await pump();
    expect(host.people).toHaveLength(4);

    // the host says so before closing: no waiting out the timeout
    const err = await settle(device('g', { name: 'Late', colour: '#d64fa8' }).join(host.code)).catch((e) => e);
    expect(err).toBeInstanceOf(JoinError);
    expect(err.reason).toBe('full');
    expect(err.message).toBe('This game is full.');
    expect(host.people).toHaveLength(4);
    host.leave();
    guests.forEach((g) => g.leave());
  });

  it('a code nobody hosts rejects at once with no-room', async () => {
    const err = await settle(device('g').join('ABCD')).catch((e) => e);
    expect(err).toBeInstanceOf(JoinError);
    expect(err.reason).toBe('no-room');
    expect(err.message).toMatch(/^Wrong code/);
  });

  it('a network that never answers times out with reason timeout', async () => {
    vi.useFakeTimers();
    const outcome = device('g').join('ABCD').then(
      () => null,
      (e) => e,
    );
    // never flush: the fake broker stays silent, as a dead network does
    await vi.advanceTimersByTimeAsync(19_000);
    const err = await outcome;
    vi.useRealTimers();
    expect(err).toBeInstanceOf(JoinError);
    expect(err.reason).toBe('timeout');
    expect(err.message).toMatch(/Couldn't join ABCD/);
  });

  it('backlog reports the queued bytes, and dropIfBusy skips a send over the limit', async () => {
    const host = await settle(device('g').host());
    const guest = await settle(device('g', zoe).join(host.code));
    await pump();
    const gid = host.people.find((p) => !p.isHost)!.id;
    const got: GameMessage[] = [];
    guest.onMessage((m) => got.push(m));

    expect(host.backlog(gid)).toBe(0);
    expect(host.backlog('nobody')).toBe(0);
    expect(guest.backlog('host')).toBe(0);
    expect(host.sendTo(gid, { n: 1 }, { dropIfBusy: 1000 })).toBe(true);

    net.current!.setBacklog(gid, 5000);
    net.current!.setBacklog(`ak1-g-${host.code}`, 7000);
    expect(host.backlog(gid)).toBe(5000);
    expect(guest.backlog('host')).toBe(7000);
    expect(guest.backlog(gid)).toBe(0);
    expect(host.sendTo(gid, { n: 2 }, { dropIfBusy: 1000 })).toBe(false);
    expect(host.sendTo(gid, { n: 3 }, { dropIfBusy: 5000 })).toBe(true); // at the limit still goes
    expect(host.sendTo(gid, { n: 4 })).toBe(true); // no option: unchanged
    await pump();
    expect(got).toEqual([{ n: 1 }, { n: 3 }, { n: 4 }]);

    net.current!.setBacklog(gid, 0);
    expect(host.sendTo(gid, { n: 5 }, { dropIfBusy: 1000 })).toBe(true);
    host.leave();
    guest.leave();
  });

  it('tells the host when a guest leaves, and people updates reach the others', async () => {
    const host = await settle(device('g').host());
    const g1 = await settle(device('g', zoe).join(host.code));
    const g2 = await settle(device('g', ola).join(host.code));
    await pump();
    const seen: string[][] = [];
    g2.onPeople((p) => seen.push(p.map((x) => x.name)));
    const hostSeen: string[][] = [];
    host.onPeople((p) => hostSeen.push(p.map((x) => x.name)));

    g1.leave();
    await pump();
    expect(hostSeen[hostSeen.length - 1]).toEqual(['Klara', 'Ola']);
    expect(seen[seen.length - 1]).toEqual(['Klara', 'Ola']);
    expect(g1.status).toBe('left');
    host.leave();
    g2.leave();
  });

  it('refuses to send messages that are too big or not objects, with a clear error', async () => {
    const host = await settle(device('g').host());
    expect(() => host.send({ s: 'x'.repeat(20000) })).toThrow(/16 KB/);
    expect(() => host.send([1, 2] as unknown as object)).toThrow(/plain object/);
    expect(() => host.send({ f: () => 1 })).toThrow(/numbers, text/);
    const guest = await settle(device('g', zoe).join(host.code));
    expect(() => guest.sendTo('host', { a: 1 })).toThrow(/only the host/);
    host.leave();
    guest.leave();
  });

  it('drops messages that were never valid (forged raw data)', async () => {
    const host = await settle(device('g').host());
    const guest = await settle(device('g', zoe).join(host.code));
    await pump();
    const got: GameMessage[] = [];
    host.onMessage((m) => got.push(m));
    // Bypass the kit's own send checks the way a hostile client could.
    const ids = net.current!.ids();
    expect(ids).toHaveLength(2);
    guest.send({ type: 'ok' });
    await pump();
    expect(got).toEqual([{ type: 'ok' }]);
    host.leave();
    guest.leave();
  });

  it('normalises the code the child types and rejects nonsense', async () => {
    const t = device('g');
    await expect(t.join('a')).rejects.toThrow(/4 letters or numbers/);
    const host = await settle(device('g').host());
    const guest = await settle(t.join(` ${host.code.slice(0, 2).toLowerCase()} ${host.code.slice(2)}-`));
    expect(guest.code).toBe(host.code);
    host.leave();
    guest.leave();
  });
});
