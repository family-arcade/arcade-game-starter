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
  /** Forget every peer and anything queued (between tests). */
  reset: () => void;
}

export function createFakePeerNet(): FakePeerNet {
  let queue: Array<() => void> = [];
  const broker = new Map<string, FakePeer>();
  let made = 0;
  let delivered = 0;
  const later = (fn: () => void) => queue.push(fn);

  class FakeConnection extends Emitter {
    open = false;
    closed = false;
    other: FakeConnection | null = null;
    constructor(
      /** The id of the peer at the other end, as PeerJS's `conn.peer`. */
      public peer: string,
    ) {
      super();
    }
    send(msg: unknown): void {
      const to = this.other;
      if (!this.open || !to) return;
      const copy: unknown = JSON.parse(JSON.stringify(msg));
      later(() => {
        if (!to.open) return;
        delivered++;
        to.emit('data', copy);
      });
    }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      later(() => this.emit('close'));
      this.other?.close();
    }
  }

  class FakePeer extends Emitter {
    id: string;
    destroyed = false;
    private conns: FakeConnection[] = [];
    constructor(...args: unknown[]) {
      super();
      this.id = typeof args[0] === 'string' ? args[0] : `anon${++made}`;
      later(() => {
        if (this.destroyed) return;
        if (broker.has(this.id)) {
          this.emit('error', { type: 'unavailable-id', message: `ID "${this.id}" is taken` });
          return;
        }
        broker.set(this.id, this);
        this.emit('open', this.id);
      });
    }
    connect(target: string): FakeConnection {
      const mine = new FakeConnection(target);
      this.conns.push(mine);
      later(() => {
        if (this.destroyed || mine.closed) return;
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
          if (mine.closed || theirs.closed) return;
          mine.open = true;
          theirs.open = true;
          theirs.emit('open');
          mine.emit('open');
        });
      });
      return mine;
    }
    reconnect(): void {}
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
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
    reset: () => {
      queue = [];
      broker.clear();
      delivered = 0;
    },
  };
}
