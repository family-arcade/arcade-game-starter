/**
 * Play together: up to 4 devices, one host and up to 3 guests.
 *
 * The host is in charge. Guests only ever talk to the host; the host can talk
 * to everyone. Your game's messages are plain JSON objects. The kit adds its
 * own tiny `hello` and `people` messages so everyone has names and colours.
 */

import { kt } from './words';
import { GameConnection, generateCode, normalizeCode, type ConnStatus } from './peer';
import { GameHost } from './host';
import { cleanName, DEFAULT_PLAYER, type Player } from './player';
import { isWire, messageProblem, type Wire } from './wire';

export const HOST_ID = 'host';
const MAX_GUESTS = 3;
const HOST_READY_MS = 15_000;
const JOIN_MS = 18_000;
/** A join keeps dialling this long after the broker first says "no such code" (a right code whose host is away for a moment) before it fails as `no-room`. */
export const NO_ROOM_MS = 4000;

/** One device in the room. `id` is what `room.sendTo` wants and what `onMessage` reports. */
export interface Person {
  id: string;
  name: string;
  /** '#rrggbb' */
  colour: string;
  isHost: boolean;
  /** true for the entry that is this device */
  me: boolean;
}

/** A message from your game. Any plain object that is numbers, text, true/false, null, lists and objects. */
export type GameMessage = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SendOptions {
  /** Skip the message when more than this many bytes are already queued to the person. */
  dropIfBusy?: number;
}

export type JoinFailure = 'no-room' | 'full' | 'timeout';

/** Why `join` failed: `no-room` (no such code), `full` (4 people already) or `timeout` (nobody answered). */
export class JoinError extends Error {
  constructor(
    readonly reason: JoinFailure,
    message: string,
  ) {
    super(message);
    this.name = 'JoinError';
  }
}

export type TogetherStatus = 'waiting' | 'connected' | 'reconnecting' | 'error' | 'left';

export interface Room {
  /** The 4-letter code friends type to join. */
  readonly code: string;
  readonly isHost: boolean;
  /** Everyone here right now, host first. Read it fresh whenever you need it. */
  readonly people: Person[];
  readonly status: TogetherStatus;
  /** Called when someone joins or leaves. Returns a function that stops listening. */
  onPeople(cb: (people: Person[]) => void): () => void;
  /** Called for each game message. On the host `fromId` is the guest's id; on a guest it is "host". */
  onMessage(cb: (msg: GameMessage, fromId: string) => void): () => void;
  /** Called when the connection changes (connected, reconnecting, error, left). */
  onStatus(cb: (status: TogetherStatus, detail?: string) => void): () => void;
  /** A guest sends to the host. The host sends to everyone. Throws if the message is not allowed (16 KB max). */
  send(msg: object): void;
  /**
   * Host only: send to one person by id. With `{ dropIfBusy: bytes }` the message is
   * skipped, and `false` returned, when more than that many bytes are still queued to
   * that person (a slow link): use it for state that the next message replaces.
   * Returns `true` unless the message was dropped for being busy (it does not say the person's channel is open).
   */
  sendTo(id: string, msg: object, opts?: SendOptions): boolean;
  /** Bytes queued to one person and not yet on the wire (0 if unknown or not connected). A guest can ask about `"host"`. */
  backlog(id: string): number;
  /**
   * Host only: take one person out of the room (a device that went silent, or said goodbye). Their seat is free at once and
   * everyone's `people` updates. Their channel is closed, so a device that is still there dials back in by itself.
   */
  kick(id: string): void;
  /** Leave (a host leaving ends the room for everyone). */
  leave(): void;
}

function mapStatus(s: ConnStatus): TogetherStatus {
  switch (s) {
    case 'connected':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    case 'error':
      return 'error';
    default:
      return 'waiting';
  }
}

function checkOutgoing(msg: unknown, fn: string): void {
  const problem = messageProblem(msg);
  if (problem) throw new Error(`room.${fn}: ${problem}.`);
}

abstract class RoomBase implements Room {
  abstract readonly isHost: boolean;
  people: Person[] = [];
  status: TogetherStatus = 'waiting';
  protected peopleCbs = new Set<(p: Person[]) => void>();
  protected messageCbs = new Set<(m: GameMessage, from: string) => void>();
  protected statusCbs = new Set<(s: TogetherStatus, d?: string) => void>();

  constructor(readonly code: string) {}

  onPeople(cb: (people: Person[]) => void) {
    this.peopleCbs.add(cb);
    return () => void this.peopleCbs.delete(cb);
  }
  onMessage(cb: (msg: GameMessage, fromId: string) => void) {
    this.messageCbs.add(cb);
    return () => void this.messageCbs.delete(cb);
  }
  onStatus(cb: (status: TogetherStatus, detail?: string) => void) {
    this.statusCbs.add(cb);
    return () => void this.statusCbs.delete(cb);
  }

  abstract send(msg: object): void;
  abstract sendTo(id: string, msg: object, opts?: SendOptions): boolean;
  abstract backlog(id: string): number;
  abstract kick(id: string): void;
  abstract leave(): void;

  protected setStatus(s: TogetherStatus, detail?: string): void {
    if (this.status === 'left') return;
    if (s === this.status && detail === undefined) return;
    this.status = s;
    for (const cb of [...this.statusCbs]) cb(s, detail);
  }
  protected emitPeople(): void {
    const snapshot = this.people.map((p) => ({ ...p }));
    for (const cb of [...this.peopleCbs]) cb(snapshot);
  }
  protected deliver(msg: GameMessage, from: string): void {
    for (const cb of [...this.messageCbs]) cb(msg, from);
  }
  protected finish(): void {
    if (this.status === 'left') return;
    this.setStatus('left');
    this.peopleCbs.clear();
    this.messageCbs.clear();
    this.statusCbs.clear();
  }
}

class HostRoom extends RoomBase {
  readonly isHost = true;
  private guests = new Map<string, Player>();
  private net: GameHost<Wire>;
  private settle: { ok: () => void; fail: (e: Error) => void } | null = null;
  private starting = true;

  constructor(code: string, private me: Player, prefix: string) {
    super(code);
    this.rebuildPeople();
    this.net = new GameHost<Wire>(
      {
        onStatus: (s, d) => this.onNet(s, d),
        onGuestOpen: () => {
          /* wait for their hello before they count as a person */
        },
        onGuestClose: (id) => {
          if (this.guests.delete(id)) this.refresh();
        },
        onMessage: (id, w) => this.onWire(id, w),
      },
      { prefix, isMessage: isWire, maxGuests: MAX_GUESTS, fullMessage: { k: 'full' } },
    );
  }

  /** Resolves once the code is registered with the matchmaker. */
  start(): Promise<HostRoom> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.net.destroy();
        this.finish();
        reject(new Error(kt('kit.connection.noCode')));
      }, HOST_READY_MS);
      this.settle = {
        ok: () => {
          clearTimeout(timer);
          resolve(this);
        },
        fail: (e) => {
          clearTimeout(timer);
          this.net.destroy();
          this.finish();
          reject(e);
        },
      };
      // GameHost reports 'hosting' synchronously when asked, then again once
      // the code is really registered; `starting` skips the first one.
      this.net.host(this.code);
      this.starting = false;
    });
  }

  private onNet(s: ConnStatus, detail?: string): void {
    if (this.starting) return;
    if (this.settle) {
      if (s === 'hosting' || s === 'connected') {
        const { ok } = this.settle;
        this.settle = null;
        this.setStatus('waiting');
        ok();
        return;
      }
      if (s === 'error') {
        this.settle.fail(new Error(detail ?? kt('kit.connection.noCodeRetry')));
        this.settle = null;
        return;
      }
    }
    this.setStatus(mapStatus(s), detail);
  }

  private onWire(id: string, w: Wire): void {
    if (w.k === 'hello') {
      this.guests.set(id, { name: cleanName(w.name) ?? DEFAULT_PLAYER.name, colour: w.colour.toLowerCase() });
      this.refresh();
    } else if (w.k === 'g' && this.guests.has(id)) {
      this.deliver(w.d, id);
    }
  }

  private rebuildPeople(): void {
    this.people = [
      { id: HOST_ID, name: this.me.name, colour: this.me.colour, isHost: true, me: true },
      ...[...this.guests].map(([id, p]) => ({ id, name: p.name, colour: p.colour, isHost: false, me: false })),
    ];
  }

  private refresh(): void {
    this.rebuildPeople();
    for (const id of this.guests.keys()) {
      this.net.send(id, {
        k: 'people',
        you: id,
        list: this.people.map(({ id: pid, name, colour, isHost }) => ({ id: pid, name, colour, isHost })),
      });
    }
    this.emitPeople();
  }

  send(msg: object): void {
    checkOutgoing(msg, 'send');
    this.net.broadcast({ k: 'g', d: msg as Record<string, unknown> });
  }

  sendTo(id: string, msg: object, opts?: SendOptions): boolean {
    checkOutgoing(msg, 'sendTo');
    if (opts?.dropIfBusy !== undefined && this.net.backlog(id) > opts.dropIfBusy) return false;
    this.net.send(id, { k: 'g', d: msg as Record<string, unknown> });
    return true;
  }

  backlog(id: string): number {
    return this.net.backlog(id);
  }

  kick(id: string): void {
    // (GameHost reports an open channel's end through `onGuestClose`, which updates the people)
    this.net.kick(id);
  }

  leave(): void {
    this.net.destroy();
    this.finish();
  }
}

class GuestRoom extends RoomBase {
  readonly isHost = false;
  private net: GameConnection<Wire>;
  private myId = '';
  private joined: { ok: () => void; fail: (e: Error) => void } | null = null;
  private noRoomTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, private me: Player, prefix: string) {
    super(code);
    this.net = new GameConnection<Wire>(
      {
        onStatus: (s, d) => this.onNet(s, d),
        onMessage: (w) => this.onWire(w),
        onOpen: () => {
          // (the host is there after all: the code was right)
          this.clearNoRoom();
          this.net.send({ k: 'hello', name: this.me.name, colour: this.me.colour });
        },
        // While joining, "no such peer" is a wrong code, or a right one whose host is away for a moment (its device asleep or in
        // another app, its socket coming back). Keep dialling for NO_ROOM_MS from the first such answer before saying the code is wrong.
        onPeerUnavailable: () => {
          if (!this.joined || this.noRoomTimer) return false;
          this.noRoomTimer = setTimeout(() => {
            this.noRoomTimer = null;
            this.joined?.fail(new JoinError('no-room', kt('kit.connection.wrongCode')));
          }, NO_ROOM_MS);
          return false;
        },
      },
      { prefix, isMessage: isWire, dialTimeoutMs: JOIN_MS },
    );
  }

  /** Resolves once the host has told us who is here (so `people` is filled in). */
  start(): Promise<GuestRoom> {
    return new Promise((resolve, reject) => {
      const give = (e: Error) => {
        clearTimeout(timer);
        this.clearNoRoom();
        this.joined = null;
        this.net.destroy();
        this.finish();
        reject(e);
      };
      const timer = setTimeout(
        () => give(new JoinError('timeout', kt('kit.connection.joinFailed', { code: this.code }))),
        JOIN_MS,
      );
      this.joined = {
        ok: () => {
          clearTimeout(timer);
          this.clearNoRoom();
          this.joined = null;
          resolve(this);
        },
        fail: give,
      };
      this.net.join(this.code);
    });
  }

  private clearNoRoom(): void {
    if (this.noRoomTimer) clearTimeout(this.noRoomTimer);
    this.noRoomTimer = null;
  }

  private onNet(s: ConnStatus, detail?: string): void {
    if (this.joined) {
      // Until the host answers, only a hard failure matters; the timeout covers the rest.
      if (s === 'error') this.joined.fail(new Error(detail ?? kt('kit.connection.joinRetry')));
      return;
    }
    this.setStatus(mapStatus(s), detail);
  }

  private onWire(w: Wire): void {
    if (w.k === 'people') {
      this.myId = w.you;
      this.people = w.list.map((p) => ({ ...p, colour: p.colour.toLowerCase(), me: p.id === w.you }));
      this.setStatus('connected');
      this.joined?.ok();
      this.emitPeople();
    } else if (w.k === 'full') {
      this.joined?.fail(new JoinError('full', kt('kit.connection.roomFull')));
    } else if (w.k === 'g' && !this.joined) {
      this.deliver(w.d, HOST_ID);
    }
  }

  send(msg: object): void {
    checkOutgoing(msg, 'send');
    this.net.send({ k: 'g', d: msg as Record<string, unknown> });
  }

  sendTo(): boolean {
    throw new Error('room.sendTo: only the host can send to one person. Guests use room.send(msg), which goes to the host.');
  }

  backlog(id: string): number {
    return id === HOST_ID ? this.net.backlog() : 0;
  }

  kick(): void {
    throw new Error('room.kick: only the host can take someone out of the room.');
  }

  leave(): void {
    // leaving while still joining ends the join now (no 18 s timer left running, no promise left hanging)
    this.joined?.fail(new Error(kt('kit.connection.lost')));
    this.net.destroy();
    this.finish();
  }

  get id(): string {
    return this.myId;
  }
}

export interface TogetherDeps {
  gameId: string;
  getPlayer: () => Player | null;
}

export interface Together {
  /** Make a new 4-letter code and wait for friends. */
  host(): Promise<Room>;
  /** Join a friend's code. Letters are tidied up for you (any case, spaces ignored). */
  join(code: string): Promise<Room>;
  /** The room this device is in right now, if any. */
  current(): Room | null;
}

export function createTogether({ gameId, getPlayer }: TogetherDeps): Together {
  // The game id is in the broker id, so two games' codes can never collide.
  const prefix = `ak1-${gameId}-`;
  let active: Room | null = null;

  const me = (): Player => getPlayer() ?? DEFAULT_PLAYER;
  const forget = (room: RoomBase) => {
    room.onStatus((s) => {
      if (s === 'left' && active === room) active = null;
    });
  };

  return {
    async host() {
      active?.leave();
      const room = new HostRoom(generateCode(), me(), prefix);
      active = room;
      try {
        await room.start();
      } catch (e) {
        if (active === room) active = null;
        throw e;
      }
      forget(room);
      return room;
    },

    async join(rawCode: string) {
      const code = normalizeCode(rawCode);
      if (code.length !== 4) throw new Error(kt('kit.connection.codeLength'));
      active?.leave();
      const room = new GuestRoom(code, me(), prefix);
      active = room;
      try {
        await room.start();
      } catch (e) {
        if (active === room) active = null;
        throw e;
      }
      forget(room);
      return room;
    },

    current: () => active,
  };
}
