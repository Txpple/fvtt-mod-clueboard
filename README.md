# Open Roll 5e: Clue Board

**Not built yet.** This repo holds the plan and a clickable prototype; the module's code is the family template.
The plan is `../docs/plans/clueboard.md` in the suite repo, the prototype `prototypes/phase-1.html`.

A Foundry VTT module for the dnd5e system that builds the party's case file from what they read. Every letter,
ledger, notice, key and heirloom the DM marks as a clue becomes a card the first time a player reads it, stamped
with who read it, where they stood and when. The card follows its item through the party stash, through a Take,
a Stash or a Give, and stays when the item leaves the party. Nothing is on the board that nobody read: clues are
gathered the way an investigation game gathers them, by picking the thing up and reading it.

## How it will work

- **Read, without posting.** A Read button on every inventory row, item card and item sheet opens the item as a
  document and writes nothing to chat.
- **Gather on read.** Reading a marked item the first time records it in the party's Case File, a journal the
  players own: the text as read, the reader, the scene, the date, the holder.
- **The holder follows the item.** A clue in the stash is everyone's to read; moved by Party Stash, the card's
  holder flips with it; given to an NPC or lost, the card stays and says so.
- **The DM's overlay.** The truths the clues add up to, each with how many clues it needs, and the nudge when the
  party has two of three and has not put it together.
- **Export.** The session's documents found, as Markdown, for the session record.
- **Phase 2: the board.** Cards, strings, leads, threads the players name, and a timeline.

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
