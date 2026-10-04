/** Who is playing: a name and a colour. This is all the arcade ever knows about a child. */
export interface Player {
  name: string;
  /** '#rrggbb' */
  colour: string;
}

export const MAX_NAME_LENGTH = 20;

const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

export function isColour(v: unknown): v is string {
  return typeof v === 'string' && COLOUR_RE.test(v);
}

/** The trimmed name if it is 1 to 20 characters, otherwise null. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  const length = Array.from(name).length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? name : null;
}

/** A valid, tidy copy of a player, or null if the name or colour is not acceptable. */
export function cleanPlayer(v: unknown): Player | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as { name?: unknown; colour?: unknown };
  const name = cleanName(p.name);
  if (name === null || !isColour(p.colour)) return null;
  return { name, colour: p.colour.toLowerCase() };
}
