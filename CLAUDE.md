# fvtt-mod-clueboard — working notes for sessions in this repo

**What this is.** Open Roll 5e: Clue Board, a Foundry VTT module: the party's Clue Board, the Clues the DM has
collected for them, each stamped with where it was found and who has read it. A Clue is an item type of the
module's own, never carried; collecting puts it on the party's record, and a player's opening of it on the board
marks the read. Part of Open Roll 5e (the suite repo is `..`, its CLAUDE.md has the family's conventions; the plan
this is built from is `../docs/plans/clueboard.md`). Plain ES modules, no build step, no libWrapper, no socketlib,
MIT.

**State (2026-10-31).** 1.2.4 is released and on prod (the installer, 16/16 served files byte-identical): the stamp is when, never a scene (the user, on the Lamp of 1391 showing
*Townhouse 03 - Attic*, the MCP page's scene at the collect); prod's eight older entries had their stored scene cleared, on the user's word.
1.2.3 Card Catalogue's card (a click picks, a
double click or *Read* opens; the chevron of Read, the Threads toggles and the GM's rows), the S/M/L pills, the
search's count and its matches elsewhere, a thread row's right-click; deployed `--local`, the walk GREEN with its new
steps. 1.2.2: the window and its sidebar button are
*Clue Board* and the party's questions *Threads* (*New Thread*) in every word a player reads, on the user's word
(the export's `format` and `mysteries` field, the API's `openMysteries` and the code's names unchanged; the export
file is `<party>-clues-<date>.json`); square cards, each picture framed by its shape (`frameShape`, tagged on load:
a tall one cropped from the top, a scroll or a panorama shown whole), as in Scroll Case. 1.2.1 Scroll Case's look
(its palette copied as `--cb-*`, the framed search, the full-height rail, cards with the picture on top, a kind
badge, the thread dots, where found and the eye's count of readers; the Reader a plain dark page; a player's unread a
static glow and a New chip). 1.2.0 `collect` takes `stamp: false`, which the MCP's `manage-clues` passes for a clue
found earlier; 1.1.0 the rail, the JSON export, the solved/unsolved marks; 1.0.0 put on prod (Echoes of Halruaa: the
ten Session 02 documents migrated to Clues from their world originals, all kind Document, collected on the Party with
no scene stamp, the stash copies and then, on the user's word, the originals deleted). Built on the user's rulings:
the Clue item type (`fvtt-mod-clueboard.clue`, its model, sheet and icon), collecting (a drop on the party, a member
or the window, Collect on the sheet or in the window's GM strip; never an inventory), the read marked when a player
opens the card, the window off a spy button on the sidebar's strip after Journal, the record on the Group actor, and
threads: the party's own sorting, a pill per named question a clue can be pinned to many of, Unsolved or Solved, with
a *Where we stand* line. `npm run verify` is green (61 tests); `tools/live-check.mjs --walk` GREEN on the sandbox.
The name is free: the setup-screen `getPackages` list (7,076 modules) has no Clue Board and no `fvtt-mod-clueboard`.
Phase 2 (the board, the export; no GM secrets, ever) waits on the plan.

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
- **Threads are the party's, on the party** (*Threads* in every word a player reads, on the user's word; *Mysteries* before 1.2.2). `flags.<id>.threads.<threadId>` (`Thread`: name, colour, question,
  status open/answered, stand, order) and an entry's pins at `entries.<clueId>.threads.<threadId>` (`{ at, order }`),
  so removing an entry removes its pins and deleting a thread is one write that forces its pins away. Any owner of
  the party organises, the GM included; a clue sits in as many threads as the party likes. A card dragged onto a
  thread's tab pins it (the window's own drag, a plain-text payload that is never a Foundry Item drop); dropped on a
  card inside a thread it goes before it; the whole order is rewritten in one write. The active tab is window state,
  per party.
- **A card is Card Catalogue's** (the user's ask, "functionality that matches card catalogue"): a click picks it
  (the gold edge, marked in place by `markPicked`, so the second click of a double click lands on it), a double
  click, Enter or its gold *Read* opens the Reader; its chevron (`menuRows`, drawn in a veil over the window as Card
  Catalogue's) holds Read, the Threads toggles with New Thread (the party's owners; a pin keeps the chevron open, so
  a clue goes to several), and the GM's Show the picture to everyone, Edit the Clue and Take it off the Clue Board.
  No action button sits on a card but Read and the chevron. A thread's row takes a right-click (Edit, Mark Solved or
  Unsolved, Delete; `#threadMenu`, Foundry's ContextMenu), as Card Catalogue's folders do. The card size (S, M, L)
  is the browser's (localStorage, per world and user); the search counts its matches and offers those outside the
  view; `/` focuses it, Escape clears it or closes the chevron; the focus survives a redraw.
- **Layout A, the rail** (the user's pick of three, `prototypes/mysteries-layouts.html`): the search across the
  top; per party a rail (the clue views, the threads, New Thread) beside `.clueboard-main` (the count, the open
  thread's head, the cards). A pin never changes the view; `.clueboard-main` and `.clueboard-rail` are the part's
  `scrollable`s, so a redraw keeps their scroll, and the query is reapplied after each render; the live check
  asserts the view, the scroll and the search survive a pin.
- **Card Catalogue's look** (the user's ruling; Scroll Case's, which Card Catalogue carried over when it replaced
  Scroll Case): the palette copied as `--cb-*` on the module's three windows (dark in Foundry's light theme too), and
  the bar, rail, head, cards, buttons and Reader follow its patterns. Gold means selected, new or the main action; a
  thread's colour lives only in its dot. A change to either module's look is made in both, by hand.
- **The export is what the party has** (`exportData`, `exportToFile`): the record as plain data, every clue's text
  as plain words and HTML, readers, note, threads, and the threads with their theories (the file keeps the key `mysteries`); nothing of the DM's.
  A button in the section head; anyone who can open the window can export.
- **Read never posts.** The Reader writes nothing to chat, ever. A GM's opening marks nothing.
- **Clue Board is a window, never a sidebar panel.** A spy button (`fa-user-secret`) is added to the sidebar's strip directly after
  Journal on `renderSidebar` (no `data-tab`, no `data-action`, so the sidebar never switches or expands for it);
  it opens `MysteriesWindow`, one per client, centred. Nothing is registered on `Sidebar.TABS` or `CONFIG.ui`: a
  tab's panel lives inside the sidebar's layout, and one there stuck the sidebar. For the GM the window carries the
  strip of uncollected world Clues and is a drop target.
- **No class patches.** The type is a Foundry declaration; the drops are hooks; the button is a DOM addition.
- **The stamp is when, never where** (the user: the scene "may not always be relevant"): the collect's real date
  and, on a chosen calendar, the calendar date. Where is the Clue's own *Found at* line; the scene the collecting
  client views (a DM between scenes, the MCP's page) is recorded by nothing, and an old entry's `sceneName` is
  shown and exported by nothing.
- **A Handlebars part renders one root element**; a world on the stock Simplified Gregorian calendar gets no
  calendar date in its stamp; card text is plain text escaped once by the template.

## How the code is laid out

- `scripts/decide/clue.js` (`// @ts-check`, pure, no Foundry): `CLUE_TYPE`, `KINDS`, `isClue`, `snapshotOf`,
  `changesSnapshot`, `partyFor`, `defaultParty`, `entryList`, `readerList`, `sortAndFilter`, `unreadCount`,
  `THREAD_COLOURS`, `threadList`, `nextColour`, `pinnedTo`, `unsorted`, `reorder`, `frameShape`. Tested in `tests/clue.test.js`.
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
