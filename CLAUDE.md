# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's Mysteries, built from what they
read. A loot item of the Clue type, read in the party stash, becomes an entry stamped with reader, place and
time; the entry follows its item through the stash and stays when the item leaves. Part of Open Roll 5e (the
suite repo is `..`, its CLAUDE.md has the family's conventions; the plan this is built from is
`../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib, MIT.

**State (2026-10-29).** Phase 1 is built on `main` as 0.1.0, unreleased: the Clue loot type, Read on the party
stash's rows (the one trigger into Mysteries; player inventories untouched), the Mysteries sidebar tab directly
after Journal with its window, the journal and page type behind it, the holder and snapshot following the item.
`npm run verify` is green (60 tests). Deployed to the sandbox and enabled there, walked GREEN by
`tools/live-check.mjs` (a GM page and a temporary player page): the sandbox's Session 02 documents are Clues and
three are gathered. The name is free on foundryvtt.com's package pages; the setup-screen `getPackages` check is
owed before the first release. Phase 2 (Read everywhere else, the board, the DM's side, testimony, the export)
waits on the plan, after a trial of Sargas Investigation Board on the sandbox.

## The rules this module keeps

- **Read never posts.** The Reader writes nothing to chat, ever.
- **Only Clues gather, and only from the stash.** A Clue is a loot item of type `clue`, nothing of the module's on
  it until it is read; Read on anything else is just reading. Phase 1 adds nothing to a character sheet, an item
  card or an item sheet.
- **The clue's identity is a flag id written at the first gather**, never a uuid: a Party Stash move is a copy
  then a delete.
- **The reader's client writes**, on a journal the players own (default ownership Owner). The elect's one chore
  is making the journal (players cannot create journals); no elect in any other write path (Party Stash's
  lesson: a GM absent must lose nothing).
- **The moving client writes the holder** (`createItem`/`deleteItem`, `userId === game.user.id`), so a move
  lands one write; a Party Stash hand-off row (`giveTo`) is not a carrier until it lands.
- **Mysteries is a sidebar tab**, registered on `CONFIG.ui` and placed directly after Journal by rebuilding
  `Sidebar.TABS` at init; the journal behind it is storage. Players never see the DM's side (phase 2), not even
  that it exists.
- **No class patches.** The loot type is a `CONFIG.DND5E` entry; the group sheet's column goes through
  `_configureInventorySections` (Party Stash's way, order 1150, priority 1000, its CSS width rule required); the
  sidebar tab through `CONFIG.ui`.
- **A Handlebars part renders one root element** (the Reader and the tab are wrapped); a world on the stock
  Simplified Gregorian calendar gets no calendar date in its stamp.

## How the code is laid out

- `scripts/decide/clue.js` (`// @ts-check`, pure, no Foundry): `isClue`, `clueId`, `snapshotOf`,
  `changesSnapshot`, `resolveHolder`, `insertAfter` (the tab table), `sortAndFilter`, `countUngathered`. Tested in
  `tests/clue.test.js`.
- `scripts/common.js`: the id, the logger, the elect, `t`, `setting`; imported by every other file, imports none
  of them (no cycle).
- `scripts/clueboard.js`: the entry point; settings; the loot type, the page type and sheet, the tab at `init`;
  the column at `setup`; the row wiring on `renderGroupActorSheet`; the item hooks; the elect's journal chore;
  the stylesheet probe; `module.api`.
- `scripts/mysteries.js`: the party helpers, the journals, the stamp, the reader picker, `gather`, the holder and
  snapshot followers, the tab's context, `MysteriesTab`.
- `scripts/reader.js`: `Reader` and `openReader`. `scripts/clue-page.js`: `ClueModel` and `ClueSheet`.
- `templates/`: `read-column.hbs`, `reader.hbs`, `mysteries-tab.hbs`, `clue-page-view.hbs`, `clue-page-edit.hbs`.
- `tools/live-check.mjs`: the sandbox walk (`FOUNDRY_HOST=local`; `--clues`, `--read`, `--reader`, `--shots`).
- `prototypes/`: the HTML mock-up the design was ruled on; never shipped.
