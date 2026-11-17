/**
 * Host side of a star: one device that several guests dial at once.
 *
 * Guests are unchanged — each one still calls `GameConnection.join(code)` and
 * sees a single channel to the host. The host registers the same broker id a
 * `GameConnection.host(code)` would, so a code means the same thing either way,
 * and keeps a channel per guest, keyed by the guest's PeerJS peer id.
 *
 * Like `GameConnection`, this moves opaque messages and reports who is
 * connected; the game layer decides what to say to each guest. `onGuestOpen`
 * is the cue to sync that one guest, so a guest who drops and dials back in
 * gets caught up without disturbing the others. Channels are reliable and
 * ordered, as on the two-device transport.
 */

import Peer, { type DataConnection } from 'peerjs';
import { kt } from './words';
import { CONNECTION_SERVICE, DIAL_TIMEOUT_MS, connBacklog, type ConnStatus, type ConnectionConfig } from './peer';

export interface HostHandlers<TMessage> {
  onStatus: (status: ConnStatus, detail?: string) => void;
  /** A guest's channel freshly opened (first join or a reconnect) — sync them. */
  onGuestOpen: (guestId: string) => void;
  /** A guest's channel closed; their seat is free again. */
  onGuestClose: (guestId: string) => void;
  onMessage: (guestId: string, msg: TMessage) => void;
}

export interface HostConfig<TMessage> extends ConnectionConfig<TMessage> {
  /** Live guests accepted at once (default 3, so four devices in all). */
  maxGuests?: number;
  /** Sent to a newcomer turned away from a full table, just before the channel closes. */
  fullMessage?: TMessage;
}

const RETRY_MS = 2500;
const DEFAULT_MAX_GUESTS = 3;
/** A refused newcomer's channel is force-closed this long after the host's message if the newcomer has not closed it, or if it never opens. */
const REFUSE_CLOSE_MS = 3000;
const REFUSE_OPEN_MS = 10_000;

export class GameHost<TMessage> {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private handlers: HostHandlers<TMessage>;
  private prefix: string;
  private isMessage: (value: unknown) => value is TMessage;
  private maxGuests: number;
  private fullMessage: TMessage | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Until when a stale broker registration of our own id is retried. */
  private hostDeadline = 0;
  private dialTimeoutMs: number;
  private destroyed = false;

  constructor(handlers: HostHandlers<TMessage>, config: HostConfig<TMessage>) {
    this.handlers = handlers;
    this.prefix = config.prefix;
    this.isMessage = config.isMessage;
    this.maxGuests = config.maxGuests ?? DEFAULT_MAX_GUESTS;
    this.fullMessage = config.fullMessage;
    this.dialTimeoutMs = config.dialTimeoutMs ?? DIAL_TIMEOUT_MS;
  }

  /** Register under the code; guests dial `prefix + code`. */
  host(code: string): void {
    this.destroyed = false;
    this.hostDeadline = Date.now() + this.dialTimeoutMs;
    this.handlers.onStatus('hosting');
    this.createPeer(this.prefix + code);
  }

  /** Ids of the guests whose channel is open right now. */
  guests(): string[] {
    return [...this.conns].filter(([, c]) => c.open).map(([id]) => id);
  }

  send(guestId: string, msg: TMessage): boolean {
    const conn = this.conns.get(guestId);
    if (!conn || !conn.open) return false;
    conn.send(msg);
    return true;
  }

  /** Bytes queued to one guest (0 if unknown or not connected). */
  backlog(guestId: string): number {
    const conn = this.conns.get(guestId);
    return conn && conn.open ? connBacklog(conn) : 0;
  }

  /** Send to every open guest; returns how many it reached. */
  broadcast(msg: TMessage): number {
    let sent = 0;
    for (const conn of this.conns.values()) {
      if (!conn.open) continue;
      conn.send(msg);
      sent++;
    }
    return sent;
  }

  /** Remove a guest. They may dial back in; the host decides whether to let them. */
  kick(guestId: string): void {
    const conn = this.conns.get(guestId);
    if (!conn) return;
    const wasOpen = conn.open;
    this.drop(guestId, conn);
    if (wasOpen) this.afterGuestLeft(guestId);
    // (a channel still opening was never announced, so it leaves quietly)
  }

  destroy(): void {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const [id, conn] of this.conns) this.drop(id, conn);
    this.peer?.destroy();
    this.peer = null;
  }

  // ── internals ─────────────────────────────────────────────────────────

  /** Forget a channel and close it, silencing its listeners first so a late
   * 'close' from it can't be mistaken for a live guest leaving. */
  private drop(guestId: string, conn: DataConnection): void {
    if (this.conns.get(guestId) === conn) this.conns.delete(guestId);
    try {
      conn.removeAllListeners();
      conn.close();
    } catch {
      /* already gone */
    }
  }

  /**
   * Turn a newcomer away from a full table: once its channel opens, say why (`fullMessage`) and close after the message. A flushed close
   * only asks the other end to close, so a newcomer that never does is closed here after `REFUSE_CLOSE_MS`; a channel that never opens
   * is closed after `REFUSE_OPEN_MS`. A stranger dialing again and again must not pile up connections on the host's device.
   */
  private refuse(conn: DataConnection): void {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const closeNow = () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      try {
        conn.close();
      } catch {
        /* refusing a stranger must never hurt the live game */
      }
    };
    try {
      timers.add(setTimeout(closeNow, REFUSE_OPEN_MS));
      conn.on('open', () => {
        try {
          if (this.fullMessage !== undefined) conn.send(this.fullMessage);
          conn.close({ flush: true });
        } catch {
          /* the timers below still close it */
        }
        timers.add(setTimeout(closeNow, REFUSE_CLOSE_MS));
      });
      conn.on('close', () => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
      });
    } catch {
      closeNow();
    }
  }

  private afterGuestLeft(guestId: string): void {
    this.handlers.onGuestClose(guestId);
    if (this.guests().length === 0) this.handlers.onStatus('hosting');
  }

  private createPeer(id: string): void {
    const peer = new Peer(id, CONNECTION_SERVICE);
    this.peer = peer;

    peer.on('open', () => {
      if (this.destroyed) return;
      this.handlers.onStatus(this.guests().length > 0 ? 'connected' : 'hosting');
    });

    peer.on('connection', (conn) => {
      if (this.destroyed) return;
      const guestId = conn.peer;
      const existing = this.conns.get(guestId);
      // A full table turns a newcomer away. The ids are guessable and anyone may
      // use the broker, so a stranger must not be handed the sync. A known guest is
      // never "past the limit": they are coming back and take their own seat.
      if (!existing && this.conns.size >= this.maxGuests) {
        this.refuse(conn);
        return;
      }
      // The same guest dialing again (a wifi blip, a reloaded PWA) replaces
      // their old channel, which may not have noticed it died yet.
      if (existing && existing !== conn) this.drop(guestId, existing);
      this.bind(guestId, conn);
    });

    peer.on('disconnected', () => {
      if (this.destroyed) return;
      this.handlers.onStatus('reconnecting', kt('kit.connection.brokerDropped'));
      try {
        peer.reconnect();
      } catch {
        /* peer already destroyed */
      }
    });

    peer.on('error', (err: { type?: string; message?: string }) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        // Our own id is still registered on the broker — after a hard PWA
        // kill the old registration lingers for a few seconds. Reclaim it
        // rather than ending a remembered party on a screen nobody opened;
        // a genuinely taken code still errors once the deadline passes.
        if (Date.now() < this.hostDeadline) {
          this.handlers.onStatus('reconnecting', kt('kit.connection.reclaiming'));
          try {
            peer.destroy();
          } catch {
            /* already gone */
          }
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => {
            if (!this.destroyed) this.createPeer(id);
          }, RETRY_MS);
          return;
        }
        this.handlers.onStatus('error', kt('kit.connection.codeInUse'));
        return;
      }
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        this.handlers.onStatus('reconnecting', kt('kit.connection.hiccup'));
        return;
      }
      // A failed guest dial (peer-unavailable and the like) is theirs to retry.
      if (err.type === 'peer-unavailable') return;
      this.handlers.onStatus('error', err.message ?? kt('kit.connection.failed'));
    });
  }

  private bind(guestId: string, conn: DataConnection): void {
    this.conns.set(guestId, conn);
    // Events already queued when a channel was replaced must not act.
    const isCurrent = () => !this.destroyed && this.conns.get(guestId) === conn;

    let opened = false;
    conn.on('open', () => {
      if (!isCurrent()) return;
      opened = true;
      this.handlers.onStatus('connected');
      this.handlers.onGuestOpen(guestId);
    });

    conn.on('data', (data: unknown) => {
      if (!isCurrent()) return;
      if (this.isMessage(data)) this.handlers.onMessage(guestId, data);
    });

    // A channel that never opened frees its seat quietly: nobody was told it
    // joined, so nobody needs to hear it left.
    conn.on('close', () => {
      if (!isCurrent()) return;
      this.conns.delete(guestId);
      if (opened) this.afterGuestLeft(guestId);
    });
  }
}
