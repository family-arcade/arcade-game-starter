# Make a game together

This starter helps you make a browser game with an AI helper and play it with
family and friends. A grown-up and a child do it together. The child has the
ideas and plays. The grown-up handles the accounts. The AI writes the code.

You will end up with a game at your own web address, such as
`https://your-name.github.io/dragon-dash/`. Anyone you send the link to can
play the game. They can play together from different homes.

**Time:** about an hour the first time, then as long as you like.

The full guide, with a page for parents, is at
**[learn.familyarcade.eu](https://learn.familyarcade.eu)**.

## What you need

- **A computer, tablet or phone** with a web browser. A computer is easiest
  the first time.
- **A GitHub account** (free) at [github.com](https://github.com). GitHub
  keeps your game's code and puts it on the web. You must be 13 or older to
  have one. For a younger child, it is the grown-up's account.
- **A Claude account with Claude Code**: the Pro plan or higher at
  [claude.ai](https://claude.ai). The account holder must be 18 or older, so
  it must be a grown-up's account. This guide uses Claude Code.
- **No Claude plan?** You can also build from this starter with Codex in
  ChatGPT or GitHub Copilot Free. Both read the same rules (`AGENTS.md`). The
  steps differ a little from the ones below. Codex in ChatGPT is included in
  the free plan for now. You must be at least 13 to use it. Anyone under 18
  needs a parent's permission. GitHub Copilot Free is for people aged 13 or
  older.

## 1. Make your own copy (5 minutes)

1. Open **[the starter on GitHub](https://github.com/family-arcade/arcade-game-starter)**.
2. Click **Use this template**, then **Create a new repository**. A repository
   is your game's home on GitHub. It contains the game's code and files.
3. Give it a name for your game, using small letters with dashes:
   `dragon-dash`. Choose **Public**, then click **Create repository**.

## 2. Put it on the web (5 minutes)

1. In your new repository, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. Choose **Deploy to GitHub Pages**, and click
   **Run workflow**. A workflow is the set of steps GitHub follows to publish
   your game.
4. When the dot turns green, usually after a minute or two, your game is at
   `https://<your-github-name>.github.io/<game-name>/`. Open it. You should
   see your game's empty home page with Play together.

## 3. Meet your AI helper (5 minutes)

1. Open **[claude.ai/code](https://claude.ai/code)** and sign in.
2. Click **Sign in with GitHub** and allow it.
3. When it asks, install the **Claude** GitHub app on your game's repository.
4. Pick your repository.

Claude reads the rules in this starter (`CLAUDE.md`) before it changes
anything, so it already knows how games here work.

## 4. Ask for your first game (10 minutes)

The child says what to change. The grown-up types it. Try:

> Make a game where you are a dragon collecting gems in the clouds, for 1 to 4
> players. Keep play together working. Then run the tests.

Claude works on a copy of your game called a *branch*. A branch lets you try
a change without changing the main game. When Claude says it is done:

1. Click **Create PR**. A pull request is a request to put the change into
   your game.
2. On GitHub, click **Merge pull request**, then **Confirm merge**. To merge
   means to put the tested change into your game's main copy.
3. Wait a minute or two, then reload your game's page.

That is the whole loop: **ask, merge, play.** Everything after this follows
the same loop.

## 5. Make it better, one step at a time

Play the first version, then change one thing at a time. Some next asks:

> The dragon should flap its wings and bob a little while it flies.

> When you collect 5 gems in a row, play a happy sound and show a little
> burst of sparkles.

> Add thunderclouds to dodge, and a level 2 where they move faster.

Good habits:

- **Play after every change**, and tell Claude what you see. For example:
  "the dragon is too fast" or "I can't see the gems on a phone."
- **One thing at a time.** Small asks work better than big ones.
- **Say what it should feel like**, not how to code it. For example: "Make it
  bouncier."
- If something breaks: "That broke the game: the screen is white. Please
  fix it and run the tests."

## 6. Play together

Send your game's link to family or friends. Everyone opens it and taps
**Play together**. Then:

- one person taps **Make a code** and reads out the 4 letters;
- everyone else taps **I have a code**, types them and taps **Join**;
- the person who made the code taps **Start**.

Up to four devices can play together, in different homes too. A few strict
networks, like some school and office networks, block it.

## 7. Put it in the family arcade

On [familyarcade.eu](https://familyarcade.eu), tap **Add a game from a
friend** and paste your game's link. It appears as a tile on that device.
It opens with your player's name already filled in. Add your cousins' games
the same way.

## The rules every game keeps

Claude knows these; it helps if the grown-up does too.

- **Nothing from other websites**: no ads, no trackers and no pictures or
  fonts loaded from somewhere else. Everything the game needs is in the game.
- **No chat** and nothing typed that other players see, except names.
- **No links out** of the game.
- **Works by touch and by keyboard**, with text big enough to read.
- **Calm when asked**: if a device is set to reduce motion, no shaking or
  flashing.

## For grown-ups

- **What the game keeps**: Players and saves stay in the browser on each
  device. The starter has no server and sends no data to one. Playing
  together connects the devices directly. The public matchmaking service
  [PeerJS](https://peerjs.com) only introduces them.
- **What GitHub sees**: your game's code is public, and GitHub serves the
  page, so it sees visits like any website does.
- **Names**: use first names or nicknames. Nothing else about a child goes
  in a game.
- **Claude's usage limits**: a long session can hit the plan's limit; it
  resets after a few hours.
- **Helping without taking over**: Let the child decide what to change and
  judge the result. Your job is typing, merging, and saying "let's play it"
  often.

## License

MIT. Make it yours.
