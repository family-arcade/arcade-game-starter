/**
 * Handoff from the family arcade (spec v1).
 *
 * The arcade opens a game at `<gameUrl>#arcade=<payload>` where payload is
 * base64url (no padding) of UTF-8 JSON
 *   {"v":1,"name":"Klara","colour":"#e0405f","back":"https://familyarcade.eu/"}
 *
 * It travels in the URL fragment, which the browser never sends to any server.
 */

import { cleanName, isColour } from './player';

export interface Handoff {
  name: string;
  /** '#rrggbb', lower case */
  colour: string;
  /** An https: address the "back to the arcade" button goes to. */
  back: string;
}

export const BACK_KEY = 'arcade-kit:back';

export function encodeHandoff(h: Handoff): string {
  const json = JSON.stringify({ v: 1, name: h.name, colour: h.colour, back: h.back });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The handoff in `payload`, or null if it is not exactly what spec v1 allows. */
export function decodeHandoff(payload: unknown): Handoff | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) return null;
  let data: unknown;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1) return null;
  const name = cleanName(d.name);
  if (name === null || !isColour(d.colour)) return null;
  if (typeof d.back !== 'string') return null;
  let back: URL;
  try {
    back = new URL(d.back);
  } catch {
    return null;
  }
  if (back.protocol !== 'https:') return null;
  return { name, colour: d.colour.toLowerCase(), back: back.href };
}

interface HandoffWindow {
  location: { hash: string; pathname: string; search: string };
  history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
}

/**
 * Read the handoff from the address bar, remember `back` for this tab, and
 * remove it from the address bar (keeping any other fragment). Returns the
 * handoff, or null if there was none or it was invalid (invalid ones are
 * ignored, and are removed from the address bar too).
 */
export function consumeHandoff(win: HandoffWindow, session: Pick<Storage, 'setItem'> | null): Handoff | null {
  const params = new URLSearchParams(win.location.hash.replace(/^#/, ''));
  if (!params.has('arcade')) return null;
  const handoff = decodeHandoff(params.get('arcade'));
  params.delete('arcade');
  const rest = params.toString();
  try {
    win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search + (rest ? `#${rest}` : ''));
  } catch {
    /* some embedded browsers refuse; the handoff still worked */
  }
  if (!handoff) return null;
  try {
    session?.setItem(BACK_KEY, handoff.back);
  } catch {
    /* private mode: the back button just won't show */
  }
  return handoff;
}
