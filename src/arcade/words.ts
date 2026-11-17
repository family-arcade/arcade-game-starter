/**
 * The kit's words: every sentence the kit puts on screen, in English, as `kit.*` keys. This file is the
 * kit's own and is copied with it; the kit needs nothing from the game. A game can add to or change these
 * words with `arcade.words.use(catalog)` (keys must be ones listed here). The kit's lookup never throws:
 * an unknown key returns the key, and dev warns once.
 *
 * Messages use `{name}` slots and nothing else.
 */

export const kitWords = {
  'kit.player.title': 'Player',
  'kit.player.titleNew': 'New player',
  'kit.player.name': 'Name',
  'kit.player.nameError': 'Type a name with 1 to 20 letters.',
  'kit.player.colour': 'Colour',
  'kit.player.colourOption': 'Colour {n}',
  'kit.player.go': "Let's play",
  'kit.together.title': 'Play together',
  'kit.together.room': 'Room {code}',
  'kit.together.close': 'Close',
  'kit.together.playingAs': 'Playing as {name}',
  'kit.together.makeCode': 'Make a code',
  'kit.together.making': 'Making your code…',
  'kit.together.haveCode': 'I have a code',
  'kit.together.codeInput': 'Four-letter code',
  'kit.together.codePlaceholder': 'ABCD',
  'kit.together.join': 'Join',
  'kit.together.joining': 'Joining…',
  'kit.together.yourCode': 'Your code',
  'kit.together.joined': 'Joined',
  'kit.together.codeLabel': 'Code {code}',
  'kit.together.hintHost': 'Friends tap "{haveCode}" and type this.',
  'kit.together.hintGuest': 'You are in this game.',
  'kit.together.whoIsHere': 'Who is here',
  'kit.together.tags': '({roles})',
  'kit.together.roleSep': ',',
  'kit.together.roleHost': 'host',
  'kit.together.roleYou': 'you',
  'kit.together.reconnecting': 'Reconnecting…',
  'kit.together.waiting': 'Waiting for friends…',
  'kit.together.leave': 'Leave',
  'kit.connection.lost': 'The connection was lost.',
  'kit.connection.noCode': "Couldn't make a code. Check your internet connection and try again.",
  'kit.connection.noCodeRetry': "Couldn't make a code. Try again.",
  'kit.connection.joinFailed': "Couldn't join {code}. Check the code, make sure the host is online, and that the game isn't full.",
  'kit.connection.wrongCode': 'Wrong code. Check the four letters and that the host is online.',
  'kit.connection.roomFull': 'This game is full.',
  'kit.connection.joinRetry': "Couldn't join. Try again.",
  'kit.connection.codeLength': 'A code has 4 letters or numbers, like K7QM.',
  'kit.connection.codeInUse': 'That code is already in use — start a new game.',
  'kit.connection.unreachable': 'Could not reach that game. Check the code and that the host is online.',
  'kit.connection.failed': 'Connection error',
  'kit.connection.brokerDropped': 'Broker link dropped',
  'kit.connection.reclaiming': 'Reclaiming your code…',
  'kit.connection.hiccup': 'Network hiccup — retrying…',
  'kit.connection.linkClosed': 'Opponent link closed',
  'kit.pause.pause': 'Pause',
  'kit.pause.title': 'Paused',
  'kit.pause.live': 'Still playing',
  'kit.pause.back': 'Back to game',
  'kit.pause.resume': 'Resume',
  'kit.pause.help': 'Help',
  'kit.pause.exit': 'Exit',
  'kit.pause.exitConfirm': 'Yes, exit',
  'kit.pause.saving': 'Saving…',
  'kit.pause.saveError': 'Not saved. Try again.',
  'kit.pause.backLayer': 'Back',
} as const;

export type KitKey = keyof typeof kitWords;
export type KitValues = Record<string, string | number>;

/** Own-property test that works on every browser the kit supports (Object.hasOwn needs iOS 15.4). */
export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** The `{name}` formatter: replaces each slot with its value and leaves an unknown slot as it is. Games reuse it as `arcade.words.format`. */
export function formatSlots(message: string, values?: KitValues): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (slot, name: string) => (hasOwn(values, name) ? String(values[name]) : slot));
}

/** The `{slots}` of a message, sorted, as one string. */
function slotsOf(message: string): string {
  return (message.match(/\{\w+\}/g) ?? []).sort().join(' ');
}

let overrides: Partial<Record<KitKey, string>> = {};
const warned = new Set<string>();

function warnOnce(problem: string): void {
  if (warned.has(problem)) return;
  warned.add(problem);
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.warn(`[arcade kit] ${problem}`);
}

/**
 * Give the kit words that replace its English for the keys named (additions only). Calls add up: a later
 * call changes the keys it names and keeps the rest. A key the kit does not know, a value that is not a
 * string, or an empty string is ignored (the kit's English stays). Dev warns when a word's `{slots}` differ
 * from the English's. Some screens read their labels once when they are built, so call this before building
 * the kit's UI. Called by `arcade.words.use`.
 */
export function useKitWords(catalog: Partial<Record<KitKey, string>>): void {
  if (!catalog) return;
  for (const key of Object.keys(catalog)) {
    const value: unknown = (catalog as Record<string, unknown>)[key];
    if (!hasOwn(kitWords, key)) warnOnce(`words.use: "${key}" is not a kit word; ignored`);
    else if (typeof value !== 'string') warnOnce(`words.use: the value for "${key}" must be a string; ignored`);
    else if (value !== '') {
      if (slotsOf(value) !== slotsOf(kitWords[key as KitKey])) warnOnce(`words.use: "${key}" should have the slots ${slotsOf(kitWords[key as KitKey]) || '(none)'}`);
      overrides[key as KitKey] = value;
    }
  }
}

/** Back to the kit's English. For tests. */
export function resetKitWords(): void {
  overrides = {};
}

/** The kit's words for `key`, with `{name}` slots filled. Never throws. */
export function kt(key: KitKey, values?: KitValues): string {
  try {
    const english = hasOwn(kitWords, key) ? kitWords[key] : undefined;
    if (english === undefined) {
      warnOnce(`unknown message key "${String(key)}"; using the key as the text`);
      return String(key);
    }
    const message = hasOwn(overrides, key) ? overrides[key] ?? english : english;
    return formatSlots(message, values);
  } catch {
    return String(key);
  }
}
