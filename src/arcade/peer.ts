/**
 * Peer-to-peer transport built on PeerJS (WebRTC).
 *
 * Two devices connect with nothing but a short shared *game code*:
 *   • The host registers a peer whose id is derived from the code, then waits.
 *   • The guest dials that same id.
 *
 * The Family Arcade's own connection service (`CONNECTION_SERVICE`) handles
 * only the initial handshake; game data then flows directly device-to-device.
 * This class is deliberately dumb about
 * game rules — it moves opaque `Message`s and reports connection status. All
 * the resume/replay intelligence lives in the game layer, so when a link drops
 * and re-opens the app just re-runs its sync handshake over the new channel.
 *
 * Connections are opened with `reliable: true` (SCTP reliable, ordered). The
 * game layer relies on that guarantee: a message is never silently lost while
 * the channel stays open — a real failure closes the channel, which surfaces as
 * a reconnect and a full log resync. That is why the protocol only ever has to
 * reconcile prefix-compatible logs.
 */

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { kt } from './words';

export type ConnStatus =
  | 'idle'
  | 'hosting' // host is registered and waiting for a guest
  | 'dialing' // guest is trying to reach the host
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ConnectionHandlers<TMessage> {
  onStatus: (status: ConnStatus, detail?: string) => void;
  onMessage: (msg: TMessage) => void;
  /** Fires each time a data channel freshly opens — the cue to (re)sync. */
  onOpen: () => void;
  /** The broker says no such peer is registered. Return true to stop dialing
   * (the guest is told at once); otherwise the dial is retried until it times out. */
  onPeerUnavailable?: () => boolean;
}

/**
 * Per-game transport configuration. Each game supplies its own broker-id
 * `prefix` (so two games' 4-char codes never collide on the same peer id) and
 * an `isMessage` guard that validates inbound data before it reaches the game
 * layer — the single choke point that keeps malformed/forged wire data out.
 */
export interface ConnectionConfig<TMessage> {
  prefix: string;
  isMessage: (value: unknown) => value is TMessage;
  /** How long a guest keeps dialing before giving up (default 20 s). The
   * party passes minutes: the other iPad may be cold-starting the PWA. */
  dialTimeoutMs?: number;
}

const DIAL_RETRY_MS = 2500;
/** A lost broker socket is asked for again at most this often. */
export const RECONNECT_EVERY_MS = 1000;
/**
 * A broker that never saw our socket close (wifi off and on) keeps the registration, swaps the new socket in and sends no `OPEN`
 * (PeerServer 1.0.2 `_onSocketConnection`), so `peer.open` would stay false for good and no dial would ever go out again. A reconnect
 * not answered with `open` after this long is closed from our end: the broker then drops the registration and the next reconnect is
 * a fresh one, with `OPEN`. The wait doubles up to the cap, so a slow socket is not cut short every time.
 */
const OPEN_WAIT_MS = 3000;
const OPEN_WAIT_MAX_MS = 24_000;
export const DIAL_TIMEOUT_MS = 20000;

/**
 * Bytes queued to one person on a channel: what the data channel has not yet
 * put on the wire (`bufferedAmount`) plus what PeerJS holds back in its own
 * queue once the channel passes its 8 MiB mark. 0 if unknown.
 */
export function connBacklog(conn: DataConnection | null | undefined): number {
  if (!conn) return 0;
  const c = conn as unknown as { dataChannel?: { bufferedAmount?: number } | null; _buffer?: unknown };
  let bytes = c.dataChannel?.bufferedAmount ?? 0;
  if (Array.isArray(c._buffer)) {
    for (const item of c._buffer) {
      const size = (item as { byteLength?: number; size?: number } | null) ?? {};
      bytes += size.byteLength ?? size.size ?? 0;
    }
  }
  return Number.isFinite(bytes) ? bytes : 0;
}

/** Characters chosen to avoid look-alikes (no O/0, I/1, L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, 4);
}

/**
 * The Family Arcade's own connection service, on its server in Germany: the
 * one place this kit names it. `GameConnection` and `GameHost` both pass this
 * to `new Peer`.
 *   • The broker at familyarcade.eu/connect passes the first hello between two
 *     devices (WebSocket /connect/peerjs) and keeps no log. Any website may use
 *     it, so your game works on GitHub Pages and on localhost.
 *   • The STUN server tells each device the address the internet sees for it,
 *     so the two can reach each other directly. STUN only: it relays nothing.
 */
export const CONNECTION_SERVICE: PeerOptions = {
  host: 'familyarcade.eu',
  port: 443,
  secure: true,
  path: '/connect',
  config: { iceServers: [{ urls: 'stun:familyarcade.eu:3478' }] },
};

export class GameConnection<TMessage> {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private handlers: ConnectionHandlers<TMessage>;
  private prefix: string;
  private isMessage: (value: unknown) => value is TMessage;
  private role: 'host' | 'guest' = 'host';
  private code = '';
  private dialTimer: ReturnType<typeof setTimeout> | null = null;
  private dialDeadline = 0;
  private dialTimeoutMs: number;
  /** Host: until when a stale broker registration of our own id is retried. */
  private hostDeadline = 0;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAt = -Infinity;
  private openWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private openWaitMs = OPEN_WAIT_MS;
  /** A dial was put off because the broker socket was away: the next dial that goes out gets a full window. */
  private waitedForBroker = false;

  constructor(handlers: ConnectionHandlers<TMessage>, config: ConnectionConfig<TMessage>) {
    this.handlers = handlers;
    this.prefix = config.prefix;
    this.isMessage = config.isMessage;
    this.dialTimeoutMs = config.dialTimeoutMs ?? DIAL_TIMEOUT_MS;
  }

  private peerIdForCode(code: string): string {
    return this.prefix + code;
  }

  /** Host a new game. Returns the code the guest must enter. */
  host(code: string): void {
    this.role = 'host';
    this.code = code;
    this.destroyed = false;
    this.hostDeadline = Date.now() + this.dialTimeoutMs;
    this.handlers.onStatus('hosting');
    this.createPeer(this.peerIdForCode(code));
  }

  /** Join an existing game by code. */
  join(code: string): void {
    this.role = 'guest';
    this.code = code;
    this.destroyed = false;
    this.handlers.onStatus('dialing');
    this.dialDeadline = Date.now() + this.dialTimeoutMs;
    this.createPeer(undefined);
  }

  send(msg: TMessage): boolean {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
      return true;
    }
    return false;
  }

  /** Bytes queued to the other device (0 if unknown or not connected). */
  backlog(): number {
    return this.conn && this.conn.open ? connBacklog(this.conn) : 0;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.openWaitTimer) clearTimeout(this.openWaitTimer);
    this.openWaitTimer = null;
    if (this.dialTimer) clearTimeout(this.dialTimer);
    this.dialTimer = null;
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }

  // ── internals ─────────────────────────────────────────────────────────

  /**
   * Ask the broker again: at once the first time, then at most once every `RECONNECT_EVERY_MS`. While the network is away PeerJS
   * fails each reconnect straight away and raises `disconnected` again, which would otherwise spin.
   */
  private reconnectSoon(peer: Peer): void {
    if (this.reconnectTimer) return;
    const go = (): void => {
      this.reconnectAt = Date.now();
      try {
        peer.reconnect();
      } catch {
        /* peer already destroyed, or already connected again */
      }
      this.watchOpen(peer);
    };
    const wait = this.reconnectAt + RECONNECT_EVERY_MS - Date.now();
    if (wait <= 0) return go();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed && this.peer === peer) go();
    }, wait);
  }

  /** After a reconnect: no `open` in time and not `disconnected` means the broker kept the old registration. Close the socket and register afresh. */
  private watchOpen(peer: Peer): void {
    if (this.openWaitTimer) clearTimeout(this.openWaitTimer);
    const wait = this.openWaitMs;
    this.openWaitTimer = setTimeout(() => {
      this.openWaitTimer = null;
      if (this.destroyed || this.peer !== peer || peer.destroyed || peer.disconnected || peer.open) return;
      this.openWaitMs = Math.min(OPEN_WAIT_MAX_MS, wait * 2);
      this.reconnectAt = Date.now(); // the reconnect that follows waits RECONNECT_EVERY_MS: the broker has seen the close by then
      try {
        peer.disconnect(); // raises `disconnected`, whose handler reconnects
      } catch {
        /* already gone */
      }
    }, wait);
  }

  private createPeer(id: string | undefined): void {
    const peer = id ? new Peer(id, CONNECTION_SERVICE) : new Peer(CONNECTION_SERVICE);
    this.peer = peer;

    peer.on('open', () => {
      if (this.destroyed) return;
      if (this.openWaitTimer) clearTimeout(this.openWaitTimer);
      this.openWaitTimer = null;
      this.openWaitMs = OPEN_WAIT_MS;
      // The broker answers: at the join, and again after every reconnect of its socket. A reconnect with the channel alive dials
      // nothing: the game link never needed the broker, and a new dial would tear it down (or, past the join deadline, end the room).
      if (this.role === 'guest' && !this.live()) this.dial();
    });

    peer.on('connection', (conn) => {
      if (this.destroyed) return;
      // One guest at a time. While a channel is live, a NEW incoming
      // connection is a stranger who learned the code (the ids are guessable,
      // and anyone may use the broker) — refuse it rather than adopt it, or they'd be
      // handed the hello + full log sync and kick the real guest off. The
      // legitimate guest reconnecting only ever arrives after their old
      // channel closed, so this never blocks a resume.
      if (this.conn && this.conn.open && this.conn !== conn) {
        try {
          conn.on('open', () => conn.close());
          conn.close();
        } catch {
          /* refusing a stranger must never hurt the live game */
        }
        return;
      }
      // Host accepts the (re)connecting guest, replacing any stale channel.
      this.bindConnection(conn);
    });

    peer.on('disconnected', () => {
      if (this.destroyed) return;
      // (a guest whose channel is open has lost nothing it uses: the socket comes back behind the game's back)
      if (!this.guestLive()) this.handlers.onStatus('reconnecting', kt('kit.connection.brokerDropped'));
      this.reconnectSoon(peer);
    });

    peer.on('error', (err: { type?: string; message?: string }) => {
      if (this.destroyed) return;
      // A guest's open channel outlives every error PeerJS raises on the peer: once registered, PeerJS only disconnects from the
      // broker on an error (`_abort`, bundler.mjs:1722-1727) and keeps the connections, and the `disconnected` handler reconnects.
      if (this.guestLive()) return;
      if (err.type === 'webrtc' || err.type === 'disconnected') {
        // One handshake failed (PeerJS raises SDP and ICE-candidate errors on the peer, bundler.mjs:864-922), or a dial was refused
        // while the broker socket was away: that dial's problem. The channel still being made is dropped and the next dial makes a new one.
        if (this.role === 'guest') {
          this.dropHalfMade();
          this.handlers.onStatus('reconnecting', kt('kit.connection.hiccup'));
          this.scheduleDial();
        }
        return;
      }
      if (err.type === 'peer-unavailable') {
        // Host isn't online yet (or wrong code) — keep retrying until timeout.
        if (this.role === 'guest' && !this.handlers.onPeerUnavailable?.()) this.scheduleDial();
        return;
      }
      if (err.type === 'unavailable-id') {
        // Our own id is still registered on the broker — after a hard PWA
        // kill the old registration lingers for a few seconds. Reclaim it
        // rather than ending a remembered party on a screen nobody opened;
        // a genuinely taken code still errors once the deadline passes.
        if (this.role === 'host' && Date.now() < this.hostDeadline) {
          this.handlers.onStatus('reconnecting', kt('kit.connection.reclaiming'));
          try {
            peer.destroy();
          } catch {
            /* already gone */
          }
          if (this.dialTimer) clearTimeout(this.dialTimer);
          this.dialTimer = setTimeout(() => {
            if (!this.destroyed) this.createPeer(id);
          }, DIAL_RETRY_MS);
          return;
        }
        this.handlers.onStatus('error', kt('kit.connection.codeInUse'));
        return;
      }
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        this.handlers.onStatus('reconnecting', kt('kit.connection.hiccup'));
        return;
      }
      this.handlers.onStatus('error', err.message ?? kt('kit.connection.failed'));
    });
  }

  /** The data channel is open. */
  private live(): boolean {
    return this.conn !== null && this.conn.open;
  }

  private guestLive(): boolean {
    return this.role === 'guest' && this.live();
  }

  /** The broker socket is away (dropped, or `reconnect()` has not been answered yet): PeerJS refuses a dial, or drops its offer unsent. */
  private brokerAway(): boolean {
    const p = this.peer as unknown as { disconnected?: boolean; open?: boolean } | null;
    return !p || p.disconnected === true || p.open === false;
  }

  /** Forget a channel that never opened, quietly (its late events must not act). */
  private dropHalfMade(): void {
    const conn = this.conn;
    if (!conn || conn.open) return;
    this.conn = null;
    try {
      conn.removeAllListeners();
      conn.close();
    } catch {
      /* already gone */
    }
  }

  private dial(): void {
    if (this.destroyed || !this.peer) return;
    if (this.live()) return;
    if (this.brokerAway()) {
      // Wait for the broker instead of failing: a phone that wakes has both links down for a moment, and how long the socket takes
      // is not time spent dialling. The peer's `open` dials at once; this timer is the fallback.
      this.waitedForBroker = true;
      this.scheduleDial();
      return;
    }
    if (this.waitedForBroker) {
      this.waitedForBroker = false;
      this.dialDeadline = Date.now() + this.dialTimeoutMs;
    }
    if (Date.now() > this.dialDeadline) {
      this.handlers.onStatus('error', kt('kit.connection.unreachable'));
      return;
    }
    const conn = this.peer.connect(this.peerIdForCode(this.code), { reliable: true }) as DataConnection | undefined;
    // (PeerJS returns nothing when it refuses the dial; the retry below tries again)
    if (conn) this.bindConnection(conn);
    // If it doesn't open promptly, try again.
    this.scheduleDial();
  }

  private scheduleDial(): void {
    if (this.role !== 'guest' || this.destroyed) return;
    if (this.dialTimer) clearTimeout(this.dialTimer);
    this.dialTimer = setTimeout(() => {
      if (!this.live()) this.dial();
    }, DIAL_RETRY_MS);
  }

  private bindConnection(conn: DataConnection): void {
    // Drop any previous channel in favour of this one. Detach its listeners
    // first so a late 'close'/'error' from the stale conn can't fire after we've
    // already switched — otherwise it could stomp the new conn's 'connected'
    // status and schedule spurious re-dials.
    if (this.conn && this.conn !== conn) {
      try {
        this.conn.removeAllListeners();
        this.conn.close();
      } catch {
        /* ignore */
      }
    }
    this.conn = conn;

    // Every handler also verifies it's still the active connection, guarding
    // against events that were already queued when we swapped conns.
    const isCurrent = () => !this.destroyed && this.conn === conn;

    conn.on('open', () => {
      if (!isCurrent()) return;
      if (this.dialTimer) clearTimeout(this.dialTimer);
      this.dialTimer = null;
      this.handlers.onStatus('connected');
      this.handlers.onOpen();
    });

    conn.on('data', (data: unknown) => {
      if (!isCurrent()) return;
      if (this.isMessage(data)) this.handlers.onMessage(data);
    });

    conn.on('close', () => {
      if (!isCurrent()) return;
      this.handlers.onStatus('reconnecting', kt('kit.connection.linkClosed'));
      if (this.role === 'guest') {
        this.dialDeadline = Date.now() + this.dialTimeoutMs;
        this.scheduleDial();
      }
      // Host simply waits for the guest's peer to re-connect.
    });

    // An error on the channel (a failed negotiation, a closed link) is that channel's end: PeerJS closes it next, and a channel
    // closed here says nothing more, so this is handled as the close.
    conn.on('error', () => {
      if (!isCurrent()) return;
      this.conn = null;
      try {
        conn.removeAllListeners();
        conn.close();
      } catch {
        /* already gone */
      }
      this.handlers.onStatus('reconnecting', kt('kit.connection.linkClosed'));
      if (this.role === 'guest') {
        this.dialDeadline = Date.now() + this.dialTimeoutMs;
        this.scheduleDial();
      }
    });
  }
}
