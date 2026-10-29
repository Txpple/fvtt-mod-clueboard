# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's Mysteries, the Clues the DM has
collected for them, each stamped with where it was found and who has read it. A Clue is an item type of the
module's own, never carried; collecting puts it on the party's record, and a player's opening of it in Mysteries
marks the read. Part of Open Roll 5e (the suite repo is `..`, its CLAUDE.md has the family's conventions; the plan
this is built from is `../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib,
MIT.

**State (2026-10-29).** Phase 1 is built on `main` as 0.1.0, unreleased, in its third shape of the day on the
user's rulings: the Clue item type (`fvtt-mod-clueboard.clue`, its model, sheet and icon), collecting (a drop on
the party, a member or the Mysteries window, Collect on the sheet or in the window's GM strip; never an inventory),
the read marked when a player opens the card, the Mysteries window off a spy button on the sidebar's strip
after Journal, the record on the Group actor, and threads: the party's own sorting, a tab per named question a
clue can be pinned to many of (the user's pick over lanes and a corkboard). Gone the same day: the sidebar tab (it stuck the sidebar), the
journal per party (messy, leaky in the UI), the Clue loot subtype, the Read column and bookmark in the stash,
held-by and the Party Stash logic. `npm run verify` is green (59 tests). Deployed to the sandbox and walked GREEN by
`tools/live-check.mjs --walk` (44 checks); the sandbox's ten Session 02 documents are Clues built from the world
originals and collected on the Party with their readers kept. The name is free on foundryvtt.com's package pages;
the setup-screen `getPackages` check is owed before the first release. Phase 2 (the board, the export; no GM secrets, ever) waits on the plan.

## The rules this module keeps

- **A Clue is an item type of the module's own**, declared in `module.json` (`documentTypes.Item.clue`), its model
  `ClueItemModel` (`kind`, `text`, `foundAt`) and sheet `ClueItemSheet` registered at `init` whether or not the
  module is enabled, so a world that holds Clues never sees an unknown type. Its icon is a row in
  `CONFIG.DND5E.defaultArtwork.Item`. `kind` is one of `KINDS` (document, object, statement, location, body, rumour,
  vision); a new kind is a line there and a string in `lang/en.json`.
- **A Clue is never carried.** dnd5e refuses a non-physical item on a Group; `dropActorSheetData` turns a Clue
  dropped on any actor's sheet into a collect and tells the sheet no; `preCreateItem` refuses a Clue inside any
  actor by any other path. Nothing of the module's touches an inventory, a character sheet or an item card.
- **A party's record lives on its Group actor and nowhere else** (`scripts/store.js`): the module's flags,
  `entries.<itemId>` (keyed by the world Clue it was collected from) and a `schema` version (2), each entry
  validated by `MysteryEntry`. No journal, no folder, nothing in a directory or on a sheet; the window, the Reader
  and the API are the only ways in. No party, no record.
- **The DM collects; the reader's client marks the read.** Collect is GM-only (a player cannot see a world Clue).
  A compendium Clue is imported into the world first (a "Clues" folder, flagged) so the entry has a master to
  follow. The read is written by the player's own client on a party the players own (Party Stash needs the same);
  a player who does not own it is told. Every write names the narrowest key (an entry, `readers.<actorId>`, the
  snapshot, the note) with `render: false`; a removal is a `ForcedDeletion` on the entry's key. No elect anywhere.
- **No GM secrets.** Anyone who can see the party can read its flags; nothing the module stores is hidden from
  players: the user's ruling, phase 2 included.
- **Threads are the party's, on the party** (a *mystery* in every word a player reads; *thread* in the code). `flags.<id>.threads.<threadId>` (`Thread`: name, colour, question,
  status open/answered, stand, order) and an entry's pins at `entries.<clueId>.threads.<threadId>` (`{ at, order }`),
  so removing an entry removes its pins and deleting a thread is one write that forces its pins away. Any owner of
  the party organises, the GM included; a clue sits in as many threads as the party likes. A card dragged onto a
  thread's tab pins it (the window's own drag, a plain-text payload that is never a Foundry Item drop); dropped on a
  card inside a thread it goes before it; the whole order is rewritten in one write. The active tab is window state,
  per party.
- **Read never posts.** The Reader writes nothing to chat, ever. A GM's opening marks nothing.
- **Mysteries is a window, never a sidebar panel.** A spy button (`fa-user-secret`) is added to the sidebar's strip directly after
  Journal on `renderSidebar` (no `data-tab`, no `data-action`, so the sidebar never switches or expands for it);
  it opens `MysteriesWindow`, one per client, centred. Nothing is registered on `Sidebar.TABS` or `CONFIG.ui`: a
  tab's panel lives inside the sidebar's layout, and one there stuck the sidebar. For the GM the window carries the
  strip of uncollected world Clues and is a drop target.
- **No class patches.** The type is a Foundry declaration; the drops are hooks; the button is a DOM addition.
- **A Handlebars part renders one root element**; a world on the stock Simplified Gregorian calendar gets no
  calendar date in its stamp; card text is plain text escaped once by the template.

## How the code is laid out

- `scripts/decide/clue.js` (`// @ts-check`, pure, no Foundry): `CLUE_TYPE`, `KINDS`, `isClue`, `snapshotOf`,
  `changesSnapshot`, `partyFor`, `defaultParty`, `entryList`, `readerList`, `sortAndFilter`, `unreadCount`,
  `THREAD_COLOURS`, `threadList`, `nextColour`, `pinnedTo`, `unsorted`, `reorder`. Tested in `tests/clue.test.js`.
- `scripts/common.js`: the id, the logger, `t`, `setting`; imported by every other file, imports none of them.
- `scripts/clueboard.js`: the entry point; the setting and the type at `init`; the drop and create hooks; the
  record and window refreshes; the strip's button on `renderSidebar`; the stylesheet probe; `module.api`.
- `scripts/clue-item.js`: `ClueItemModel`, `ClueItemSheet` (Collect for a party, Take back), `registerClueItem`.
- `scripts/store.js`: `MysteryEntry`, `Thread`, the reads and the narrow writes on a party's record.
- `scripts/mysteries.js`: the party helpers and pickers, the stamp, `collect`, `uncollect`, `refreshSnapshot`,
  `markRead`, the threads (`createThread`, `editThread`, `updateThread`, `removeThread`, `pinClue`, `unpinClue`,
  `movePin`), the window's context (`sectionFor`: tabs, the active thread, the cards), `MysteriesWindow` and its
  drag wiring.
- `scripts/reader.js`: `Reader` (on a party and a Clue id, read live), `openReader`, `refreshReaders`.
- `templates/`: `clue-item.hbs`, `reader.hbs`, `mysteries.hbs`.
- `tools/live-check.mjs`: the sandbox walk (`FOUNDRY_HOST=local`; `--walk`, `--reader`, `--shots`).
- `prototypes/`: the HTML mock-ups the design was ruled on; never shipped.
