# Open Roll 5e: Clue Board

A Foundry VTT module for the dnd5e system that builds the party's **Mysteries** from what they read. A loot item
the GM types as a **Clue** is a clue; the first time a player reads it in the party stash it becomes an entry,
stamped with who read it, where they stood and when, with the text as read. The entry follows its item through
the stash, through a Take or a Give, and stays when the item leaves the party. Nothing is in Mysteries that nobody
read: clues are gathered the way an investigation game gathers them, by picking the thing up and reading it.

**Phase 1** (unreleased, 0.1.0). The plan is `docs/plans/clueboard.md` in the suite repo; the clickable
prototype it was ruled on is `prototypes/phase-1.html`.

## How it works

Phase 1 is three things.

- **The Clue type.** A new loot type, Clue, beside dnd5e's gear, treasure and junk, in the item sheet's own type
  field. A loot item of type Clue is a clue; nothing else marks one. In the party stash a Clue wears a bookmark
  on its row.
- **Read, in the stash, without posting.** A Read button on every row of the party stash (a dnd5e Group actor's
  inventory) opens the item as a document, its image and description and nothing else of the sheet, and writes
  nothing to chat. Reading a Clue there the first time gathers it: the text as read (the item's mask if it is
  unidentified), the reader, the scene, the date, the holder. That is the one way into Mysteries. Character
  sheets, item cards and item sheets are untouched.
- **Mysteries.** A scroll button on the sidebar's strip, directly after Journal, opens Mysteries as its own window
  in the middle of the screen (the sidebar itself never changes): the party's entries as cards, newest first,
  with a search and a count of the Clues nobody has read yet; a click on a card opens the entry in the Reader. Behind the window is a journal the players own, *Mysteries: \<party\>* in a *Clue Board* folder,
  made by the GM's client the first time it is needed; each entry is a page of the module's own type, so
  Foundry's search, export and permissions apply, and an owner can edit the party's note on the page.

The entry follows the item: taken from the stash, its holder flips to the member; stashed back, to the stash;
given to an NPC, deleted or sold, the entry says *left the party* and keeps what was read. A change to the item's
description while the party holds it (the GM adding what a History check revealed) re-snapshots the entry and
marks the revision.

The reader is the player's assigned character when it is in the party, else the one party member they own, else
their pick. A GM's read is silent.

Phase 2: Read on character sheets, item cards and item sheets; the board (cards, strings, leads, mysteries the
players name, a timeline); the DM's side (the truths the clues add up to and the nudge when the party has two of
three); testimony and observation; the export of the session's documents found.

## Installation

Not yet released. When it is, paste the manifest URL into Foundry's *Install Module* dialog:

```
https://github.com/Txpple/fvtt-mod-clueboard/releases/latest/download/module.json
```

Requires Foundry VTT v13 or v14 and the dnd5e system 5.x or 6.x (verified on dnd5e 6.0.6 / Foundry 14.369). No
other dependencies. Party Stash is detected when present (the Read column sits beside its Take) and never required.

## Settings

*Game Settings → Configure Settings → Open Roll 5e: Clue Board.*

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | on | Off leaves the group sheet, the sidebar and the journals exactly as Foundry and the system have them (reload). |
| Show the mark to players | on | The bookmark on a Clue's row in the stash. Off, only the GM sees it. |
| Count the ungathered | on | Mysteries says how many Clues in the party's hands nobody has read yet. |

## Hooks and API

- `clueboard.gathered(page, reader, item)` fires on the gathering client when an entry is made.
- `clueboard.changed(page, what, detail)` fires when an entry changes: `reader`, `holder`, `snapshot`, `notes`.
- `game.modules.get("fvtt-mod-clueboard").api`: `isClue(item)`, `clueId(item)`, `openReader({ item, group })` or
  `openReader({ page })`, `openMysteries()`, `gather(item, group)`, `journalFor(group)`, `ensureJournals()`.

Every listener tolerates the hooks never firing; nothing in the family listens yet.

## Repository layout

```
module.json                    the Foundry manifest (the Clue page type is declared here)
scripts/
  clueboard.js                 the entry point: settings, the loot type, the column, the button, the hooks
  common.js                    the id, the logger, the elect, the strings
  mysteries.js                 the journals, the gather, the holder, the Mysteries window
  reader.js                    the Reader window
  clue-page.js                 the entry's data model and page sheet
  decide/clue.js               the decisions that need no Foundry (tested)
  kit/                         the Open Roll 5e kit: elect.js, receipt.js, log.js, the same
                               bytes in every module that holds it (the suite keeps them)
templates/                     the column cell, the Reader, the window, the page (view and edit)
styles/clueboard.css           the column width, the mark, the Reader, the window, the page
lang/en.json                   every word a player reads
tools/live-check.mjs           the live check on the sandbox (a GM page and a player page)
prototypes/phase-1.html        the clickable prototype the design was ruled on
tests/                         the unit tests (Vitest); tests/kit/ is the kit's own
```

## Development

There is no build step: the module is plain ES modules loaded straight from `scripts/`. Run
`npm install` once; `npm run verify` is the gate: Biome and the unit tests. `scripts/kit/` and
`tests/kit/` are copies the suite's `tools/kit-sync.mjs` writes: change the kit there, never here.

The live check, `FOUNDRY_HOST=local node tools/live-check.mjs`, joins the sandbox as the bridge user and reads
back the registration and the party; with `--clues "A,B"` it types the named stash items as Clues, and with
`--read "A" --reader Kartor` a temporary player reads them through the Reader and the holder is moved and back.
It needs the MCP repo cloned beside this one (`fvtt-mcp-dnd5e`, a dev dependency) with its `.env`.

Releases: bump `version` and the `download` URL in `module.json` together and commit, then push an
annotated tag on `main` whose subject is the release title and whose body is the notes
(`git tag -a vX.Y.Z`). The release workflow checks the tag, runs the gate, builds the zip and
publishes it with a bare `module.json`. Run the workflow by hand for a dry run.

<!-- openroll5e:family -->
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
