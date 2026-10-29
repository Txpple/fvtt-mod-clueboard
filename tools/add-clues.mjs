// Make Clues in a world and collect them on a party, from a JSON file: the way in for a script or
// an agent, since the MCP's createWorldItems knows only dnd5e's own item types.
//
//   FOUNDRY_HOST=local  node tools/add-clues.mjs <clues.json> [--party <name>] [--no-stamp] [--dry-run]
//   FOUNDRY_HOST=molten FVTT_MCP_ENV=<path>/.env.halruaa node tools/add-clues.mjs <clues.json> ...
//
// The file is an array of { name, kind, img, text, foundAt }: `kind` one of the module's KINDS,
// `text` HTML. Each Clue goes into the world's "Clues" Item folder, in the subfolder flagged with
// its kind when there is one. A world Clue of the same name is reused, never doubled; one already
// on the party is left as it is. `--no-stamp` clears the scene from the stamp, for a clue found
// sessions ago (its Found at line says where). Connects as the GM user of the env.
import { readFileSync } from "node:fs";
import { Foundry, foundryConfig, loadEnv } from "fvtt-mcp-dnd5e/client";

const MODULE_ID = "fvtt-mod-clueboard";
const arg = n => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node tools/add-clues.mjs <clues.json> [--party <name>] [--no-stamp] [--dry-run]");
  process.exit(2);
}
const clues = JSON.parse(readFileSync(file, "utf8"));
const opts = { party: arg("party"), noStamp: process.argv.includes("--no-stamp"), dryRun: process.argv.includes("--dry-run") };

const f = new Foundry(foundryConfig(loadEnv()));
await f.connect();
try {
  const result = await f.evaluate(
    async ({ id, clues, opts }) => {
      const api = game.modules.get(id)?.api;
      if (!api) throw new Error(`${id} is not active in this world`);
      const type = `${id}.clue`;
      const parties = api.parties();
      const group = opts.party ? parties.find(g => g.name === opts.party) : (game.actors.party ?? parties[0]);
      if (!group) throw new Error(`no party${opts.party ? ` named "${opts.party}"` : ""}`);
      const root = game.folders.find(fd => fd.type === "Item" && fd.name === "Clues" && !fd.folder);
      const kindFolder = kind =>
        game.folders.find(fd => fd.type === "Item" && fd.folder?.id === root?.id && fd.flags?.[id]?.kind === kind) ?? root;
      const out = [];
      for (const c of clues) {
        let item = game.items.find(i => i.type === type && i.name === c.name);
        const made = !item;
        if (!item && !opts.dryRun) {
          item = await Item.implementation.create({
            name: c.name, type, img: c.img, folder: kindFolder(c.kind)?.id ?? null,
            system: { kind: c.kind, text: c.text, foundAt: c.foundAt ?? "" }
          });
        }
        const already = item ? !!api.entry(group, item.id) : false;
        if (item && !already && !opts.dryRun) {
          await api.collect(item, group, { how: "script" });
          if (opts.noStamp) {
            await group.update({ [`flags.${id}.entries.${item.id}.foundIn`]: { ...api.entry(group, item.id).foundIn, sceneId: "", sceneName: "" } }, { render: false });
          }
        }
        out.push({ name: c.name, id: item?.id ?? null, folder: item?.folder?.name ?? kindFolder(c.kind)?.name ?? null, made, collected: !already });
      }
      return { party: group.name, entries: api.entries(group).length, clues: out };
    },
    { id: MODULE_ID, clues, opts }
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await f.disconnect?.().catch(() => {});
}
