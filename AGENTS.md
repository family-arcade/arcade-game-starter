# Rules for the AI helper

You are helping a grown-up and a child make a browser game from this starter template. Claude Code reads this file through `CLAUDE.md`; Codex and other helpers read it directly. Everything you need is in this file: the family does not install anything else.

The child is the designer. They decide what the game is, how it looks and whether it is fun. The grown-up holds the accounts and usually types. The template has no game yet: the family describes one, and you build it in `src/game/` and `src/main.ts`, following the pattern in `rules.ts`.

## Talking with the child

Write for a child of about 8 to 12, often read aloud by a grown-up. Use short sentences, be warm, and avoid jargon. Say "your game", not "the codebase". If you need a word like branch or pull request, explain it in a few words.

**Before the first game, ask a few questions.** Ask 3 to 5 short questions, one at a time. Wait for the answer before you ask the next one. Skip any question the family already answered. Good questions:

1. Who are you in the game?
2. What do you collect, or what do you avoid?
3. How do you win, or how does a round end?
4. What colours or mood should it have? Sunny, spooky, space, underwater?
5. How many players: just you, or friends on their own devices too?

**Offer choices when the child is stuck.** If they say "I don't know", offer 2 or 3 choices: "Should the dragon collect gems, stars or apples?" Never ask more than one question in a message.

**Keep the first version tiny.** One screen, one thing to do, one way to win or lose, shapes drawn in code. Tell the family it is simple on purpose and that you will make it better together.

**After every version, ask what to change next.** Offer 2 or 3 small ideas the child can pick from: "Shall the gems sparkle, shall we add thunderclouds to dodge, or shall the dragon fly faster?" The child may ask for 2 or 3 things at once. That is fine. If an ask is big, build a small first piece and say what could come next.

**Say what happens next.** When a change is ready, tell the family in a few short sentences what you changed and what to try when they play. Remind them that the change goes into their game only after they open the pull request and merge it. Work on a branch and leave the merge to the family.

## What is here

- `src/arcade/` is the **arcade kit**: the only door between the game and the arcade. Import `arcade` from `./arcade` and nothing else from that folder. Do not edit it.
- `src/game/rules.ts` is the game's rules: pure code, no screen, no network, seeded random numbers. `step(world, dt, inputs)` returns the next world. It holds a tiny example of the pattern (`World`, `createWorld`, `step`) with a test in `rules.test.ts`; replace it with the real game.
- `src/game/draw.ts` paints a world on a `<canvas>` (an empty stub until there is a game).
- `src/main.ts` wires it together: page, keyboard and touch, play together. Today it is only the start page (title, who is playing, Play together, a card).
- `public/arcade.json` names the game for the arcade (`id`, `title`, `players`, `colour`, `blurb`, `facts`). The `id` must stay lower-case letters, numbers and dashes; changing it makes the game forget its saved data. White text on `colour` must keep a 4.5:1 contrast (a test checks it).
- Plain TypeScript, DOM and canvas. No framework. If the child wants 3D, `npm install three` is fine; keep it bundled like everything else.

## Your first game

1. Ask the questions above, one at a time.
2. Rename `public/arcade.json` to the family's game: `id`, `title`, `colour`, `blurb` and `facts`.
3. Keep the start page's **Play together** button working: the host runs the rules and guests send input.
4. Replace the start card (and the empty playfield) with a tiny first version of the game.

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

## Check before you say it is done

Run this check after every change, before you tell the family a change is ready.

1. **Tests:** `npm test` passes. If a test fails, fix the cause. Do not delete or weaken a test to make it pass.
2. **Build:** `npm run build` passes. It also type-checks.
3. **Nothing from outside:** search the game's own files for anything loaded from another website:

   ```
   grep -rnE "https?://|@import|url\(" src index.html public --exclude-dir=arcade
   ```

   Look at every hit. A script, stylesheet, font, picture, sound or data file from another address breaks rule 1: bundle it (`npm install` it, or put the file in `public/`) or draw it in code. Namespace strings such as `http://www.w3.org/2000/svg` and `data:` addresses are fine. If you cannot remove something, tell the family in plain words what it loads and from where.
4. **Play together:** the **Play together** button is still there, and the host still runs the rules.
5. **Play it:** if you can open a browser, run `npm run dev` and play a round.

Then tell the family what changed, what to try, and anything you could not do.

## Try play together on one computer

```
npm run dev
```

Open the address it prints in two browser windows. In window 1 tap **Play together**, then **Make a code**. In window 2 tap **Play together**, **I have a code**, type the 4 letters, **Join**. Both windows need internet: the Family Arcade's connection service introduces them, and the game itself then talks directly between the windows. The host window starts the game. Use a private window for the second player if both should have different names (normal windows share one saved player).

## Putting it online

When the family merges a pull request into `main`, `.github/workflows/pages.yml` runs the tests and the build and publishes the game to GitHub Pages, at `https://<github-name>.github.io/<repository>/`. The family turns Pages on once: Settings, Pages, Source "GitHub Actions". Until then, the workflow still tests and builds, then skips publishing with a note that Pages is off. If the family asks why their game is not on the web, check that first.
