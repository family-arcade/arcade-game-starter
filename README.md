# Make a game together

This starter template helps you make a browser game with an AI helper and
play it with family and friends. A grown-up and a child do it together. The
child has the ideas and plays. The grown-up handles the accounts. The AI
writes the code.

You will end up with a game at your own web address, such as
`https://your-name.github.io/dragon-dash/`. Your first game will be basic on
purpose. You make it better a few changes at a time. Friends play it with you
through the [Family Arcade](https://familyarcade.eu), from their own homes.

**Time:** about an hour the first time, then as long as you like.

The full guide, with a page for parents, is at
**[learn.familyarcade.eu](https://learn.familyarcade.eu)**.

## What you need

- **A computer, tablet or phone** with a web browser. A computer is easiest
  the first time.
- **A GitHub account** (free) at [github.com](https://github.com). GitHub
  keeps your game's code and puts it on the web. You must be 13 or older to
  have one. For a younger child, it is a grown-up's account.
- **A Claude account with Claude Code**: the Pro plan or higher at
  [claude.ai](https://claude.ai). The account holder must be 18 or older, so
  it is a grown-up's account. Stay with your child while they use it.
- **No Claude plan?** You can also build from this template with Codex in
  ChatGPT or GitHub Copilot Free. Both read the same rules (`AGENTS.md`). The
  steps differ a little from the ones below. Codex in ChatGPT is included in
  the free plan for now. You must be at least 13 to use it. Anyone under 18
  needs a parent's permission. GitHub Copilot Free is for people aged 13 or
  older.

## How a game gets built

Your game's code lives in a *repository* on GitHub: your game's home there.
Claude makes each change on a *branch*, a copy for trying things. You look at
what it changed. A *pull request* asks to add the change, and *merging* adds
it to the main game. GitHub then publishes it in a minute or two. **A change
only goes live after the merge.**

## 1. Start from the template (5 minutes)

1. Open **[the starter template on GitHub](https://github.com/family-arcade/arcade-game-starter)**.
2. Click **Use this template**, then **Create a new repository**.
3. Give it a name for your game, using small letters with dashes:
   `dragon-dash`. Choose **Public**, then click **Create repository**.

## 2. Connect Claude (5 minutes)

1. Open **[claude.ai/code](https://claude.ai/code)** and sign in.
2. Click **Sign in with GitHub** and allow it.
3. When it asks, install the **Claude** GitHub app on your game's repository.
4. Pick your repository.

Claude reads this template's rules before it changes anything. The rules are
in `AGENTS.md`, which `CLAUDE.md` points to. Nothing else needs installing.

## 3. Make your first game (15 minutes)

The child tells Claude the idea in one sentence, for example: "Make a game
where you are a dragon collecting gems in the clouds." Claude then asks a few
short questions, one at a time. Let the child answer.

Claude edits the game's files on a branch and runs the tests. If a test
fails, Claude fixes it. That is normal. When Claude says it is done:

1. Click **Create PR**. A pull request asks to add the change to your game.
2. On GitHub, click **Merge pull request**, then **Confirm merge**.

The first game is basic on purpose: a few shapes and one thing to do.

## 4. Put it on the web (5 minutes)

1. In your repository, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. Choose **Deploy to GitHub Pages**, and click
   **Run workflow**. A workflow is the set of steps GitHub follows to test
   and publish your game.
4. When the dot turns green, usually after a minute or two, your game is at
   `https://<your-github-name>.github.io/<game-name>/`. Open it and play.

You may see earlier runs in the **Actions** tab. They passed but say "Not
published yet", because Pages was off then. From now on, every merge
publishes the game by itself.

## 5. Improve your game

Play, then ask for two or three changes at a time. For example: "Make the
dragon flap its wings, and play a happy sound when you catch a gem." Claude
offers ideas too. Merge, wait a minute or two, then play again.

## 6. Add it to the Family Arcade

On [familyarcade.eu](https://familyarcade.eu), tap **Add a game from a
friend** and paste your game's link. It appears as a tile on that device.
It opens with your player's name already filled in. Send the link to cousins
and friends so they can add it too.

## 7. Play with friends

Friends open your game in their Family Arcade, with their own player. Then:

- everyone taps **Play together**;
- one person taps **Make a code** and reads out the 4 letters;
- everyone else taps **I have a code**, types them and taps **Join**;
- the person who made the code taps **Start**.

Up to four devices can play together, in different homes too. A few strict
networks, like some school and office networks, block it.

## The rules every game keeps

Claude knows these; it helps if the grown-up does too.

- **Nothing from other websites**: no ads, no trackers and no pictures or
  fonts loaded from somewhere else. Claude checks for this before it says a
  change is done.
- **No chat** and nothing typed that other players see, except names.
- **No links out** of the game.
- **Works by touch and by keyboard**, with text big enough to read.
- **Calm when asked**: if a device is set to reduce motion, no shaking or
  flashing.

## For grown-ups

- **What the game keeps**: Players and saves stay in the browser on each
  device. The template has no server of its own and stores nothing on one.
- **Playing together**: devices find each other through the Family Arcade's
  own connection service, on its server in Germany. It passes only the first
  hello and keeps no log. Then the game's data goes directly between the
  devices.
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
