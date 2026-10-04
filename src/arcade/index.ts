/**
 * The arcade kit: the only door between your game and the arcade.
 *
 * FOR AN AI ASSISTANT: import `arcade` from here and nothing else in this
 * folder. Do not edit the other files in src/arcade/; build your game in
 * src/game/ and src/main.ts.
 *
 *   import { arcade } from './arcade';
 *
 *   // Who is playing? A name and a colour. null until somebody picked one.
 *   const me = arcade.player();                    // { name: 'Zoë', colour: '#e0405f' } | null
 *   await arcade.ui.ensurePlayer(document.body);   // shows "Who's playing?" if needed
 *
 *   // Remember things for this player in this game (max 100 KB in all).
 *   arcade.save('best', 12);                       // numbers, text, true/false, lists, plain objects
 *   const best = arcade.load<number>('best');      // undefined if never saved
 *
 *   // Opened from the family arcade? Offer a way back.
 *   if (arcade.cameFromArcade()) button.onclick = () => arcade.backToArcade();
 *
 *   // Play together: up to 4 devices. The host runs the game; guests send input.
 *   const panel = arcade.ui.togetherPanel(container);   // "Make a code" / "I have a code" / who is here
 *   panel.onRoom((room) => {
 *     if (!room) return;                                // null means we left
 *     room.people;                                      // [{ id, name, colour, isHost, me }]
 *     room.onPeople((people) => {});
 *     room.onMessage((msg, fromId) => {});              // msg is what the other side sent
 *     room.onStatus((status) => {});                    // 'waiting' | 'connected' | 'reconnecting' | 'error' | 'left'
 *     room.send({ type: 'move', x: 3 });                // guest -> host, or host -> everyone
 *     if (room.isHost) room.sendTo(room.people[1].id, { type: 'hi' });  // host only
 *   });
 *   // Without the panel: const room = await arcade.together.host()  or  .join('ABCD')
 *
 * Rules the kit enforces: messages are plain JSON objects of at most 16 KB;
 * player names are 1 to 20 characters. Nothing else is shared between players.
 */

import manifest from '../../public/arcade.json';
import { consumeHandoff, decodeHandoff, encodeHandoff } from './handoff';
import { cleanPlayer, type Player } from './player';
import { createStore } from './storage';
import { createTogether } from './together';
import { createUi } from './ui';

export type { Player } from './player';
export type { Person, Room, GameMessage, TogetherStatus, Together } from './together';
export type { TogetherPanel } from './ui';
export { encodeHandoff, decodeHandoff };

const gameId: string = manifest.id;
if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$/.test(gameId)) {
  throw new Error('public/arcade.json: "id" must be lower-case letters, numbers and dashes only, like "star-catch".');
}

function safe<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

const store = createStore({
  gameId,
  local: safe(() => window.localStorage),
  session: safe(() => window.sessionStorage),
});

// Opened from the arcade? Pick up who is playing, then tidy the address bar.
const handoff = consumeHandoff(window, safe(() => window.sessionStorage));
if (handoff) store.setPlayer(cleanPlayer(handoff) as Player);

const together = createTogether({ gameId, getPlayer: store.player });
const ui = createUi({ getPlayer: store.player, setPlayer: store.setPlayer, together });

export const arcade = {
  /** The id from public/arcade.json. */
  gameId,
  /** Who is playing on this device, or null if nobody picked yet. */
  player: store.player,
  /** Set who is playing (the "Who's playing?" screen calls this for you). */
  setPlayer: store.setPlayer,
  /** Save JSON for this player in this game. Throws a clear error above 100 KB in all. `save(key, undefined)` removes it. */
  save: store.save,
  /** Load what `save` stored, or undefined. */
  load: store.load,
  /** True if this game was opened from the family arcade in this tab. */
  cameFromArcade: (): boolean => store.backUrl() !== null,
  /** Go back to the arcade. Does nothing if the game was not opened from it. */
  backToArcade(): void {
    const back = store.backUrl();
    if (back) window.location.assign(back);
  },
  /** Play together with a 4-letter code: `host()` and `join(code)`. */
  together,
  /** Small ready-made screens: `ensurePlayer`, `playerPicker`, `togetherPanel`. */
  ui,
};
