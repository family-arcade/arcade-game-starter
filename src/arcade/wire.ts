/**
 * The one place inbound data from another device is checked.
 *
 * Everything that arrives over the network passes through `isWire` before the
 * kit (or your game) sees it: JSON objects only, at most 16 KB per game
 * message, and the kit's own `hello` / `people` messages with a valid player.
 */

import type { Player } from './player';
import { cleanName, isColour } from './player';

export const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_DEPTH = 24;
const MAX_NODES = 5000;

/** What actually travels between devices. Your game's messages ride inside `g`. */
export type Wire =
  | { k: 'hello'; name: string; colour: string }
  | { k: 'people'; you: string; list: WirePerson[] }
  | { k: 'g'; d: Record<string, unknown> };

export interface WirePerson extends Player {
  id: string;
  isHost: boolean;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** True if `v` is made only of JSON things (no functions, dates, NaN, cycles, __proto__). */
export function isJsonValue(v: unknown): boolean {
  let nodes = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (x === null || typeof x === 'boolean' || typeof x === 'string') return true;
    if (typeof x === 'number') return Number.isFinite(x);
    if (Array.isArray(x)) return x.every((i) => walk(i, depth + 1));
    if (isPlainObject(x)) {
      return Object.keys(x).every((k) => k !== '__proto__' && walk(x[k], depth + 1));
    }
    return false;
  };
  return walk(v, 0);
}

export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/**
 * Why a game message may not be sent or accepted, or null if it is fine.
 * Used for outgoing messages (to throw a clear error) and incoming ones.
 */
export function messageProblem(msg: unknown): string | null {
  if (!isPlainObject(msg)) return 'a message must be a plain object like { type: "move", x: 1 }';
  if (!isJsonValue(msg)) return 'a message may only contain numbers, text, true/false, null, lists and plain objects';
  const bytes = jsonBytes(msg);
  if (bytes > MAX_MESSAGE_BYTES) return `a message is ${Math.ceil(bytes / 1024)} KB but the limit is 16 KB`;
  return null;
}

export function isWire(v: unknown): v is Wire {
  if (!isPlainObject(v)) return false;
  switch (v.k) {
    case 'hello':
      return cleanName(v.name) !== null && isColour(v.colour);
    case 'people': {
      if (typeof v.you !== 'string' || v.you.length > 64) return false;
      const list = v.list;
      if (!Array.isArray(list) || list.length > 8) return false;
      return list.every(
        (p) =>
          isPlainObject(p) &&
          typeof p.id === 'string' &&
          p.id.length > 0 &&
          p.id.length <= 64 &&
          typeof p.isHost === 'boolean' &&
          cleanName(p.name) !== null &&
          isColour(p.colour),
      );
    }
    case 'g':
      return messageProblem(v.d) === null;
    default:
      return false;
  }
}
