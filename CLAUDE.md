# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's Mysteries, built from what they
read. A loot item of the Clue type, read in the party stash, becomes an entry stamped with reader, place and
time; the entry follows its item through the stash and stays when the item leaves. Part of Open Roll 5e (the
suite repo is `..`, its CLAUDE.md has the family's conventions; the plan this is built from is
`../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib, MIT.

**State (2026-10-29).** Phase 1 is built on `main` as 0.1.0, unreleased: the Clue loot type, Read on the party
stash's rows (the one trigger into Mysteries; player inventories untouched), the Mysteries window opened centred
from a scroll button on the sidebar's strip directly after Journal (the user's ruling after the sidebar panel stuck
the sidebar), the party's record on its Group actor (no journal, no document type, the user's ruling the same
morning), the holder and snapshot following the item. `npm run verify` is green (59 tests). Deployed to the sandbox and enabled there, walked GREEN by
`tools/live-check.mjs` (a GM page and a temporary player page): the sandbox's Session 02 documents are Clues and
four are gathered on the Party. The name is free on foundryvtt.com's package pages; the setup-screen `getPackages` check is
owed before the first release. Phase 2 (Read everywhere else, the board, testimony, the export; no GM secrets, ever)
waits on the plan, after a trial of Sargas Investigation Board on the sandbox.

## The rules this module keeps

- **Read never posts.** The Reader writes nothing to chat, ever.
- **Only Clues gather, and only from the stash.** A Clue is a loot item of type `clue`, nothing of the module's on
  it until it is read; Read on anything else is just reading. Phase 1 adds nothing to a character sheet, an item
  card or an item sheet.
- **The clue's identity is a flag id written at the first gather**, never a uuid: a Party Stash move is a copy
  then a delete.
- **A party's record lives on its Group actor and nowhere else** (`scripts/store.js`): the module's flags,
  `entries.<clueId>` and a `schema` version, each entry validated by the module's own `MysteryEntry` data model. No
  journal, no folder, no document type: nothing shows in a directory or on a sheet, and the window, the Reader and
  the API are the only ways in. No party, no record: Read lives only in a Group's stash.
- **The reader's client writes**, on a party the players own (Party Stash needs the same); a player who does not
  own it is told the read is not recorded. Every write names the narrowest key (an entry, `readers.<actorId>`, the
  holder, the note), so two reads at once never overwrite each other, and passes `render: false` so the stash
  does not redraw under its reader. No elect anywhere (Party Stash's lesson: a GM absent must lose nothing).
- **No GM secrets.** Anyone who can see the party can read its flags, and nothing the module stores is hidden
  from players: the user's ruling, phase 2 included.
- **The moving client writes the holder** (`createItem`/`deleteItem`, `userId === game.user.id`), so a move
  lands one write; a Party Stash hand-off row (`giveTo`) is not a carrier until it lands.
- **Mysteries is a window, never a sidebar panel.** A scroll button is added to the sidebar's strip directly after
  Journal on `renderSidebar` (no `data-tab`, no `data-action`, so the sidebar never switches or expands for it);
  it opens `MysteriesWindow`, one per client, centred. Nothing is registered on `Sidebar.TABS` or `CONFIG.ui`: a
  tab's panel lives inside the sidebar's layout, and one there stuck the sidebar.
- **No class patches.** The loot type is a `CONFIG.DND5E` entry; the group sheet's column goes through
  `_configureInventorySections` (Party Stash's way, order 1150, priority 1000, its CSS width rule required); the
  button is a DOM addition on the strip.
- **A Handlebars part renders one root element** (the Reader and the window are wrapped); a world on the stock
  Simplified Gregorian calendar gets no calendar date in its stamp.

## How the code is laid out

- `scripts/decide/clue.js` (`// @ts-check`, pure, no Foundry): `isClue`, `clueId`, `snapshotOf`,
  `changesSnapshot`, `resolveHolder`, `entryList`, `readerList`, `sortAndFilter`, `countUngathered`. Tested in
  `tests/clue.test.js`.
- `scripts/common.js`: the id, the logger, `t`, `setting`; imported by every other file, imports none
  of them (no cycle).
- `scripts/clueboard.js`: the entry point; settings and the loot type at `init`; the column at `setup`; the
  strip's button on `renderSidebar`; the row wiring on `renderGroupActorSheet`; the item hooks; the redraws on a
  record change (`updateActor`);
  the stylesheet probe; `module.api`.
- `scripts/store.js`: `MysteryEntry`, the reads and the narrow writes on a party's record.
- `scripts/mysteries.js`: the party helpers, the stamp, the reader picker, `gather`, the holder and
  snapshot followers, the window's context, `MysteriesWindow`.
- `scripts/reader.js`: `Reader` (on a party and a clue id, read live), `openReader`, `refreshReaders`.
- `templates/`: `read-column.hbs`, `reader.hbs`, `mysteries.hbs`.
- `tools/live-check.mjs`: the sandbox walk (`FOUNDRY_HOST=local`; `--clues`, `--read`, `--reader`, `--shots`).
- `prototypes/`: the HTML mock-up the design was ruled on; never shipped.
