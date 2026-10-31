# Open Roll 5e: Clue Board

A Foundry VTT module for the dnd5e system that keeps the party's **Mysteries**: the clues the DM has handed them,
each stamped with where it was found and who has read it. A **Clue** is an item type of the module's own, never
gear: it has no price, no weight and no place in anyone's inventory. The DM collects a Clue for the party, it
appears in Mysteries at once, and a player's opening of it there marks the read.

**1.2.0**, phase 1. The plan is `docs/plans/clueboard.md` in the suite repo; the clickable prototypes
it was ruled on are `prototypes/phase-1.html` and `prototypes/clue-management.html`.

## How it works

Phase 1 is four things.

- **The Clue.** A new item type, Clue, in the Create Item dialog beside dnd5e's own. Its sheet is plain: name,
  image, the text, an optional *Found at* line in the DM's words, and the kind: Document, Object, Statement,
  Location, Body, Rumour or Vision. The DM makes Clues in the Items directory or keeps them in a compendium. A Clue cannot
  be carried: dropped on a character it goes to the party's Mysteries instead, and dnd5e refuses it on a party's
  stash.
- **Collecting.** The DM drags a Clue onto the Party sheet, onto a member's sheet or onto the Mysteries window, or
  presses *Collect* on the Clue's sheet or in the GM strip at the top of Mysteries. Collecting stamps the scene the
  table is viewing and the calendar date when the world has one, and copies the text as it reads. The Clue stays in
  the Items directory as the DM's master; an edit there updates the party's copy and marks the revision. *Take
  back* (on the sheet, or the ✕ on a card) takes it out again.
- **Mysteries.** A spy button (`fa-user-secret`) on the sidebar's strip, directly after Journal, opens Mysteries as its own window
  in the middle of the screen (the sidebar itself never changes): the party's Clues as cards, newest first, with a
  search and a count of what the player has not read yet. A click opens the Reader, which shows the text, the stamp
  and who has read it, and lets a player write the party's note. Opening a card as a player marks the read for
  their character; a GM's opening marks nothing. Nothing goes to chat, ever.
- **The window's layout.** The search runs across the top. Below it, a rail on the left lists *All Clues* and
  *Unassigned Clues*, then the party's mysteries with their counts and *New mystery*; the cards fill the right
  and scroll on their own. Dropping a card on a mystery in the rail pins it without leaving the view, so a player
  can work down the list pinning clue after clue; the scroll and the search stay put.
- **Mysteries the party names.** The party's own sorting. A mystery (a *thread* in the code) is a question or a
  line of inquiry with a name, a colour and a short *Where we stand*, unsolved or solved; it is a tab beside *All*
  and *Unassigned*. Drag a card onto
  a mystery's tab to pin it there, onto another card inside it to order it; a clue can sit in as many mysteries as
  the party likes, and wears a dot for each. Anyone who owns the party makes, edits and deletes them, the GM
  included; deleting one unpins its clues and loses nothing else.

**Export.** The file icon beside the count in Mysteries saves the party's clues as a JSON file, every clue with
its text (as plain words and as HTML), where and when it was found, who has read it, the party's note and the
mysteries it sits in, then the mysteries themselves with their questions and theories: something to hand to a
player who wants to feed the case to an AI, or to keep. Anyone who can open Mysteries can export.

The record is kept on the party's Group actor itself, out of sight: no journal, no folder, nothing in a directory
or on a sheet. The players write their reads from their own clients (they own the party, as Party Stash needs),
so a read is marked with no GM online. A world with several parties keeps one record per party; with none, there
is nowhere to collect to.

Phase 2: the board (cards, strings, leads, mysteries the players name, a timeline); the export of the session's documents found. There are no GM secrets in Mysteries, in any phase.

## Installation

Paste the manifest URL into Foundry's *Install Module* dialog:

```
https://github.com/Txpple/fvtt-mod-clueboard/releases/latest/download/module.json
```

Requires Foundry VTT v13 or v14 and the dnd5e system 5.x or 6.x (verified on dnd5e 6.0.6 / Foundry 14.369). No
other dependencies; nothing of the family is required or detected.

## Settings

*Game Settings → Configure Settings → Open Roll 5e: Clue Board.*

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | on | Off leaves the sidebar exactly as Foundry has it and collects nothing (reload); the Clue type, the Clues and the parties' records stay. |

## Hooks and API

- `clueboard.collected(entry, group, item)` fires on the collecting client when an entry is made.
- `clueboard.changed(entry, what, detail, group)` fires when an entry changes: `reader`, `snapshot`, `notes`,
  `pinned`, `unpinned`, `removed` (then `entry` is null and `detail` the entry as it was). An entry is a plain
  object: `id` (the Clue item's), `kind`, `source`, `snapshot`, `foundIn`, `readers` (keyed by actor), `notes`,
  `threads` (keyed by thread, each `{ at, order }`).
- `clueboard.thread(thread, what, group)` fires when a thread is `created`, `edited`, `reordered` or `removed`
  (then `thread` is null and a fourth argument is the thread as it was).
- `game.modules.get("fvtt-mod-clueboard").api`: `isClue(item)`, `collect(item, group, { stamp })` (`stamp: false` leaves the scene and date out, for a clue found before it was collected), `uncollect(group, id, { confirm })` (the GM is asked unless `confirm: false`),
  `markRead(group, id)`, `openReader({ group, id })`, `openMysteries()`, `entries(group)`, `entry(group, id)`,
  `findEntry(id)`, `parties()`, `threads(group)`, `createThread(group, { name, question })`,
  `updateThread(group, id, changes)`, `removeThread(group, id, { confirm })`, `pin(group, clueId, threadId)`,
  `unpin(group, clueId, threadId)`, `movePin(group, threadId, clueId, beforeId)`, `exportData(group)` (the plain
  object), `exportToFile(group)` (the download).

Every listener tolerates the hooks never firing; nothing in the family listens yet.

## Repository layout

```
module.json                    the Foundry manifest (the Clue item type is declared here)
scripts/
  clueboard.js                 the entry point: the setting, the type, the drops, the button, the hooks
  common.js                    the id, the logger, the strings
  clue-item.js                 the Clue's data model, its sheet, its icon
  store.js                     the party's record on its Group actor: the entry's and the thread's schema, the writes
  mysteries.js                 collecting, the read marks, the threads, the Mysteries window
  reader.js                    the Reader window
  decide/clue.js               the decisions that need no Foundry (tested)
  kit/                         the Open Roll 5e kit: elect.js, receipt.js, log.js, the same
                               bytes in every module that holds it (the suite keeps them)
templates/                     the Clue's sheet, the Reader, the window
styles/clueboard.css           the Reader, the window, the GM strip, the Clue's sheet
lang/en.json                   every word a player reads
tools/live-check.mjs           the live check on the sandbox (a GM page and a player page)
prototypes/                    the clickable prototypes the design was ruled on
tests/                         the unit tests (Vitest); tests/kit/ is the kit's own
```

## Development

There is no build step: the module is plain ES modules loaded straight from `scripts/`. Run
`npm install` once; `npm run verify` is the gate: Biome and the unit tests. `scripts/kit/` and
`tests/kit/` are copies the suite's `tools/kit-sync.mjs` writes: change the kit there, never here.

The live check, `FOUNDRY_HOST=local node tools/live-check.mjs`, joins the sandbox as the bridge user and reads
back the registration and the party; with `--walk [--reader Kartor] [--shots <dir>]` it makes a scratch Clue,
collects it three ways, proves it can never land in an inventory, has a temporary player open it so the read is
marked, edits it for a revision, has the player make a thread and pin and order clues on it, and cleans up after
itself. It needs the MCP repo cloned beside this one
(`fvtt-mcp-dnd5e`, a dev dependency) with its `.env`.

Releases: bump `version` and the `download` URL in `module.json` together and commit, then push an
annotated tag on `main` whose subject is the release title and whose body is the notes
(`git tag -a vX.Y.Z`). The release workflow checks the tag, runs the gate, builds the zip and
publishes it with a bare `module.json`. Run the workflow by hand for a dry run.

<!-- openroll5e:family -->
## Part of Open Roll 5e

Clue Board is one of the Open Roll 5e modules for Foundry VTT, a suite built for one D&D 5e table and
shared. Each module installs and works on its own and none needs another; together they cover the
table from the fog of war to the loot. The other modules:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: By the Books](https://github.com/Txpple/fvtt-mod-bythebooks): the 2024 rules played from the sheet: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, concentration is tracked, and rests, senses, sizes and lights follow the book. Every rule that rides a use or an effect in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within, each step with a receipt and a revert; offered, never enforced.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives every user a one-click jump to their character's token, and their familiar's, from the Players list.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.
- [Open Roll 5e: Area Sounds](https://github.com/Txpple/fvtt-mod-areasounds): background sound for scenes: random one-shots with silence between them, seamless crossfaded loops, day and night gating, and quiet during combat.
- [Open Roll 5e: Token Art](https://github.com/Txpple/fvtt-mod-tokenart): gives every token the look of its state, ready, in combat or dead, each a file named beside the base art, with nothing to configure.
- [Open Roll 5e: Scroll Case](https://github.com/Txpple/fvtt-mod-scrollcase): turns the journal into a case of cards: find any handout or picture in a keystroke, show it to the players in one click, and let them read it in a plain, quiet window.

Three MCP servers for [Claude Code](https://claude.com/claude-code) complete the suite:

- [fvtt-mcp-dnd5e](https://github.com/Txpple/fvtt-mcp-dnd5e): builds D&D 5e content in a live Foundry world from Claude Code: a stat block becomes a complete NPC, a map image a walled and lit scene, an adventure its journals, tables and handouts.
- [fvtt-mcp-imagegen](https://github.com/Txpple/fvtt-mcp-imagegen): makes the art with Google's Gemini image models: icons, tokens, props, portraits and illustrations, token redresses and restyles, battlemap and overland-map repaints, and the illustrated session records, all grounded in what the world already shows.
- [fvtt-mcp-sessionscribe](https://github.com/Txpple/fvtt-mcp-sessionscribe): turns a session's Discord recording and Foundry chat log into its record. Its end-to-end `session-scribe` skill drives the server from the Craig link to a speaker-labelled transcript, a fully illustrated player recap, combat statistics, GM notes and a party snapshot.

Issues are welcome on every repo in the family; pull requests are not accepted, since each is one
author's design for one table, shared because it might suit yours. How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
