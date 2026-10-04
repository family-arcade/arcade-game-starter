/**
 * Play together: up to 4 devices, one host and up to 3 guests.
 *
 * The host is in charge. Guests only ever talk to the host; the host can talk
 * to everyone. Your game's messages are plain JSON objects. The kit adds its
 * own tiny `hello` and `people` messages so everyone has names and colours.
 */

import { GameConnection, generateCode, normalizeCode, type ConnStatus } from './peer';
import { GameHost } from './host';
import { cleanName, type Player } from './player';
import { isWire, messageProblem, type Wire } from './wire';

export const HOST_ID = 'host';
const MAX_GUESTS = 3;
const HOST_READY_MS = 15_000;
const JOIN_MS = 18_000;

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
  /** Host only: send to one person by id. */
  sendTo(id: string, msg: object): void;
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
  abstract sendTo(id: string, msg: object): void;
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
      { prefix, isMessage: isWire, maxGuests: MAX_GUESTS },
    );
  }

  /** Resolves once the code is registered with the matchmaker. */
  start(): Promise<HostRoom> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.net.destroy();
        this.finish();
        reject(new Error("Couldn't make a code. Check your internet connection and try again."));
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
        this.settle.fail(new Error(detail ?? "Couldn't make a code. Try again."));
        this.settle = null;
        return;
      }
    }
    this.setStatus(mapStatus(s), detail);
  }

  private onWire(id: string, w: Wire): void {
    if (w.k === 'hello') {
      this.guests.set(id, { name: cleanName(w.name) ?? 'Player', colour: w.colour.toLowerCase() });
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

  sendTo(id: string, msg: object): void {
    checkOutgoing(msg, 'sendTo');
    this.net.send(id, { k: 'g', d: msg as Record<string, unknown> });
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

  constructor(code: string, private me: Player, prefix: string) {
    super(code);
    this.net = new GameConnection<Wire>(
      {
        onStatus: (s, d) => this.onNet(s, d),
        onMessage: (w) => this.onWire(w),
        onOpen: () => void this.net.send({ k: 'hello', name: this.me.name, colour: this.me.colour }),
      },
      { prefix, isMessage: isWire, dialTimeoutMs: JOIN_MS },
    );
  }

  /** Resolves once the host has told us who is here (so `people` is filled in). */
  start(): Promise<GuestRoom> {
    return new Promise((resolve, reject) => {
      const give = (e: Error) => {
        clearTimeout(timer);
        this.joined = null;
        this.net.destroy();
        this.finish();
        reject(e);
      };
      const timer = setTimeout(
        () => give(new Error(`Couldn't join ${this.code}. Check the code, make sure the host is online, and that the game isn't full.`)),
        JOIN_MS,
      );
      this.joined = {
        ok: () => {
          clearTimeout(timer);
          this.joined = null;
          resolve(this);
        },
        fail: give,
      };
      this.net.join(this.code);
    });
  }

  private onNet(s: ConnStatus, detail?: string): void {
    if (this.joined) {
      // Until the host answers, only a hard failure matters; the timeout covers the rest.
      if (s === 'error') this.joined.fail(new Error(detail ?? "Couldn't join. Try again."));
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
    } else if (w.k === 'g' && !this.joined) {
      this.deliver(w.d, HOST_ID);
    }
  }

  send(msg: object): void {
    checkOutgoing(msg, 'send');
    this.net.send({ k: 'g', d: msg as Record<string, unknown> });
  }

  sendTo(): void {
    throw new Error('room.sendTo: only the host can send to one person. Guests use room.send(msg), which goes to the host.');
  }

  leave(): void {
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

  const me = (): Player => getPlayer() ?? { name: 'Player', colour: '#3d6bd6' };
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
      if (code.length !== 4) throw new Error('A code has 4 letters or numbers, like K7QM.');
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
