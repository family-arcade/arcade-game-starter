/**
 * The kit against the REAL PeerJS 1.5.5 client, for what the fake peer network cannot
 * show. No network: it runs in the suite.
 *
 * `GameHost`, `GameConnection` and `createTogether` run on node_modules/peerjs, with only the browser's
 * WebSocket, fetch and RTCPeerConnection stood in, and a broker that follows PeerServer 1.0.2 (peer@1.0.2 dist/module.mjs, the image
 * familyarcade.eu/connect runs):
 *   - `_onSocketConnection` (:273-313): an id that is still registered with the same token gets its socket swapped and NO `OPEN`;
 *     only a new registration is sent `OPEN` (:315-331).
 *   - a socket's close removes the client only if it is the client's current socket (:335-340).
 *   - a message for an id that is not registered is queued; a queue nobody read for 5 s sends `EXPIRE` once per pair and is cleared
 *     (:186-212, checked every 1 s); a client silent for 90 s is closed and removed (:124-141).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  interface Client {
    id: string;
    token: string;
    socket: MockWS | null;
    lastPing: number;
  }
  const state = {
    clients: new Map<string, Client>(),
    queues: new Map<string, { lastReadAt: number; messages: Array<Record<string, unknown>> }>(),
    /** Peer ids whose device has no network right now. */
    offline: new Set<string>(),
    sockets: [] as MockWS[],
    pcs: [] as MockPC[],
    ids: 0,
    /** Every `OPEN` the broker sent, by id. */
    opens: [] as string[],
    loops: [] as Array<ReturnType<typeof setInterval>>,
  };

  const toClient = (ws: MockWS, msg: unknown): void => {
    // (a socket whose client end is gone takes the bytes and says nothing)
    if (ws.readyState !== 1) return;
    const data = JSON.stringify(msg);
    setTimeout(() => {
      if (ws.readyState === 1) ws.onmessage?.({ data });
    }, 1);
  };
  /** The transmission handler (:377-415). */
  const relay = (message: Record<string, unknown>): void => {
    const dst = state.clients.get(String(message.dst));
    if (dst) {
      if (dst.socket) toClient(dst.socket, message);
      return;
    }
    if (message.type !== 'LEAVE' && message.type !== 'EXPIRE' && message.dst) {
      let q = state.queues.get(String(message.dst));
      if (!q) state.queues.set(String(message.dst), (q = { lastReadAt: Date.now(), messages: [] }));
      q.messages.push(message);
    }
  };
  /** `_onSocketConnection` (:273-313), `_registerClient` (:315-331), `_configureWS` (:332-352), and the queue drain (:538-545). */
  const serverConnection = (ws: MockWS): void => {
    let c = state.clients.get(ws.id);
    if (c) {
      if (c.token !== ws.token) {
        toClient(ws, { type: 'ID-TAKEN', payload: { msg: 'ID is taken' } });
        return;
      }
      c.socket = ws; // no OPEN on this path
    } else {
      c = { id: ws.id, token: ws.token, socket: ws, lastPing: Date.now() };
      state.clients.set(ws.id, c);
      state.opens.push(ws.id);
      toClient(ws, { type: 'OPEN' });
    }
    ws.client = c;
    const q = state.queues.get(ws.id);
    if (q) {
      state.queues.delete(ws.id);
      for (const m of q.messages) relay(m);
    }
  };
  const serverSawClose = (ws: MockWS): void => {
    const c = ws.client;
    if (c && c.socket === ws && state.clients.get(c.id) === c) state.clients.delete(c.id);
  };
  const fromClient = (ws: MockWS, raw: string): void => {
    const c = ws.client;
    if (!c) return;
    const message = JSON.parse(raw) as Record<string, unknown>;
    message.src = c.id;
    if (message.type === 'HEARTBEAT') {
      c.lastPing = Date.now();
      return;
    }
    relay(message);
  };

  class MockWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    onopen: null | (() => void) = null;
    onmessage: null | ((e: { data: string }) => void) = null;
    onclose: null | ((e: unknown) => void) = null;
    onerror: null | ((e: unknown) => void) = null;
    id: string;
    token: string;
    client: Client | null = null;
    constructor(public url: string) {
      const q = new URL(url).searchParams;
      this.id = q.get('id') ?? '';
      this.token = q.get('token') ?? '';
      state.sockets.push(this);
      setTimeout(() => {
        if (this.readyState !== 0) return;
        if (state.offline.has(this.id)) {
          this.readyState = 3;
          this.onclose?.({});
          return;
        }
        this.readyState = 1;
        serverConnection(this);
        this.onopen?.();
      }, 20);
    }
    send(data: string): void {
      if (this.readyState !== 1 || state.offline.has(this.id)) return;
      fromClient(this, data);
    }
    close(): void {
      if (this.readyState === 3) return;
      const wasOpen = this.readyState === 1;
      this.readyState = 3;
      // a clean close reaches the broker only while the device has a network
      if (wasOpen && !state.offline.has(this.id)) serverSawClose(this);
    }
  }

  class MockDC {
    readyState = 'connecting';
    ordered = true;
    binaryType = 'arraybuffer';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    onopen: null | (() => void) = null;
    onmessage: null | ((e: { data: unknown }) => void) = null;
    onclose: null | (() => void) = null;
    other: MockDC | null = null;
    private ls: Array<(e: { data: unknown }) => void> = [];
    constructor(
      public pc: MockPC,
      public label: string,
    ) {}
    addEventListener(type: string, fn: (e: { data: unknown }) => void): void {
      if (type === 'message') this.ls.push(fn);
    }
    send(data: unknown): void {
      const o = this.other;
      if (this.readyState !== 'open' || !o) return;
      setTimeout(() => {
        if (o.readyState !== 'open') return;
        o.onmessage?.({ data });
        for (const fn of o.ls) fn({ data });
      }, 1);
    }
    close(): void {
      this.readyState = 'closed';
    }
    dies(): void {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      this.onclose?.();
    }
  }

  class MockPC {
    signalingState = 'stable';
    iceConnectionState = 'new';
    onicecandidate: unknown = null;
    oniceconnectionstatechange: null | (() => void) = null;
    ondatachannel: null | ((e: { channel: MockDC }) => void) = null;
    ontrack: unknown = null;
    tag = `pc${state.pcs.length}`;
    channel: MockDC | null = null;
    closed = false;
    constructor() {
      state.pcs.push(this);
    }
    createDataChannel(label: string): MockDC {
      this.channel = new MockDC(this, label);
      return this.channel;
    }
    async createOffer(): Promise<{ type: string; sdp: string }> {
      return { type: 'offer', sdp: this.tag };
    }
    async createAnswer(): Promise<{ type: string; sdp: string }> {
      return { type: 'answer', sdp: this.tag };
    }
    async setLocalDescription(): Promise<void> {}
    async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> {
      if (this.closed) throw new Error('InvalidStateError');
      const far = state.pcs.find((p) => p.tag === d.sdp) ?? null;
      if (d.type !== 'answer' || !far) return;
      // both descriptions are set: the channel opens at both ends a moment later
      setTimeout(() => {
        const mine = this.channel;
        if (this.closed || far.closed || !mine) return;
        const theirs = new MockDC(far, mine.label);
        far.channel = theirs;
        theirs.other = mine;
        mine.other = theirs;
        far.ondatachannel?.({ channel: theirs });
        theirs.readyState = 'open';
        mine.readyState = 'open';
        this.iceConnectionState = 'connected';
        far.iceConnectionState = 'connected';
        theirs.onopen?.();
        mine.onopen?.();
      }, 30);
    }
    async addIceCandidate(): Promise<void> {}
    // (webrtc-adapter takes jsdom for an old Safari and wraps these: they must exist)
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.signalingState = 'closed';
      const mine = this.channel;
      if (!mine) return;
      mine.readyState = 'closed';
      const o = mine.other;
      if (o) setTimeout(() => o.dies(), 5);
    }
    /** ICE fails (the path is gone): the browser says so, as PeerJS hears it (bundler.mjs:777-781). */
    iceFails(): void {
      if (this.closed) return;
      this.iceConnectionState = 'failed';
      this.oniceconnectionstatechange?.();
    }
  }

  const g = globalThis as unknown as Record<string, unknown>;
  g.WebSocket = MockWS;
  g.RTCPeerConnection = MockPC;
  g.RTCSessionDescription = class {
    constructor(init: object) {
      Object.assign(this, init);
    }
  };
  g.fetch = async () => ({ status: 200, text: async () => `guest${++state.ids}` });

  return {
    state,
    reset(): void {
      for (const l of state.loops.splice(0)) clearInterval(l);
      state.clients.clear();
      state.queues.clear();
      state.offline.clear();
      state.sockets.length = 0;
      state.opens.length = 0;
    },
    /** The broker's two loops (start after fake timers are on). */
    start(): void {
      state.loops.push(
        setInterval(() => {
          const now = Date.now();
          const seen = new Set<string>();
          for (const [dstId, q] of [...state.queues]) {
            if (now - q.lastReadAt < 5000) continue;
            for (const m of q.messages) {
              const key = `${String(m.src)}_${String(m.dst)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              relay({ type: 'EXPIRE', src: m.dst, dst: m.src });
            }
            state.queues.delete(dstId);
          }
        }, 1000),
        setInterval(() => {
          const now = Date.now();
          for (const c of [...state.clients.values()]) {
            if (now - c.lastPing < 90_000) continue;
            const ws = c.socket;
            state.queues.delete(c.id);
            state.clients.delete(c.id);
            c.socket = null;
            if (ws && ws.readyState === 1 && !state.offline.has(ws.id)) {
              ws.readyState = 3;
              ws.onclose?.({});
            }
          }
        }, 300),
      );
    },
    /** The device loses its network (wifi off, out of range): its sockets close at its own end, and no word reaches the broker. */
    goOffline(id: string): void {
      state.offline.add(id);
      for (const ws of [...state.sockets]) {
        if (ws.id !== id || ws.readyState === 3) continue;
        ws.readyState = 3;
        ws.onclose?.({});
      }
    },
    goOnline(id: string): void {
      state.offline.delete(id);
    },
    /** The broker's end of a socket closes and the device hears it (a Caddy reload, a broker restart, iOS closing a suspended page's socket with the network up). */
    cleanDrop(id: string): void {
      for (const ws of [...state.sockets]) {
        if (ws.id !== id || ws.readyState !== 1) continue;
        serverSawClose(ws);
        ws.readyState = 3;
        ws.onclose?.({});
      }
    },
    /** Every open data channel's path is gone: ICE fails at both ends. */
    channelsFail(): void {
      for (const pc of [...state.pcs]) if (pc.channel?.readyState === 'open') pc.iceFails();
    },
    registered: (): string[] => [...state.clients.keys()],
  };
});

import { GameHost } from './host';
import { GameConnection } from './peer';
import { createTogether, JoinError, NO_ROOM_MS } from './together';

type Msg = { t: string };
const isMsg = (v: unknown): v is Msg => typeof v === 'object' && v !== null && 't' in v;

async function pass(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
}

async function table() {
  const hostStatus: string[] = [];
  const left: string[] = [];
  const host = new GameHost<Msg>(
    { onStatus: (s) => hostStatus.push(s), onGuestOpen: () => {}, onGuestClose: (id) => left.push(id), onMessage: () => {} },
    { prefix: 'p-', isMessage: isMsg },
  );
  host.host('ABCD');
  await pass(300);
  const statuses: string[] = [];
  let opens = 0;
  const got: Msg[] = [];
  const guest = new GameConnection<Msg>(
    { onStatus: (s) => statuses.push(s), onMessage: (m) => got.push(m), onOpen: () => void opens++ },
    { prefix: 'p-', isMessage: isMsg, dialTimeoutMs: 18_000 },
  );
  guest.join('ABCD');
  await pass(1000);
  const peer = (guest as unknown as { peer: { id: string; open: boolean; disconnected: boolean } }).peer;
  const guestId = peer.id ?? `guest${env.state.ids}`;
  return {
    host,
    guest,
    statuses,
    got,
    left,
    opens: () => opens,
    peer,
    guestId,
    /** The host's word reaches the guest right now. */
    async linked(): Promise<boolean> {
      const before = got.length;
      host.broadcast({ t: 'ping' });
      await pass(100);
      return got.length > before;
    },
  };
}

describe('the guest kit on the real PeerJS client and a PeerServer 1.0.2 broker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    env.reset();
    env.start();
  });
  afterEach(() => {
    env.reset();
    vi.useRealTimers();
  });

  it('joins, and the harness carries messages', async () => {
    const t = await table();
    expect(t.opens()).toBe(1);
    expect(t.host.guests()).toEqual([t.guestId]);
    expect(await t.linked()).toBe(true);
    t.guest.destroy();
    t.host.destroy();
  });

  it('A: the broker saw the socket close (it answers the reconnect with OPEN), the channel alive, 30 s after the join', async () => {
    const t = await table();
    await pass(30_000);
    env.cleanDrop(t.guestId);
    await pass(10_000);
    // (an older kit ended in `error` here: the reconnect's `open` dialled past the join deadline)
    expect(t.statuses).toEqual(['dialing', 'connected']);
    expect(t.opens()).toBe(1);
    expect(await t.linked()).toBe(true);
    expect(t.left).toEqual([]);
    t.guest.destroy();
    t.host.destroy();
  });

  it('B: the device lost its network for 10 s (the broker never saw the socket close, so the reconnect gets no OPEN) and the channel died', async () => {
    const t = await table();
    await pass(30_000);
    env.goOffline(t.guestId);
    await pass(3000);
    env.channelsFail();
    await pass(7000);
    env.goOnline(t.guestId);
    await pass(120_000);
    const ws = env.state.sockets.filter((s) => s.id === t.guestId).slice(-1)[0]!;
    const row = {
      lastStatus: t.statuses[t.statuses.length - 1],
      opens: t.opens(),
      linked: await t.linked(),
      peerOpen: t.peer.open,
      peerDisconnected: t.peer.disconnected,
      socketOpen: ws.readyState === 1,
      stillRegistered: env.registered().includes(t.guestId),
      brokerOpensToGuest: env.state.opens.filter((id) => id === t.guestId).length,
      hostGuests: t.host.guests().length,
    };
    // the broker socket is back and the id is registered; the kit closed the socket that got no OPEN and registered afresh, then dialled
    // (fix 1 before its round 2 sat in `reconnecting` here for good: `peer.open` never came back, and it waited for it)
    expect(row.socketOpen).toBe(true);
    expect(row.stillRegistered).toBe(true);
    expect(row.brokerOpensToGuest).toBe(2);
    expect(row.peerOpen).toBe(true);
    expect(row.opens).toBe(2);
    expect(row.linked).toBe(true);
    expect(row.lastStatus).toBe('connected');
    expect(row.hostGuests).toBe(1);
    t.guest.destroy();
    t.host.destroy();
  });

  it('C: a 5 s network blip the channel survives (no OPEN on reconnect), then 60 s later the channel drops (the host prunes or kicks the guest, a second blip)', async () => {
    const t = await table();
    await pass(30_000);
    env.goOffline(t.guestId);
    await pass(5000);
    env.goOnline(t.guestId);
    await pass(60_000);
    const before = { linked: await t.linked(), peerOpen: t.peer.open, lastStatus: t.statuses[t.statuses.length - 1], opens: t.opens() };
    t.host.kick(t.guestId); // (what the lobby's ghost prune does: the guest is alive and should dial back in by itself)
    await pass(60_000);
    const row = { before, lastStatus: t.statuses[t.statuses.length - 1], opens: t.opens(), linked: await t.linked(), peerOpen: t.peer.open, hostGuests: t.host.guests().length };
    expect(before.linked).toBe(true);
    expect(before.peerOpen).toBe(true);
    expect(before.opens).toBe(1);
    expect(row.linked).toBe(true);
    expect(row.opens).toBe(2);
    expect(row.lastStatus).toBe('connected');
    expect(row.hostGuests).toBe(1);
    t.guest.destroy();
    t.host.destroy();
  });
});

describe('"Wrong code" on a PeerServer 1.0.2 broker (real PeerJS client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    env.reset();
    env.start();
  });
  afterEach(() => {
    env.reset();
    vi.useRealTimers();
  });
  const dev = (n: string) => createTogether({ gameId: 'g', getPlayer: () => ({ name: n, colour: '#112233' }) });

  it('a code nobody hosts: how long until no-room', async () => {
    const t0 = Date.now();
    let at = -1;
    let reason = '';
    dev('Zoe')
      .join('QQQQ')
      .catch((e: unknown) => {
        at = Date.now() - t0;
        reason = e instanceof JoinError ? e.reason : String(e);
      });
    await pass(20_000);
    // the broker's "no such peer" comes 5 to 6 s after the first dial, then NO_ROOM_MS more of dialling: about 10 s
    expect(reason).toBe('no-room');
    expect(at).toBeGreaterThan(5000 + NO_ROOM_MS);
    expect(at).toBeLessThanOrEqual(6100 + NO_ROOM_MS);
  });

  it('a right code whose host registers late: up to when the join still gets in', async () => {
    const out: Record<string, string> = {};
    for (const lateMs of [4000, 7000, 9000, 11_000]) {
      env.reset();
      env.start();
      // the host's room exists, its device off the broker (asleep): it comes back `lateMs` after the guest starts to join
      const hostRoom = await (async () => {
        const p = dev('Mia').host();
        await pass(500);
        return p;
      })();
      const hostId = `ak1-g-${hostRoom.code}`;
      env.goOffline(hostId);
      // the broker notices at once here (a clean close), so the id is not registered while the host is away
      env.state.clients.delete(hostId);
      await pass(500);
      const t0 = Date.now();
      let res = 'pending';
      dev('Zoe')
        .join(hostRoom.code)
        .then(
          () => (res = `joined at ${Date.now() - t0} ms`),
          (e: unknown) => (res = `${e instanceof JoinError ? e.reason : String(e)} at ${Date.now() - t0} ms`),
        );
      await pass(lateMs);
      env.goOnline(hostId);
      await pass(20_000);
      out[`host back after ${lateMs} ms`] = res;
      hostRoom.leave();
      await pass(500);
    }
    // a host away up to about 9 s is still joined; past the window the code is called wrong
    expect(out['host back after 4000 ms']).toMatch(/^joined/);
    expect(out['host back after 7000 ms']).toMatch(/^joined/);
    expect(out['host back after 9000 ms']).toMatch(/^joined/);
    expect(out['host back after 11000 ms']).toMatch(/^no-room/);
  });
});
