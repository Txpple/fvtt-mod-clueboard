# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's case file, built from what they
read. A clue is a view onto a document the party has read; reading gathers it, stamped with reader, place and
time; the card follows its item through the party stash and stays when the item leaves. Part of Open Roll 5e
(the suite repo is `..`, its CLAUDE.md has the family's conventions; the plan this is built from is
`../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib, MIT.

**State (2026-10-28).** Scaffolded from the family template with the plan and the phase 1 prototype
(`prototypes/phase-1.html`); nothing of the module is built. `scripts/clueboard.js` is the template's entry point
under this id. The name is free on foundryvtt.com's package pages; the setup-screen `getPackages` check is owed
before the first release. Phase 1 is the case file (Read, the mark, gather on read, the holder through the stash,
the DM overlay, the export); phase 2 the board, after a trial of Sargas Investigation Board on the sandbox.

## The rules this module keeps

- **Read never posts.** The Reader writes nothing to chat, ever.
- **Only marked items gather.** The mark is the GM's flag on the item; Read on anything else is just reading.
- **The clue's identity is its flag id**, never a uuid: a Party Stash move is a copy then a delete.
- **The reader's client writes**, on a Case File the players own. No elect in the write path (Party Stash's
  lesson: a GM absent must lose nothing).
- **Players never see the DM overlay**, not even that it exists; a clue page's `pieces` field is stripped from
  anything a player's client renders or exports.
- **No class patches.** Columns through `_configureInventorySections` (Party Stash's way, order 1100, priority
  1000); header buttons and context menus through Foundry's hooks.
- **Detection, never `requires`**: Party Stash, Loot Shelf, By the Books, the Session Scribe.

## How the code will be laid out

- `scripts/decide/` (`// @ts-check`, pure, no Foundry): the holder resolution, the snapshot diff, the export's
  Markdown, the nudge rule. Tested in `tests/`.
- `scripts/clueboard.js`: the entry point; settings; the hooks.
- `scripts/reader.js`, `scripts/casefile.js`, `scripts/overlay.js`: the three applications.
- `contracts/case.json`: the clue page schema, versioned; the Session Scribe consumes it.
- `prototypes/`: HTML mock-ups the design was ruled on; never shipped.
