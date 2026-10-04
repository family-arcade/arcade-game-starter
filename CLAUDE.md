# Rules for the AI assistant

You are helping a parent and a child make a browser game from this template. The child is the designer; keep your explanations short and friendly, and let them choose what to change next. The starter has no game yet: the family describes one, and you build it in `src/game/` and `src/main.ts`, following the pattern in `rules.ts`.

## What is here

- `src/arcade/` is the **arcade kit**: the only door between the game and the arcade. Import `arcade` from `./arcade` and nothing else from that folder. Do not edit it.
- `src/game/rules.ts` is the game's rules: pure code, no screen, no network, seeded random numbers. `step(world, dt, inputs)` returns the next world. It holds a tiny example of the pattern (`World`, `createWorld`, `step`) with a test in `rules.test.ts`; replace it with the real game.
- `src/game/draw.ts` paints a world on a `<canvas>` (an empty stub until there is a game).
- `src/main.ts` wires it together: page, keyboard and touch, play together. Today it is only the start page (title, who is playing, Play together, a card).
- `public/arcade.json` names the game for the arcade (`id`, `title`, `players`, `colour`, `blurb`, `facts`). The `id` must stay lower-case letters, numbers and dashes; changing it makes the game forget its saved data. White text on `colour` must keep a 4.5:1 contrast (a test checks it).
- Plain TypeScript, DOM and canvas. No framework. If the child wants 3D, `npm install three` is fine; keep it bundled like everything else.

## Your first game

1. Rename `public/arcade.json` to the family's game first: `id`, `title`, `colour`, `blurb` and `facts`.
2. Keep the start page's **Play together** button working: the host runs the rules and guests send input.
3. Replace the start card (and the empty playfield) with the game.

## The kit API

```ts
import { arcade } from './arcade';

arcade.player();                       // { name, colour: '#rrggbb' } or null
await arcade.ui.ensurePlayer(document.body);   // "Who's playing?" if nobody yet
arcade.save('best', 12);               // JSON, per player, per game, 100 KB max in all (throws above that)
arcade.load<number>('best');           // undefined if never saved
arcade.cameFromArcade();               // opened from the family arcade?
arcade.backToArcade();

const panel = arcade.ui.togetherPanel(container);   // "Make a code" / "I have a code" / who is here / Leave
panel.onRoom((room) => {               // room is null when we leave
  room?.people;                        // [{ id, name, colour, isHost, me }]
  room?.onPeople(cb); room?.onMessage((msg, fromId) => {}); room?.onStatus(cb);
  room?.send({ type: 'move' });        // guest to host, or host to everyone
  room?.sendTo(id, { type: 'hi' });    // host only
});
// or without the panel: await arcade.together.host()  /  await arcade.together.join('ABCD')
```

Play together is up to 4 devices, host-authoritative: the host runs the rules and sends the world; guests send only their input. Messages are plain JSON objects, at most 16 KB each. Keep them small (send positions and scores, not pictures).

## Rules for every game made here

1. **Nothing from other websites.** Never fetch or load anything from outside: no CDNs, web fonts, analytics, ads, trackers, remote images, sounds or scripts. Everything is bundled (`npm install` the library, or draw it in code). The only network traffic is the kit's play-together connection.
2. **No links out, no pop-ups.** The game never navigates to another site. Use `arcade.backToArcade()` to go back.
3. **No chat and no free text shared with other players.** The only text players share is their player name (the kit handles it). Messages between players carry game state only.
4. **Works on an iPad and with a keyboard.** Every action is tappable (48 px or bigger) and has a keyboard way. Touch and drag must work on a canvas (`touch-action: none`). Keep a visible `:focus-visible` outline.
5. **Respect `prefers-reduced-motion`.** Screen shake, sparkles, spinning and big movement stay behind it.
6. **Text is 16 px or bigger,** including text drawn on the canvas, with good contrast.
7. **Keep the game in its own files** (`src/game/`, `src/main.ts`, `src/style.css`). Put rules in pure functions with tests in `src/game/*.test.ts`.
8. **Be kind with data.** Save only what the game needs. Never read or write browser storage directly; use `arcade.save` and `arcade.load` (they key by game id, because every game on one GitHub account shares one `github.io` address).

## Before you say it is done

```
npm test
npm run build
```

Both must pass (the build also type-checks). Then actually open the game and play a round.

## Try play together on one computer

```
npm run dev
```

Open the address it prints in two browser windows. In window 1 tap **Play together**, then **Make a code**. In window 2 tap **Play together**, **I have a code**, type the 4 letters, **Join**. Both windows need internet (a free matchmaking service connects them; the game itself then talks directly between the windows). The host window starts the game. Use a private window for the second player if both should have different names (normal windows share one saved player).

## Putting it online

Push to the `main` branch of the GitHub repository; `.github/workflows/pages.yml` tests, builds and publishes it to GitHub Pages. The repository's Settings, Pages, Source must be set to "GitHub Actions" once.
