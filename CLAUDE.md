# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's case file, built from what they
read. A clue is a view onto a document the party has read; reading gathers it, stamped with reader, place and
time; the card follows its item through the party stash and stays when the item leaves. Part of Open Roll 5e
(the suite repo is `..`, its CLAUDE.md has the family's conventions; the plan this is built from is
`../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib, MIT.

**State (2026-10-29).** Scaffolded from the family template with the plan and the phase 1 prototype
(`prototypes/phase-1.html`); nothing of the module is built. `scripts/clueboard.js` is the template's entry point
under this id. The name is free on foundryvtt.com's package pages; the setup-screen `getPackages` check is owed
before the first release. Phase 1 is three things, cut down on the user's word: the Clue loot type (a
`CONFIG.DND5E.lootTypes` entry, the one signifier), Read on the party stash's rows only (the one trigger into
Mysteries; player inventories untouched), and the Mysteries sidebar tab directly after Journal (the window named
Mysteries, not Case File); phase 2 Read everywhere else, the board, the DM's side, testimony and the export, after
a trial of Sargas Investigation Board on the sandbox.

## The rules this module keeps

- **Read never posts.** The Reader writes nothing to chat, ever.
- **Only Clues gather, and only from the stash.** A Clue is a loot item of type `clue`, nothing of the module's on
  it until it is read; Read on anything else is just reading. Phase 1 adds nothing to a character sheet, an item
  card or an item sheet.
- **The clue's identity is a flag id written at the first gather**, never a uuid: a Party Stash move is a copy
  then a delete.
- **The reader's client writes**, on a journal the players own. No elect in the write path (Party Stash's
  lesson: a GM absent must lose nothing).
- **Mysteries is a sidebar tab**, registered on `CONFIG.ui` and placed directly after Journal; the journal behind
  it is storage. Players never see the DM's side (phase 2), not even that it exists.
- **No class patches.** The loot type is a `CONFIG.DND5E` entry; the group sheet's column goes through
  `_configureInventorySections` (Party Stash's way, order 1100, priority 1000); the sidebar tab through `CONFIG.ui`.
- **Detection, never `requires`**: Party Stash, Loot Shelf, By the Books, the Session Scribe.

## How the code will be laid out

- `scripts/decide/` (`// @ts-check`, pure, no Foundry): the holder resolution, the snapshot diff, the export's
  Markdown, the nudge rule. Tested in `tests/`.
- `scripts/clueboard.js`: the entry point; settings; the hooks.
- `scripts/reader.js`, `scripts/mysteries.js`: the two applications of phase 1 (the Reader; the sidebar tab and
  its window). Phase 2 adds `scripts/board.js` and `scripts/overlay.js`.
- `contracts/case.json`: the clue page schema, versioned; the Session Scribe consumes it in phase 2.
- `prototypes/`: HTML mock-ups the design was ruled on; never shipped.
