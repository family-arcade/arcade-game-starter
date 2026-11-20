/**
 * Test helper: an in-memory PeerJS for several devices at once. Mock `peerjs`
 * with a network's `Peer` and the real `GameConnection` and `GameHost` run
 * against it: a peer registers its id with the "broker", dials another by id,
 * and the two data channels open, carry messages and close as the real ones
 * do. Nothing happens until the test calls `flush()`, so every step is in the
 * test's hands, and timers stay the test's own (fake or real).
 *
 *   const net = vi.hoisted(() => ({ current: null as FakePeerNet | null }));
 *   vi.mock('peerjs', async () => {
 *     const { createFakePeerNet } = await import('./fakePeerNet');
 *     net.current = createFakePeerNet();
 *     return { default: net.current.Peer };
 *   });
 *
 * Messages are deep-copied on the way, as BinaryPack would.
 */

type Listener = (...args: unknown[]) => void;

class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, fn: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
  }
  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export interface FakePeerNet {
  /** The `Peer` class to hand `vi.mock('peerjs')`. */
  Peer: new (...args: unknown[]) => unknown;
  /** Run everything the network has queued (registrations, dials, messages, closes). */
  flush: () => void;
  /** Ids registered with the broker right now. */
  ids: () => string[];
  /** Messages delivered so far, for a test that counts traffic. */
  delivered: () => number;
  /** Set the bytes queued on every channel whose far end is `peerId` (what `room.backlog(peerId)` reports). */
  setBacklog: (peerId: string, bytes: number) => void;
  /** While true, a flushed close is not honoured by the far end (a client that never closes). */
  setStubborn: (on: boolean) => void;
  /** Connections still open, for a test that counts leftovers. */
  openConnections: () => number;
  /**
   * One peer's broker socket drops (its data channels stay as they are). As PeerJS 1.5.5 does: the peer is no longer registered, it emits
   * `error` (`network`) and then `disconnected`, and `peer.disconnected` is true until the kit calls `peer.reconnect()`.
   */
  dropSocket: (peerId: string) => void;
  /**
   * The broker goes away (true: every registered peer's socket drops as in `dropSocket`, and no registration or dial gets through) or
   * comes back (false: every peer that asked to `reconnect()` registers again and emits `open`). Simpler than PeerJS, which fails each
   * reconnect and raises `disconnected` again: here a reconnect just waits, with `peer.open` false.
   */
  setBrokerDown: (down: boolean) => void;
  /**
   * One peer's network blinks and the broker never sees its socket close (wifi off and on, out of range). The peer sees what
   * `dropSocket` shows, but the broker keeps the registration, and, as PeerServer 1.0.2 does for an id it still holds with the same
   * token, swaps the new socket in and sends NO `OPEN` on the reconnect: `peer.open` stays false, with the socket working. Only
   * `peer.disconnect()` followed by a reconnect registers afresh and gets `open`.
   */
  blipSocket: (peerId: string) => void;
  /** Close every data channel of one peer, at both ends (a link that died and was noticed). */
  dropChannels: (peerId: string) => void;
  /** One device is gone without a word (a reload, a crash): nothing from it or to it arrives any more, and the far end sees no `close`. */
  vanish: (peerId: string) => void;
  /** Raise a PeerJS `error` on one peer (`webrtc`, `socket-closed`, ...), as PeerJS does for errors it does not tie to a connection. */
  peerError: (peerId: string, type: string, message?: string) => void;
  /** Raise `error` on one peer's data channels (at that peer's end only; with `farId`, only the channel to that device), as PeerJS does for a failed negotiation. */
  channelError: (peerId: string, farId?: string) => void;
  /** While true, a dial reaches the far peer but its channel never opens (a handshake that hangs). */
  setHandshakeStuck: (on: boolean) => void;
  /** Forget every peer and anything queued (between tests). */
  reset: () => void;
}

export function createFakePeerNet(): FakePeerNet {
  let queue: Array<() => void> = [];
  const broker = new Map<string, FakePeer>();
  let made = 0;
  let delivered = 0;
  const allConns = new Set<FakeConnection>();
  let stubborn = false;
  let brokerDown = false;
  let stuck = false;
  const peers = new Map<string, FakePeer>();
  const waiting = new Set<FakePeer>();
  const later = (fn: () => void) => queue.push(fn);

  class FakeConnection extends Emitter {
    open = false;
    closed = false;
    other: FakeConnection | null = null;
    /** The device at one end vanished: nothing arrives any more, and nobody is told. */
    dead = false;
    constructor(
      /** The id of the peer at the other end, as PeerJS's `conn.peer`. */
      public peer: string,
    ) {
      super();
      allConns.add(this);
    }
    send(msg: unknown): void {
      const to = this.other;
      if (!this.open || !to) return;
      const copy: unknown = JSON.parse(JSON.stringify(msg));
      later(() => {
        if (!to.open || to.dead || this.dead) return;
        delivered++;
        to.emit('data', copy);
      });
    }
    /** Like PeerJS's: the channel's own queue, which `room.backlog` reads. */
    dataChannel = { bufferedAmount: 0 };
    close(options?: { flush?: boolean }): void {
      if (options?.flush && !this.closed) {
        // messages already sent arrive first; like PeerJS's flushed close this only asks the far end to close,
        // and a `stubborn` far end (a modified client) does not
        later(() => {
          if (!stubborn) this.close();
        });
        return;
      }
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      later(() => {
        if (!this.dead) this.emit('close');
      });
      if (!this.dead) this.other?.close();
    }
  }

  class FakePeer extends Emitter {
    id: string;
    destroyed = false;
    /** As PeerJS: true from a lost broker socket until `reconnect()` is called. */
    disconnected = false;
    /** As PeerJS: the broker said `OPEN` for the socket in use. */
    open = false;
    /** The socket is up and the broker holds this id (true without `open` after a reconnect the broker answered with no `OPEN`). */
    private socketUp = false;
    conns: FakeConnection[] = [];
    constructor(...args: unknown[]) {
      super();
      this.id = typeof args[0] === 'string' ? args[0] : `anon${++made}`;
      peers.set(this.id, this);
      later(() => this.register());
    }
    /** The broker is back: register again. */
    reconnectNow(): void {
      this.register();
    }
    private register(): void {
      if (this.destroyed || this.disconnected || this.open) return;
      if (brokerDown) {
        waiting.add(this);
        return;
      }
      const there = broker.get(this.id);
      if (there && there !== this) {
        this.emit('error', { type: 'unavailable-id', message: `ID "${this.id}" is taken` });
        return;
      }
      this.socketUp = true;
      // (the broker still holds the registration: the socket is swapped in, and nothing is said)
      if (there === this) return;
      broker.set(this.id, this);
      this.open = true;
      this.emit('open', this.id);
    }
    connect(target: string): FakeConnection | undefined {
      // PeerJS 1.5.5 (bundler.mjs:1659-1663): a disconnected peer refuses, with an error and no connection
      if (this.disconnected) {
        this.emit('error', { type: 'disconnected', message: 'Cannot connect to new Peer after disconnecting from server.' });
        return undefined;
      }
      const mine = new FakeConnection(target);
      this.conns.push(mine);
      // (PeerJS's socket drops an offer sent while it is not open: the dial goes nowhere, and nothing says so)
      if (!this.socketUp || brokerDown) return mine;
      later(() => {
        if (this.destroyed || mine.closed || !this.socketUp || brokerDown) return;
        const remote = broker.get(target);
        if (!remote || remote.destroyed) {
          this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${target}` });
          return;
        }
        const theirs = new FakeConnection(this.id);
        remote.conns.push(theirs);
        mine.other = theirs;
        theirs.other = mine;
        remote.emit('connection', theirs);
        later(() => {
          if (stuck || mine.closed || theirs.closed) return;
          mine.open = true;
          theirs.open = true;
          theirs.emit('open');
          mine.emit('open');
        });
      });
      return mine;
    }
    reconnect(): void {
      if (this.destroyed) throw new Error('This peer cannot reconnect to the server. It has already been destroyed.');
      if (!this.disconnected) {
        if (this.open) throw new Error(`Peer ${this.id} cannot reconnect because it is not disconnected from the server!`);
        return;
      }
      this.disconnected = false;
      later(() => this.register());
    }
    /** `seen` false: the broker never noticed, and keeps the registration. */
    loseSocket(seen = true): void {
      if (this.destroyed || this.disconnected) return;
      waiting.delete(this);
      if (seen && broker.get(this.id) === this) broker.delete(this.id);
      this.open = false;
      this.socketUp = false;
      this.disconnected = true;
      this.emit('error', { type: 'network', message: 'Lost connection to server.' });
      this.emit('disconnected', this.id);
    }
    /** As PeerJS `disconnect()`: the socket is closed from this end (the broker sees it and drops the registration), then `disconnected`. */
    disconnect(): void {
      if (this.destroyed || this.disconnected) return;
      waiting.delete(this);
      if (broker.get(this.id) === this) broker.delete(this.id);
      this.open = false;
      this.socketUp = false;
      this.disconnected = true;
      this.emit('disconnected', this.id);
    }
    vanish(): void {
      this.destroyed = true;
      this.open = false;
      this.socketUp = false;
      waiting.delete(this);
      if (broker.get(this.id) === this) broker.delete(this.id);
      for (const c of this.conns) {
        c.dead = true;
        if (c.other) c.other.dead = true;
      }
    }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.open = false;
      this.socketUp = false;
      waiting.delete(this);
      if (broker.get(this.id) === this) broker.delete(this.id);
      for (const c of this.conns) c.close();
    }
  }

  return {
    Peer: FakePeer,
    flush: () => {
      // Each step may queue more (a dial queues its open); run until quiet.
      for (let i = 0; i < 10_000 && queue.length > 0; i++) queue.shift()!();
    },
    ids: () => [...broker.keys()],
    delivered: () => delivered,
    setBacklog: (peerId, bytes) => {
      for (const c of allConns) if (c.peer === peerId) c.dataChannel.bufferedAmount = bytes;
    },
    setStubborn: (on) => {
      stubborn = on;
    },
    openConnections: () => [...allConns].filter((c) => c.open).length,
    dropSocket: (peerId) => peers.get(peerId)?.loseSocket(),
    blipSocket: (peerId) => peers.get(peerId)?.loseSocket(false),
    setBrokerDown: (down) => {
      brokerDown = down;
      if (down) {
        for (const p of [...broker.values()]) p.loseSocket();
      } else {
        const back = [...waiting];
        waiting.clear();
        for (const p of back) later(() => p.reconnectNow());
      }
    },
    dropChannels: (peerId) => {
      for (const c of peers.get(peerId)?.conns ?? []) c.close();
    },
    vanish: (peerId) => peers.get(peerId)?.vanish(),
    peerError: (peerId, type, message) => peers.get(peerId)?.emit('error', { type, message: message ?? type }),
    channelError: (peerId, farId) => {
      for (const c of peers.get(peerId)?.conns ?? []) {
        if (!c.closed && (farId === undefined || c.peer === farId)) c.emit('error', { type: 'negotiation-failed', message: `Negotiation of connection to ${c.peer} failed.` });
      }
    },
    setHandshakeStuck: (on) => {
      stuck = on;
    },
    reset: () => {
      stubborn = false;
      brokerDown = false;
      stuck = false;
      peers.clear();
      waiting.clear();
      allConns.clear();
      queue = [];
      broker.clear();
      delivered = 0;
    },
  };
}
