# Open Roll 5e: Clue Board

A Foundry VTT module for the dnd5e system that keeps the party's **Mysteries**: the clues the DM has handed them,
each stamped with where it was found and who has read it. A **Clue** is an item type of the module's own, never
gear: it has no price, no weight and no place in anyone's inventory. The DM collects a Clue for the party, it
appears in Mysteries at once, and a player's opening of it there marks the read.

**Phase 1** (unreleased, 0.1.0). The plan is `docs/plans/clueboard.md` in the suite repo; the clickable prototypes
it was ruled on are `prototypes/phase-1.html` and `prototypes/clue-management.html`.

## How it works

Phase 1 is three things.

- **The Clue.** A new item type, Clue, in the Create Item dialog beside dnd5e's own. Its sheet is plain: name,
  image, the text, an optional *Found at* line in the DM's words, and the kind (documents first; testimony and
  observation are phase 2). The DM makes Clues in the Items directory or keeps them in a compendium. A Clue cannot
  be carried: dropped on a character it goes to the party's Mysteries instead, and dnd5e refuses it on a party's
  stash.
- **Collecting.** The DM drags a Clue onto the Party sheet, onto a member's sheet or onto the Mysteries window, or
  presses *Collect* on the Clue's sheet or in the GM strip at the top of Mysteries. Collecting stamps the scene the
  table is viewing and the calendar date when the world has one, and copies the text as it reads. The Clue stays in
  the Items directory as the DM's master; an edit there updates the party's copy and marks the revision. *Take
  back* (on the sheet, or the ✕ on a card) takes it out again.
- **Mysteries.** A scroll button on the sidebar's strip, directly after Journal, opens Mysteries as its own window
  in the middle of the screen (the sidebar itself never changes): the party's Clues as cards, newest first, with a
  search and a count of what the player has not read yet. A click opens the Reader, which shows the text, the stamp
  and who has read it, and lets a player write the party's note. Opening a card as a player marks the read for
  their character; a GM's opening marks nothing. Nothing goes to chat, ever.

The record is kept on the party's Group actor itself, out of sight: no journal, no folder, nothing in a directory
or on a sheet. The players write their reads from their own clients (they own the party, as Party Stash needs),
so a read is marked with no GM online. A world with several parties keeps one record per party; with none, there
is nowhere to collect to.

Phase 2: the board (cards, strings, leads, mysteries the players name, a timeline); testimony and observation as
kinds of Clue; the export of the session's documents found. There are no GM secrets in Mysteries, in any phase.

## Installation

Not yet released. When it is, paste the manifest URL into Foundry's *Install Module* dialog:

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
  `removed` (then `entry` is null and `detail` the entry as it was). An entry is a plain object: `id` (the Clue
  item's), `kind`, `source`, `snapshot`, `foundIn`, `readers` (keyed by actor), `notes`.
- `game.modules.get("fvtt-mod-clueboard").api`: `isClue(item)`, `collect(item, group)`, `uncollect(group, id)`,
  `markRead(group, id)`, `openReader({ group, id })`, `openMysteries()`, `entries(group)`, `entry(group, id)`,
  `findEntry(id)`, `parties()`.

Every listener tolerates the hooks never firing; nothing in the family listens yet.

## Repository layout

```
module.json                    the Foundry manifest (the Clue item type is declared here)
scripts/
  clueboard.js                 the entry point: the setting, the type, the drops, the button, the hooks
  common.js                    the id, the logger, the strings
  clue-item.js                 the Clue's data model, its sheet, its icon
  store.js                     the party's record on its Group actor: the entry's schema, the writes
  mysteries.js                 collecting, the read marks, the Mysteries window
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
marked, edits it for a revision, and cleans up after itself. It needs the MCP repo cloned beside this one
(`fvtt-mcp-dnd5e`, a dev dependency) with its `.env`.

Releases: bump `version` and the `download` URL in `module.json` together and commit, then push an
annotated tag on `main` whose subject is the release title and whose body is the notes
(`git tag -a vX.Y.Z`). The release workflow checks the tag, runs the gate, builds the zip and
publishes it with a bare `module.json`. Run the workflow by hand for a dry run.

<!-- openroll5e:family -->
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
