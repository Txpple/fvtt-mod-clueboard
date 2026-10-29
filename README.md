# Open Roll 5e: Clue Board

**Not built yet.** This repo holds the plan and a clickable prototype; the module's code is the family template.
The plan is `../docs/plans/clueboard.md` in the suite repo, the prototype `prototypes/phase-1.html`.

A Foundry VTT module for the dnd5e system that builds the party's case file from what they read. Every letter,
ledger, notice, key and heirloom the DM marks as a clue becomes a card the first time a player reads it, stamped
with who read it, where they stood and when. The card follows its item through the party stash, through a Take,
a Stash or a Give, and stays when the item leaves the party. Nothing is on the board that nobody read: clues are
gathered the way an investigation game gathers them, by picking the thing up and reading it.

## How it will work

Phase 1 is three things.

- **The Clue type.** A new loot type, Clue, beside dnd5e's gear, treasure and junk. A loot item of type Clue is a
  clue; nothing else marks one. The GM sets it in the item's own type field.
- **Read, in the stash, without posting.** A Read button on every row of the party stash (a Group actor's
  inventory) opens the item as a document and writes nothing to chat. Reading a Clue there the first time gathers
  it: the text as read, the reader, the scene, the date, the holder. That is the one way into Mysteries; character
  sheets, item cards and item sheets are untouched.
- **Mysteries.** A sidebar tab directly after Journal opens the party's record: one entry per gathered clue, the
  holder followed live (taken from the stash, the entry's holder flips; given to an NPC or lost, the entry stays and
  says so), a note a player can leave, and a count of what nobody has read yet.

Phase 2: Read on character sheets, item cards and item sheets; the board (cards, strings, leads, mysteries the
players name, a timeline); the DM's side (the truths the clues add up to and the nudge when the party has two of
three); testimony and observation; the export of the session's documents found.

## Installation

Not yet released. When it is, paste the manifest URL into Foundry's *Install Module* dialog:

```
https://github.com/Txpple/fvtt-mod-clueboard/releases/latest/download/module.json
```

Requires Foundry VTT v13 or v14 and the dnd5e system 5.x or 6.x. No other dependencies. Party Stash, Loot Shelf and
By the Books are detected when present and never required.

## Settings

*Game Settings → Configure Settings → Open Roll 5e: Clue Board.*

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | on | Off leaves the world exactly as Foundry and the system have it. |

## Repository layout

```
module.json                    the Foundry manifest
scripts/
  clueboard.js                 the module's entry point
  kit/                         the Open Roll 5e kit: elect.js, receipt.js, log.js, the same
                               bytes in every module that holds it (the suite keeps them)
lang/en.json                   every word a player reads
prototypes/phase-1.html        the clickable prototype of phase 1 (open it in a browser)
tests/                         the unit tests (Vitest); tests/kit/ is the kit's own
```

## Development

There is no build step: the module is plain ES modules loaded straight from `scripts/`. Run
`npm install` once; `npm run verify` is the gate: Biome and the unit tests. `scripts/kit/` and
`tests/kit/` are copies the suite's `tools/kit-sync.mjs` writes: change the kit there, never here.

Releases: bump `version` and the `download` URL in `module.json` together and commit, then push an
annotated tag on `main` whose subject is the release title and whose body is the notes
(`git tag -a vX.Y.Z`). The release workflow checks the tag, runs the gate, builds the zip and
publishes it with a bare `module.json`. Run the workflow by hand for a dry run.

<!-- openroll5e:family -->
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
