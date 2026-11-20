/**
 * The kit's room through the network trouble of a family evening: a broker socket that
 * drops and comes back, a phone that wakes with both links gone, a host that is away when the code is typed, one device's failed
 * handshake. Everything runs on the fake peer network, whose `reconnect()`, `disconnected` and `open` follow PeerJS 1.5.5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePeerNet } from './fakePeerNet';
import { createTogether, JoinError, type Room } from './together';

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
/** Fake time goes by in steps, with the network running between them (a re-dial timer fires, then its dial lands). */
async function pass(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 500) {
    await vi.advanceTimersByTimeAsync(Math.min(500, ms - t));
    await pump();
  }
}
const dev = (name: string) => createTogether({ gameId: 'g', getPlayer: () => ({ name, colour: '#112233' }) });
const hostPeerId = (room: Room) => `ak1-g-${room.code}`;
const guestIds = (host: Room) => host.people.filter((p) => !p.isHost).map((p) => p.id);
function watch(room: Room): { statuses: string[]; got: unknown[] } {
  const statuses: string[] = [];
  const got: unknown[] = [];
  room.onStatus((s) => statuses.push(s));
  room.onMessage((m) => got.push(m));
  return { statuses, got };
}

describe('a broker socket that drops and comes back', () => {
  beforeEach(() => {
    net.current!.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('F1: 20 s after joining, the guest stays connected on its live channel: no error, no new dial, nothing lost', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const h = watch(host);
    const people: number[] = [];
    host.onPeople((p) => people.push(p.length));
    await pass(20_000);
    net.current!.dropSocket(guestIds(host)[0]);
    await pump();
    host.send({ type: 'x' });
    guest.send({ type: 'y' });
    await pump();
    expect(g.got).toEqual([{ type: 'x' }]);
    expect(h.got).toEqual([{ type: 'y' }]);
    expect(guest.status).toBe('connected');
    expect(g.statuses).not.toContain('error');
    expect(people).toEqual([]);
    expect(net.current!.openConnections()).toBe(2);
    // and the guest is registered with the broker again, under its own id
    expect(net.current!.ids()).toContain(guestIds(host)[0]);
  });

  it('F1b: inside the first 18 s the live channel is kept too: a message sent during the reconnect arrives, and the host sees nobody leave', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const people: number[] = [];
    host.onPeople((p) => people.push(p.length));
    net.current!.dropSocket(guestIds(host)[0]);
    host.send({ type: 'seat' }); // sent while the guest's socket is coming back
    await pump();
    expect(g.got).toEqual([{ type: 'seat' }]);
    expect(guest.status).toBe('connected');
    expect(people).toEqual([]);
    expect(net.current!.openConnections()).toBe(2);
  });

  it('30 s with the broker away and the channel alive: the race link carries on both ways, and nobody is told anything', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const h = watch(host);
    await pass(19_000);
    net.current!.setBrokerDown(true);
    await pass(30_000);
    host.send({ type: 'x' });
    guest.send({ type: 'y' });
    await pump();
    expect(g.got).toEqual([{ type: 'x' }]);
    expect(h.got).toEqual([{ type: 'y' }]);
    expect(g.statuses).toEqual([]);
    expect(h.statuses).not.toContain('error');
    net.current!.setBrokerDown(false);
    await pass(1000);
    expect(guest.status).toBe('connected');
    expect(host.people).toHaveLength(2);
    expect(net.current!.ids()).toHaveLength(2);
  });

  it('F2: a phone wakes with both links gone and the broker still away: the re-dial waits (no error, no throw), and gets back in once the broker answers, however long that took', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const id = guestIds(host)[0];
    net.current!.setBrokerDown(true);
    net.current!.dropChannels(id);
    await pump();
    expect(host.people).toHaveLength(1);
    // (an error thrown in a timer would fail this await)
    await pass(40_000);
    expect(guest.status).toBe('reconnecting');
    expect(g.statuses).not.toContain('error');
    net.current!.setBrokerDown(false);
    await pass(3000);
    expect(guest.status).toBe('connected');
    expect(host.people).toHaveLength(2);
    host.send({ type: 'x' });
    await pump();
    expect(g.got).toEqual([{ type: 'x' }]);
  });

  it('a dial PeerJS refuses (the peer is disconnected) is waited out, not thrown: the timer tries again', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const id = guestIds(host)[0];
    net.current!.dropChannels(id);
    await pump();
    // the socket drops in the very moment before the re-dial timer: the kit's reconnect() is under way, the broker has not answered
    net.current!.setBrokerDown(true);
    await vi.advanceTimersByTimeAsync(2600);
    expect(g.statuses).not.toContain('error');
    net.current!.setBrokerDown(false);
    await pass(3000);
    expect(guest.status).toBe('connected');
  });

  it('a blip the broker never saw (the reconnect gets no OPEN): the live channel carries on, and when it later drops the guest still dials back in', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    const id = guestIds(host)[0];
    await pass(20_000);
    net.current!.blipSocket(id);
    await pass(500);
    host.send({ type: 'x' });
    await pump();
    expect(g.got).toEqual([{ type: 'x' }]);
    expect(g.statuses).toEqual([]);
    // a minute later the host takes the guest out (the lobby's prune of a hidden tab): the device is there and must come back by itself
    await pass(60_000);
    host.kick(id);
    await pump();
    expect(host.people).toHaveLength(1);
    await pass(8000);
    expect(guest.status).toBe('connected');
    expect(host.people.map((p) => p.id)).toEqual(['host', id]);
    expect(g.statuses).not.toContain('error');
  });

  it('the same blip with the channel gone too: back in by itself, within 10 s', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const id = guestIds(host)[0];
    await pass(20_000);
    net.current!.blipSocket(id);
    net.current!.dropChannels(id);
    await pass(10_000);
    expect(guest.status).toBe('connected');
    expect(host.people).toHaveLength(2);
  });

  it('a host that is gone for good still ends the room: 18 s of dials with the broker answering, then error', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    net.current!.dropChannels(guestIds(host)[0]);
    await pump();
    net.current!.vanish(hostPeerId(host));
    await pass(17_000);
    expect(guest.status).toBe('reconnecting');
    await pass(4000);
    expect(guest.status).toBe('error');
  });
});

describe('F3: a guest the kit dialled back in', () => {
  beforeEach(() => {
    net.current!.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('is told who is here again once the host has let it back in, and a game message sent on that word reaches the host', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const h = watch(host);
    guest.onPeople(() => guest.send({ type: 'hello', u: { go: 3 } }));
    net.current!.dropChannels(guestIds(host)[0]);
    await pump();
    expect(host.people).toHaveLength(1);
    await pass(3000);
    expect(host.people).toHaveLength(2);
    expect(h.got).toEqual([{ type: 'hello', u: { go: 3 } }]);
  });
});

describe('the right code while the host is away (finding 8)', () => {
  beforeEach(() => {
    net.current!.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps dialling: a host that registers 1.5 s after the code was typed is joined, not "Wrong code"', async () => {
    let outcome: unknown = 'pending';
    const joining = dev('Zoe').join('AAAA');
    joining.then(
      (room) => (outcome = room),
      (e) => (outcome = e),
    );
    // (the fake broker does not queue an offer for a host that registers later, as the real one does for 5 s: the join needs its
    // next dial, at 2.5 s, inside the window. `real-peerjs.test.ts` has the real timings.)
    await pass(1500);
    expect(outcome).toBe('pending');
    vi.spyOn(Math, 'random').mockReturnValue(0); // the code AAAA
    const host = await settle(dev('Mia').host());
    expect(host.code).toBe('AAAA');
    await pass(3000);
    expect(outcome).not.toBeInstanceOf(Error);
    expect((outcome as Room).people).toHaveLength(2);
    expect(host.people).toHaveLength(2);
  });

  it('a code nobody hosts is no-room after 4 s of dialling, not before', async () => {
    let outcome: unknown = 'pending';
    dev('Zoe')
      .join('ABCD')
      .then(
        (room) => (outcome = room),
        (e) => (outcome = e),
      );
    await pass(3500);
    expect(outcome).toBe('pending');
    await pass(1000);
    expect(outcome).toBeInstanceOf(JoinError);
    expect((outcome as JoinError).reason).toBe('no-room');
    // and the dialling has stopped: no peer of the join is left registered
    expect(net.current!.ids()).toEqual([]);
  });
});

describe('one device with a failed handshake (finding 10)', () => {
  beforeEach(() => {
    net.current!.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('a webrtc error on the host ends nothing: the room, the people and the live channels stay', async () => {
    const host = await settle(dev('Mia').host());
    const a = await settle(dev('Zoe').join(host.code));
    const b = await settle(dev('Ola').join(host.code));
    await pump();
    const h = watch(host);
    net.current!.peerError(hostPeerId(host), 'webrtc', 'Failed to set remote answer sdp');
    await pump();
    expect(h.statuses).not.toContain('error');
    expect(host.status).not.toBe('error');
    expect(host.people).toHaveLength(3);
    host.send({ type: 'x' });
    await pump();
    expect(a.status).toBe('connected');
    expect(b.status).toBe('connected');
  });

  it('a webrtc error on a guest with a live channel ends nothing', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    net.current!.peerError(guestIds(host)[0], 'webrtc', 'Failed to add ICE candidate');
    await pump();
    host.send({ type: 'x' });
    await pump();
    expect(g.statuses).toEqual([]);
    expect(guest.status).toBe('connected');
    expect(g.got).toEqual([{ type: 'x' }]);
  });

  it('the half-made channel of a failed handshake gives its seat back at the error: a fourth device gets in', async () => {
    const host = await settle(dev('Mia').host());
    await settle(dev('Zoe').join(host.code));
    await settle(dev('Ola').join(host.code));
    // a third device dials, and its handshake hangs: the host holds a channel that never opens
    net.current!.setHandshakeStuck(true);
    const ben = dev('Ben');
    ben.join(host.code).catch(() => {});
    await pump();
    net.current!.setHandshakeStuck(false);
    net.current!.peerError(hostPeerId(host), 'webrtc', 'Failed to set remote answer sdp');
    await pump();
    const late = await settle(dev('Ida').join(host.code));
    expect(late.people).toHaveLength(4);
    expect(host.status).not.toBe('error');
    ben.current()?.leave();
  });

  it('a channel that never opens and whose device gave up frees its seat after 10 s', async () => {
    const host = await settle(dev('Mia').host());
    await settle(dev('Zoe').join(host.code));
    await settle(dev('Ola').join(host.code));
    net.current!.setHandshakeStuck(true);
    const before = new Set(net.current!.ids());
    dev('Ben')
      .join(host.code)
      .catch(() => {});
    await pump();
    // the device is gone mid-handshake (a closed tab): the host is told nothing about a channel that never opened
    for (const id of net.current!.ids()) if (!before.has(id)) net.current!.vanish(id);
    net.current!.setHandshakeStuck(false);
    await pass(10_500);
    const late = await settle(dev('Ida').join(host.code));
    expect(late.people).toHaveLength(4);
  });

  it('an error on one guest\'s channel closes that channel only: the guest dials back in, the other guest and the room never notice', async () => {
    const host = await settle(dev('Mia').host());
    const a = await settle(dev('Zoe').join(host.code));
    const b = await settle(dev('Ola').join(host.code));
    await pump();
    const h = watch(host);
    const wb = watch(b);
    const [idA] = guestIds(host);
    net.current!.channelError(hostPeerId(host), idA);
    await pump();
    expect(host.people.map((p) => p.id)).not.toContain(idA);
    expect(h.statuses).not.toContain('error');
    expect(wb.statuses).toEqual([]);
    await pass(3000);
    expect(host.people.map((p) => p.id)).toContain(idA);
    expect(a.status).toBe('connected');
    expect(b.status).toBe('connected');
  });

  it('an error on the guest\'s own channel is a dropped link: it dials again and is back', async () => {
    const host = await settle(dev('Mia').host());
    const guest = await settle(dev('Zoe').join(host.code));
    await pump();
    const g = watch(guest);
    net.current!.channelError(guestIds(host)[0]);
    await pump();
    expect(g.statuses).not.toContain('error');
    await pass(3000);
    expect(guest.status).toBe('connected');
    expect(host.people).toHaveLength(2);
  });
});
