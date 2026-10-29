// The live check of phase 1 on a real world (the local sandbox), Party Stash's verify in shape:
// a GM page (the bridge user) and a temporary player page, every fact read from the world.
//
//   FOUNDRY_HOST=local node tools/live-check.mjs                     # registration and the party, nothing written
//   FOUNDRY_HOST=local node tools/live-check.mjs --clues "A,B" --read "A" [--reader Kartor]
//
// With --clues, the named loot items in the party stash (and world items of the same names) take
// the Clue type (a write the DM would make in the item sheet). With --read, a temporary player
// user, assigned the --reader member and given Owner on the group for the run, reads each named
// Clue through the module's own Reader, which gathers it; the check then moves the first one to
// the reader's character and back on the GM page, so the holder is seen to follow. The temp user
// and its ownership go in `finally`; the Clue types and the party's Mysteries entries (on the
// Group actor) stay, which is the point: a world to look at.
import { Foundry, foundryConfig, loadEnv } from "fvtt-mcp-dnd5e/client";

const env = loadEnv();
const MODULE_ID = "fvtt-mod-clueboard";
const TEMP_USER = "ZZ-CLUE Reader";

const arg = n => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const list = s => (s ? s.split(",").map(x => x.trim()).filter(Boolean) : []);
const clueNames = list(arg("clues"));
const readNames = list(arg("read"));
const readerName = arg("reader") ?? "Kartor";
const shots = arg("shots");

let fails = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
/** Console lines the pages print that name the module, or any error at all. */
function watch(f, label, sink) {
  const page = f.page;
  if (!page) return;
  page.on("console", msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === "error" || type === "warning" || /clue ?board/i.test(text)) sink.push(`[${label} ${type}] ${text}`);
  });
  page.on("pageerror", err => sink.push(`[${label} pageerror] ${err?.message ?? err}`));
  // A 404 says nothing in the console but its status; name the URL, and whether it is ours.
  page.on("response", res => {
    if (res.status() >= 400) sink.push(`[${label} http ${res.status()}] ${res.url()}`);
  });
}

setTimeout(() => {
  console.error("[clueboard] WATCHDOG: 240s elapsed, hard abort");
  process.exit(3);
}, 240_000).unref();

const lines = [];
const f = new Foundry(foundryConfig(env));
console.log("[clueboard] connecting as the GM…");
await f.connect();
watch(f, "gm", lines);

let temp = null;
let fp = null;
let groupId = null;
try {
  // --- A. registration --------------------------------------------------------------------
  console.log("# A. registration");
  const A = await f.evaluate(
    async ({ id, pageType }) => {
      const m = game.modules.get(id);
      const strip = [...document.querySelectorAll("#sidebar nav.tabs menu > li > button")];
      const button = document.getElementById("clueboard-mysteries-button");
      const at = strip.indexOf(button);
      const before = ui.sidebar.tabGroups.primary;
      const expanded = ui.sidebar.expanded;
      button?.click();
      await new Promise(r => setTimeout(r, 800));
      const win = foundry.applications.instances.get("clueboard-mysteries");
      const rect = win?.element?.getBoundingClientRect();
      const centred = rect
        ? Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < window.innerWidth * 0.15
        : false;
      await win?.close();
      return {
        installed: !!m,
        active: !!m?.active,
        version: m?.version,
        api: !!m?.api,
        lootClue: CONFIG.DND5E.lootTypes.clue?.label ?? null,
        afterJournal: at > 0 ? strip[at - 1]?.dataset.tab : null,
        noTab: !ui.mysteries && !("mysteries" in foundry.applications.sidebar.Sidebar.TABS),
        opened: !!win,
        centred,
        sidebarStill: ui.sidebar.tabGroups.primary === before && ui.sidebar.expanded === expanded,
        noPageType: !CONFIG.JournalEntryPage.dataModels[pageType] && !(game.documentTypes?.JournalEntryPage ?? []).includes(pageType),
        noJournal: !game.journal.some(j => j.flags?.[id]) && !game.folders.some(fo => fo.flags?.[id]),
        isGM: game.user.isGM,
        user: game.user.name
      };
    },
    { id: MODULE_ID, pageType: `${MODULE_ID}.clue` }
  );
  console.log(`  bridge user ${A.user} (GM=${A.isGM}); module ${A.installed ? `v${A.version} active=${A.active}` : "NOT INSTALLED"}`);
  assert(A.active, "the module is active");
  assert(A.api, "the API is on the module");
  assert(A.lootClue === "Clue", `the Clue loot type is registered and localized (${A.lootClue})`);
  assert(A.afterJournal === "journal", `the Mysteries button sits right after Journal (after "${A.afterJournal}")`);
  assert(A.noTab, "no sidebar tab is registered: nothing of the module's is drawn in the sidebar");
  assert(A.opened && A.centred, "the button opens the Mysteries window, centred");
  assert(A.sidebarStill, "the click left the sidebar's tab and its expansion as they were");
  assert(A.noPageType, "no journal page type is registered");
  assert(A.noJournal, "no journal and no folder of the module's in the world");
  if (!A.active) throw new Error("module not active; enable it and restart the world");

  // --- B. the party and its record -------------------------------------------------------
  console.log("# B. the party");
  const B = await f.evaluate(
    async ({ id }) => {
      const primary = game.settings.get("dnd5e", "primaryParty")?.actor ?? null;
      const group = primary ?? game.actors.find(a => a.type === "group");
      if (!group) return { error: "no group actor" };
      const entries = game.modules.get(id).api.entries(group);
      return {
        groupId: group.id,
        groupName: group.name,
        members: Array.from(group.system.members).map(m => ({ id: m.actor?.id, name: m.actor?.name })),
        stash: group.items.map(i => ({
          id: i.id,
          name: i.name,
          type: i.type,
          loot: i.system?.type?.value ?? null,
          qty: i.system?.quantity ?? 1,
          clueId: i.flags?.[id]?.id ?? null
        })),
        schema: group.flags?.[id]?.schema ?? null,
        entries: entries.map(e => ({ name: e.snapshot.name, id: e.id, readers: Object.values(e.readers).map(r => r.actorName), holder: e.holder }))
      };
    },
    { id: MODULE_ID }
  );
  if (B.error) throw new Error(B.error);
  groupId = B.groupId;
  console.log(`  group "${B.groupName}" (${B.groupId}); members: ${B.members.map(m => m.name).join(", ")}`);
  for (const i of B.stash) console.log(`    stash: ${i.name}  [${i.type}${i.loot ? `/${i.loot}` : ""}] x${i.qty}${i.clueId ? `  id=${i.clueId}` : ""}`);
  for (const e of B.entries) console.log(`    entry: ${e.name}  readers=${e.readers.join(",")}  holder=${e.holder.left ? "left" : e.holder.actorName}`);
  if (B.entries.length) assert(B.schema === 1, `the party's record carries its schema version (${B.schema})`);

  // --- C. the Clue type --------------------------------------------------------------------
  if (clueNames.length) {
    console.log("# C. the Clue type on the named items");
    const C = await f.evaluate(
      async ({ groupId, names }) => {
        const group = game.actors.get(groupId);
        const done = [];
        const missing = [];
        for (const name of names) {
          const targets = [
            ...group.items.filter(i => i.type === "loot" && i.name === name),
            ...game.items.filter(i => i.type === "loot" && i.name === name)
          ];
          if (!targets.length) missing.push(name);
          for (const item of targets) {
            if (item.system.type.value !== "clue") await item.update({ "system.type.value": "clue" });
            done.push(`${name} (${item.parent ? "stash" : "world"})`);
          }
        }
        return { done, missing };
      },
      { groupId: B.groupId, names: clueNames }
    );
    for (const d of C.done) console.log(`    Clue: ${d}`);
    assert(!C.missing.length, `every named item was found${C.missing.length ? ` (missing: ${C.missing.join(", ")})` : ""}`);
  }

  // --- D. a player reads in the stash ----------------------------------------------------
  if (readNames.length) {
    console.log(`# D. a player (${readerName}) reads in the stash`);
    temp = await f.evaluate(
      async ({ groupId, userName, readerName }) => {
        const group = game.actors.get(groupId);
        const reader = Array.from(group.system.members).map(m => m.actor).find(a => a?.name.startsWith(readerName));
        if (!reader) return { error: `no member named ${readerName}` };
        const user =
          game.users.find(u => u.name === userName) ??
          (await User.implementation.create({ name: userName, role: CONST.USER_ROLES.PLAYER, character: reader.id }));
        if (user.character?.id !== reader.id) await user.update({ character: reader.id });
        const had = group.ownership[user.id] ?? null;
        await group.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
        return { userId: user.id, readerId: reader.id, readerName: reader.name, had };
      },
      { groupId: B.groupId, userName: TEMP_USER, readerName }
    );
    if (temp.error) throw new Error(temp.error);
    console.log(`  temp user ${TEMP_USER} (${temp.userId}) reads as ${temp.readerName}`);

    fp = new Foundry({ ...foundryConfig(env), user: TEMP_USER, password: "" });
    console.log("[clueboard] connecting as the player…");
    await fp.connect();
    watch(fp, "player", lines);

    for (const name of readNames) {
      const D = await fp.evaluate(
        async ({ id, groupId, name }) => {
          const group = game.actors.get(groupId);
          const item = group?.items.find(i => i.name === name);
          if (!item) return { error: `no stash item named ${name}` };
          const api = game.modules.get(id).api;
          const app = await api.openReader({ item, group });
          await new Promise(r => setTimeout(r, 300));
          const rendered = !!app?.rendered;
          const text = app?.element?.querySelector(".clueboard-doc-text")?.textContent?.trim().slice(0, 60) ?? null;
          const stamp = !!app?.element?.querySelector(".clueboard-stamp");
          const chat = game.messages.contents.slice(-1)[0]?.id ?? null;
          await app?.close();
          const entry = api.entry(group, item.getFlag(id, "id"));
          return {
            isOwnerOfGroup: group.isOwner,
            clueId: item.getFlag(id, "id") ?? null,
            rendered,
            text,
            stamp,
            chat,
            page: entry ? { name: entry.snapshot.name, readers: Object.values(entry.readers).map(r => r.actorName), holder: entry.holder.actorName, scene: entry.foundIn.sceneName, cal: entry.foundIn.calendarDate } : null,
            inDirectory: game.journal.some(j => j.flags?.[id]) || game.folders.some(fo => fo.flags?.[id])
          };
        },
        { id: MODULE_ID, groupId: B.groupId, name }
      );
      if (D.error) {
        assert(false, D.error);
        continue;
      }
      assert(D.isOwnerOfGroup, "the player owns the group");
      assert(D.rendered && D.text, `the Reader opened on ${name}: "${D.text}"`);
      assert(D.clueId, `the id flag was written (${D.clueId})`);
      assert(D.page?.readers.includes(temp.readerName), `the entry exists and names the reader (${D.page?.readers.join(", ")})`);
      assert(D.page?.holder === B.groupName, `the holder is the stash (${D.page?.holder})`);
      assert(D.stamp, `the Reader shows the stamp (scene "${D.page?.scene}", ${D.page?.cal || "no calendar"})`);
      assert(!D.inDirectory, "nothing of the record shows in the player's Journal directory");
    }

    // the chat stayed quiet
    const chatAfter = await f.evaluate(() => game.messages.contents.slice(-3).map(m => m.flavor || m.content?.slice(0, 60)));
    console.log(`  last chat lines: ${JSON.stringify(chatAfter)}`);

    // the window, on the player page
    const T = await fp.evaluate(async id => {
      const app = game.modules.get(id).api.openMysteries();
      for (let i = 0; i < 50 && !app.rendered; i++) await new Promise(r => setTimeout(r, 100));
      const cards = app.element.querySelectorAll(".clueboard-card").length;
      const count = app.element.querySelector(".clueboard-count")?.textContent?.trim() ?? null;
      await app.close();
      return { cards, count };
    }, MODULE_ID);
    assert(T.cards >= readNames.length, `the Mysteries window lists the entries (${T.cards} cards; "${T.count}")`);

    // --- E. the holder follows a move -----------------------------------------------------
    console.log("# E. the holder follows a move (GM page: stash -> reader -> stash)");
    const E = await f.evaluate(
      async ({ id, groupId, readerId, name }) => {
        const group = game.actors.get(groupId);
        const reader = game.actors.get(readerId);
        const api = game.modules.get(id).api;
        const item = group.items.find(i => i.name === name);
        if (!item) return { error: `no stash item ${name}` };
        const clueId = item.getFlag(id, "id");
        const entry = () => api.entry(group, clueId);
        const wait = async pred => {
          for (let i = 0; i < 25; i++) {
            if (pred()) return true;
            await new Promise(r => setTimeout(r, 200));
          }
          return false;
        };
        const [copy] = await reader.createEmbeddedDocuments("Item", [item.toObject()]);
        await item.delete();
        const toReader = await wait(() => entry()?.holder.actorId === reader.id);
        const holder1 = entry()?.holder.actorName;
        const [back] = await group.createEmbeddedDocuments("Item", [copy.toObject()]);
        await copy.delete();
        const toStash = await wait(() => entry()?.holder.actorId === group.id);
        const holder2 = entry()?.holder.actorName;
        return { toReader, holder1, toStash, holder2, backId: back.id };
      },
      { id: MODULE_ID, groupId: B.groupId, readerId: temp.readerId, name: readNames[0] }
    );
    if (E.error) assert(false, E.error);
    else {
      assert(E.toReader, `moved to ${temp.readerName}: the holder followed (${E.holder1})`);
      assert(E.toStash, `moved back: the holder is the stash again (${E.holder2})`);
    }
  }
  // --- F. screenshots of the three places, on the GM page --------------------------------
  if (shots) {
    console.log(`# F. screenshots into ${shots}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(shots, { recursive: true });
    await f.page.setViewportSize?.({ width: 1600, height: 1000 }).catch(() => {});
    await f.evaluate(async ({ groupId }) => {
      const group = game.actors.get(groupId);
      await group.sheet.render({ force: true });
      await new Promise(r => setTimeout(r, 800));
      group.sheet.element?.querySelector('[data-tab="inventory"], .tabs [data-tab="inventory"]')?.click();
      await new Promise(r => setTimeout(r, 600));
    }, { groupId });
    await f.page.screenshot({ path: `${shots}/1-stash.png` });
    await f.evaluate(async ({ groupId }) => {
      game.actors.get(groupId).sheet.close();
      document.getElementById("clueboard-mysteries-button")?.click();
      await new Promise(r => setTimeout(r, 800));
    }, { groupId });
    await f.page.screenshot({ path: `${shots}/2-mysteries.png` });
    await f.evaluate(async ({ groupId, id }) => {
      await foundry.applications.instances.get("clueboard-mysteries")?.close();
      const api = game.modules.get(id).api;
      const group = game.actors.get(groupId);
      const [first] = api.entries(group);
      if (first) await api.openReader({ group, id: first.id });
      await new Promise(r => setTimeout(r, 800));
    }, { groupId, id: MODULE_ID });
    await f.page.screenshot({ path: `${shots}/3-reader.png` });
    await f.evaluate(async () => {
      for (const app of foundry.applications.instances.values()) if (app.constructor.name === "Reader") await app.close();
    });
    console.log("  written: 1-stash.png, 2-mysteries.png, 3-reader.png");
  }
} finally {
  if (fp) await fp.disconnect?.().catch(() => {});
  if (temp?.userId) {
    await f
      .evaluate(
        async ({ groupId, userId, had }) => {
          const group = game.actors.get(groupId);
          // The whole map, replaced: a deletion operator inside ownership fails its validation on
          // v14, and a key left for a deleted user is litter on the party's actor.
          const ownership = { ...group.ownership };
          if (had === null) delete ownership[userId];
          else ownership[userId] = had;
          await group.update({ ownership }, { recursive: false, diff: false });
          await game.users.get(userId)?.delete();
        },
        { groupId, userId: temp.userId, had: temp.had }
      )
      .catch(err => console.log(`  cleanup: ${err?.message ?? err}`));
  }
  await f.disconnect?.().catch(() => {});
}

console.log("# console");
if (!lines.length) console.log("  (nothing from the module, no errors)");
for (const l of lines) console.log(`  ${l}`);
const ours = lines.filter(l => /clue ?board/i.test(l));
const errors = ours.filter(l => /error|http 4|http 5/i.test(l) && !/warning/i.test(l));
const others = lines.filter(l => /pageerror|http 4|http 5/i.test(l) && !/clue ?board/i.test(l));
assert(!errors.length, `no errors of the module's on either page (${errors.length})`);
if (others.length) console.log(`  (${others.length} line(s) not the module's: resource 404s and other packages' errors, listed above)`);

console.log(fails ? `\n${fails} FAIL` : "\nGREEN");
process.exit(fails ? 1 : 0);
