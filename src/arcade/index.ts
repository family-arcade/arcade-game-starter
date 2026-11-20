/**
 * The arcade kit: the only door between your game and the arcade.
 *
 * FOR AN AI ASSISTANT: import `arcade` from here and nothing else in this
 * folder. Do not edit the other files in src/arcade/; build your game in
 * src/game/ and src/main.ts.
 *
 * The kit's own words are in words.ts (`kit.*` keys). To change one, add its key with your text to
 * src/i18n/messages/en.json; main.ts hands those entries to the kit.
 *
 *   import { arcade } from './arcade';
 *
 *   // Who is playing? A name and a colour. null until somebody picked one.
 *   const me = arcade.player();                    // { name: 'Zoë', colour: '#e0405f' } | null
 *   await arcade.ui.ensurePlayer(document.body);   // shows the player card if needed (on the family arcade: its own player screen)
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
 *     // Slow link? Skip a message the next one replaces: false means it was dropped.
 *     if (room.isHost) room.sendTo(id, snapshot, { dropIfBusy: 8 * 1024 });  // a row is ~400 B: 8 KB is ~20 rows, ~0.2 s behind
 *     room.backlog(id);                                 // bytes queued to that person (a guest asks about "host")
 *     if (room.isHost) room.kick(id);                   // host only: take out a device gone quiet in the lobby
 *   });
 *   // Without the panel: const room = await arcade.together.host()  or  .join('ABCD')
 *   // join rejects with a JoinError: e.reason is 'no-room' (no such code: about 10 s, the connection service's
 *   // answer plus 4 s more of dialling in case the host is briefly away),
 *   // 'full' or 'timeout' (18 s). A code that is not 4 letters or numbers, or a hard connection failure, is a plain Error.
 *
 *   // In play: the pause button, top right, and a menu that always ends in Exit (it saves, then leaves).
 *   const pause = arcade.ui.pauseMenu({ onPause, onResume, save, toStart, help, items: [{ label, onSelect }] });
 *   pause.setVisible(true);                        // when play starts; Exit to your start screen hides it
 *
 * Rules the kit enforces: messages are plain JSON objects of at most 16 KB;
 * player names are 1 to 20 characters. Nothing else is shared between players.
 */

import manifest from '../../public/arcade.json';
import { createArcadePlayer } from './arcadePlayer';
import { consumeHandoff, decodeHandoff, encodeHandoff } from './handoff';
import { cleanPlayer, type Player } from './player';
import { createStore } from './storage';
import { createTogether } from './together';
import { createUi } from './ui';
import { createPauseMenu, type PauseMenu, type PauseMenuOptions } from './pause';
import { formatSlots, hasOwn, kitWords, useKitWords } from './words';

export type { Player } from './player';
export type { Person, Room, GameMessage, TogetherStatus, Together, SendOptions, JoinFailure } from './together';
export { JoinError } from './together';
export type { TogetherPanel } from './ui';
export type { PauseMenu, PauseMenuOptions, PauseItem } from './pause';
export type { KitKey } from './words';
export { DEFAULT_PLAYER } from './player';
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

const local = safe(() => window.localStorage);
// Dev builds only: a production build drops this whole object (and with it VITE_ARCADE_ORIGIN) at compile time.
const devOptions = import.meta.env.DEV ? { dev: true, arcadeOrigin: import.meta.env.VITE_ARCADE_ORIGIN as string | undefined } : undefined;
const arcadePlayer = createArcadePlayer({
  gameId,
  local,
  session: safe(() => window.sessionStorage),
  location: window.location,
  // A dev server (npm run dev) sends the player to the arcade's dev server (npm run dev:player there); a build has none of this.
  dev: devOptions ? { origin: devOptions.arcadeOrigin, port: 5189 } : null,
});

const store = createStore({
  gameId,
  local,
  session: safe(() => window.sessionStorage),
  arcadePlayer: arcadePlayer.player,
});

// Opened from the arcade? Pick up who is playing, then tidy the address bar.
const handoff = consumeHandoff(window, safe(() => window.sessionStorage), devOptions);
if (handoff) {
  store.setPlayer(cleanPlayer(handoff) as Player);
  // back from the player screen with a player: the next press of Who may go there again
  arcadePlayer.forgetTrip();
}

const together = createTogether({ gameId, getPlayer: store.player });
const cameFromArcade = (): boolean => store.backUrl() !== null;
function backToArcade(): void {
  const back = store.backUrl();
  if (back) window.location.assign(back);
}
const ui = {
  ...createUi({ getPlayer: store.player, setPlayer: store.setPlayer, together, arcade: arcadePlayer }),
  /** The pause button (top right) and the pause menu: Resume, your items, Help, Exit. See pause.ts. */
  pauseMenu: (options: PauseMenuOptions): PauseMenu => createPauseMenu(options, { cameFromArcade, backToArcade }),
};

export const arcade = {
  /** The id from public/arcade.json. */
  gameId,
  /** Who is playing: the family arcade's player when the game runs on its origin, else the one picked here; null if nobody picked yet. */
  player: store.player,
  /** Set who is playing (the player card calls this for you). */
  setPlayer: store.setPlayer,
  /** Save JSON for this player in this game. Throws a clear error above 100 KB in all. `save(key, undefined)` removes it. */
  save: store.save,
  /** Load what `save` stored, or undefined. */
  load: store.load,
  /** True if this game was opened from the family arcade in this tab. */
  cameFromArcade,
  /** Go back to the arcade. Does nothing if the game was not opened from it. */
  backToArcade,
  /** Play together with a 4-letter code: `host()` and `join(code)`. */
  together,
  /** Small ready-made screens: `ensurePlayer`, `playerPicker`, `togetherPanel`, and `pauseMenu` for play. */
  ui,
  /** The kit's words: `use(catalog)` changes some of its English (only keys listed in words.ts; calls add up), `format(message, values)` fills `{name}` slots, `keys()` lists the kit's word keys and `hasOwn(object, key)` is an own-property test that works on old iPads. Call `use` before building kit UI. */
  words: { use: useKitWords, format: formatSlots, hasOwn, keys: (): string[] => Object.keys(kitWords) },
};
