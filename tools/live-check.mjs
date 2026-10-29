// The live check on a real world (the local sandbox), Party Stash's verify in shape: a GM page
// (the bridge user) and a temporary player page, every fact read from the world.
//
//   FOUNDRY_HOST=local node tools/live-check.mjs                       # registration and the party, nothing written
//   FOUNDRY_HOST=local node tools/live-check.mjs --walk [--reader Kartor] [--shots <dir>]
//
// With --walk, the GM page makes a scratch Clue in the world and collects it three ways (a drop
// on the party, a drop on a member, Collect), proves a Clue can never land in an inventory, has a
// temporary player (assigned the --reader member, given Owner on the group for the run) open it
// in Mysteries so the read is marked, edits the Clue so the entry's snapshot moves to revision 2,
// takes it out and collects it again. The scratch Clue, its entry, the temp user and its
// ownership go in `finally`; the party's own record is never touched.
import { Foundry, foundryConfig, loadEnv } from "fvtt-mcp-dnd5e/client";

const env = loadEnv();
const MODULE_ID = "fvtt-mod-clueboard";
const CLUE_TYPE = `${MODULE_ID}.clue`;
const TEMP_USER = "ZZ-CLUE Reader";
const SCRATCH = "ZZ-CLUE Scratch";
const THREAD = "ZZ-CLUE Thread";

const arg = n => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const walk = process.argv.includes("--walk");
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
  page.on("response", res => {
    if (res.status() >= 400) sink.push(`[${label} http ${res.status()}] ${res.url()}`);
  });
}

let cleanup = async () => {};
setTimeout(async () => {
  console.error("[clueboard] WATCHDOG: 120s elapsed, cleaning up and aborting");
  await cleanup().catch(() => {});
  process.exit(3);
}, 120_000).unref();

const lines = [];
const f = new Foundry(foundryConfig(env));
console.log("[clueboard] connecting as the GM…");
await f.connect();
watch(f, "gm", lines);

let temp = null;
let fp = null;
let groupId = null;
let scratchId = null;
/** The one cleanup, run by `finally` or by the watchdog, whichever comes first. */
cleanup = async () => {
  cleanup = async () => {};
  if (fp) await fp.disconnect?.().catch(() => {});
  if (scratchId || temp?.userId) {
    await f
      .evaluate(
        async ({ id, groupId, scratchId, userId, had, thread }) => {
          const api = game.modules.get(id).api;
          const group = game.actors.get(groupId);
          if (scratchId) {
            if (api.entry(group, scratchId)) await api.uncollect(group, scratchId, { confirm: false });
            await game.items.get(scratchId)?.delete();
          }
          for (const th of api.threads(group).filter(th => th.name === thread)) await api.removeThread(group, th.id, { confirm: false });
          if (userId) {
            // The whole map, replaced: a deletion operator inside ownership fails its validation
            // on v14, and a key left for a deleted user is litter on the party's actor.
            const ownership = { ...group.ownership };
            if (had === null) delete ownership[userId];
            else ownership[userId] = had;
            await group.update({ ownership }, { recursive: false, diff: false });
            await game.users.get(userId)?.delete();
          }
        },
        { id: MODULE_ID, groupId, scratchId, userId: temp?.userId ?? null, had: temp?.had ?? null, thread: THREAD }
      )
      .catch(err => console.log(`  cleanup: ${err?.message ?? err}`));
  }
  await f.disconnect?.().catch(() => {});
};

try {
  // --- A. registration --------------------------------------------------------------------
  console.log("# A. registration");
  const A = await f.evaluate(
    async ({ id, type }) => {
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
      const centred = rect ? Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < window.innerWidth * 0.15 : false;
      const gmStrip = !!win?.element?.querySelector(".clueboard-gm-strip");
      await win?.close();
      const group = game.actors.find(a => a.type === "group");
      await group?.sheet.render({ force: true });
      await new Promise(r => setTimeout(r, 800));
      const readColumn = !!group?.sheet.element?.querySelector(".item-clueboardRead, .clueboard-read-button, .clueboard-mark");
      await group?.sheet.close();
      return {
        installed: !!m,
        active: !!m?.active,
        version: m?.version,
        api: !!m?.api,
        typeKnown: Item.TYPES.includes(type),
        model: !!CONFIG.Item.dataModels[type],
        sheet: Object.keys(CONFIG.Item.sheetClasses?.[type] ?? {}),
        artwork: CONFIG.DND5E?.defaultArtwork?.Item?.[type] ?? null,
        label: game.i18n.localize(`TYPES.Item.${type}`),
        lootClue: CONFIG.DND5E.lootTypes.clue ?? null,
        afterJournal: at > 0 ? strip[at - 1]?.dataset.tab : null,
        noTab: !ui.mysteries && !("mysteries" in foundry.applications.sidebar.Sidebar.TABS),
        opened: !!win,
        centred,
        gmStrip,
        sidebarStill: ui.sidebar.tabGroups.primary === before && ui.sidebar.expanded === expanded,
        readColumn,
        isGM: game.user.isGM,
        user: game.user.name
      };
    },
    { id: MODULE_ID, type: CLUE_TYPE }
  );
  console.log(`  bridge user ${A.user} (GM=${A.isGM}); module ${A.installed ? `v${A.version} active=${A.active}` : "NOT INSTALLED"}`);
  assert(A.active, "the module is active");
  assert(A.api, "the API is on the module");
  assert(A.typeKnown && A.model, `the Clue item type is registered with its data model (${CLUE_TYPE})`);
  assert(A.sheet.length > 0, `the Clue type has its sheet (${A.sheet.join(", ")})`);
  assert(A.label === "Clue", `the type is labelled "Clue" (${A.label})`);
  assert(!!A.artwork, `the type has its default artwork (${A.artwork})`);
  assert(A.lootClue === null, "the Clue loot subtype is gone");
  assert(A.afterJournal === "journal", `the Mysteries button sits right after Journal (after "${A.afterJournal}")`);
  assert(A.noTab, "no sidebar tab is registered: nothing of the module's is drawn in the sidebar");
  assert(A.opened && A.centred, "the button opens the Mysteries window, centred");
  assert(A.gmStrip, "the GM sees the strip of uncollected Clues");
  assert(A.sidebarStill, "the click left the sidebar's tab and its expansion as they were");
  assert(!A.readColumn, "the party sheet has no Read column, button or bookmark");
  if (!A.active) throw new Error("module not active; enable it and restart the world");

  // --- B. the party and its record -------------------------------------------------------
  console.log("# B. the party");
  const B = await f.evaluate(
    ({ id, type }) => {
      const primary = game.settings.get("dnd5e", "primaryParty")?.actor ?? null;
      const group = primary ?? game.actors.find(a => a.type === "group");
      if (!group) return { error: "no group actor" };
      const entries = game.modules.get(id).api.entries(group);
      return {
        groupId: group.id,
        groupName: group.name,
        members: Array.from(group.system.members).map(m => ({ id: m.actor?.id, name: m.actor?.name })),
        schema: group.flags?.[id]?.schema ?? null,
        entries: entries.map(e => ({ name: e.snapshot.name, id: e.id, readers: Object.values(e.readers).map(r => r.actorName), foundAt: e.snapshot.foundAt, scene: e.foundIn.sceneName })),
        worldClues: game.items.filter(i => i.type === type).map(i => i.name),
        stashClues: group.items.filter(i => i.type === type || (i.type === "loot" && i.system.type?.value === "clue")).length,
        memberClues: Array.from(group.system.members).reduce((n, m) => n + (m.actor?.items.filter(i => i.type === type).length ?? 0), 0)
      };
    },
    { id: MODULE_ID, type: CLUE_TYPE }
  );
  if (B.error) throw new Error(B.error);
  groupId = B.groupId;
  console.log(`  group "${B.groupName}" (${B.groupId}); members: ${B.members.map(m => m.name).join(", ")}`);
  console.log(`  world Clues: ${B.worldClues.length} (${B.worldClues.join(", ")})`);
  for (const e of B.entries) console.log(`    entry: ${e.name}  readers=${e.readers.join(",")}  at="${e.foundAt.slice(0, 40)}"  scene=${e.scene}`);
  if (B.entries.length) assert(B.schema === 2, `the party's record carries its schema version (${B.schema})`);
  assert(B.stashClues === 0 && B.memberClues === 0, "no Clue sits in the stash or in a member's inventory");

  if (walk) {
    // --- C. a scratch Clue, collected three ways, never carried --------------------------
    console.log("# C. a scratch Clue is collected, never carried (GM page)");
    const swept = await f.evaluate(
      async ({ id, type, name }) => {
        const api = game.modules.get(id).api;
        const stale = game.items.filter(i => i.type === type && i.name === name);
        for (const item of stale) {
          for (const g of api.parties()) if (api.entry(g, item.id)) await api.uncollect(g, item.id, { confirm: false });
          await item.delete();
        }
        return stale.length;
      },
      { id: MODULE_ID, type: CLUE_TYPE, name: SCRATCH }
    );
    if (swept) console.log(`  swept ${swept} stale scratch Clue(s) from an aborted run`);
    const C = await f.evaluate(
      async ({ id, type, groupId, name, readerName }) => {
        const api = game.modules.get(id).api;
        const group = game.actors.get(groupId);
        const member = Array.from(group.system.members).map(m => m.actor).find(a => a?.name.startsWith(readerName));
        const clue = await Item.implementation.create({
          name,
          type,
          system: { kind: "document", text: "<p>A scrap for the <em>check</em>, nothing more.</p>", foundAt: "the check's desk" }
        });
        const wait = async pred => {
          for (let i = 0; i < 30; i++) {
            if (pred()) return true;
            await new Promise(r => setTimeout(r, 200));
          }
          return false;
        };
        const data = { type: "Item", uuid: clue.uuid };
        // 1. a drop on the party's sheet
        const allowed1 = Hooks.call("dropActorSheetData", group, group.sheet, data);
        const byPartyDrop = await wait(() => !!api.entry(group, clue.id));
        const entry1 = api.entry(group, clue.id);
        const partyCarries = group.items.some(i => i.type === type);
        // 2. a direct create on the group and on the member is refused
        let createdOnGroup = null;
        let createdOnMember = null;
        try {
          createdOnGroup = (await group.createEmbeddedDocuments("Item", [clue.toObject()])).length;
        } catch (err) {
          createdOnGroup = `threw: ${err.message}`;
        }
        try {
          createdOnMember = (await member.createEmbeddedDocuments("Item", [clue.toObject()])).length;
        } catch (err) {
          createdOnMember = `threw: ${err.message}`;
        }
        const memberCarries = member.items.some(i => i.type === type);
        // 3. taken out, then a drop on a member's sheet collects for their party
        await api.uncollect(group, clue.id, { confirm: false });
        const gone = await wait(() => !api.entry(group, clue.id));
        const allowed2 = Hooks.call("dropActorSheetData", member, member.sheet, data);
        const byMemberDrop = await wait(() => !!api.entry(group, clue.id));
        // 4. the strip lists it once it is out, and Collect puts it back
        await api.uncollect(group, clue.id, { confirm: false });
        await wait(() => !api.entry(group, clue.id));
        const win = api.openMysteries();
        await wait(() => win.rendered);
        await new Promise(r => setTimeout(r, 300));
        const inStrip = !!win.element.querySelector(`.clueboard-gm-strip [data-action="collect"][data-uuid="${clue.uuid}"]`);
        await win.close();
        await api.collect(clue, group, { how: "check" });
        const byCollect = !!api.entry(group, clue.id);
        // 5. Take back asks first: Keep it leaves the entry, Take it out removes it
        const dialogButton = async which => {
          for (let i = 0; i < 30; i++) {
            for (const app of foundry.applications.instances.values()) {
              if (!(app instanceof foundry.applications.api.DialogV2)) continue;
              const btn = app.element?.querySelector(`button[data-action="${which}"]`);
              if (btn) return btn;
            }
            await new Promise(r => setTimeout(r, 100));
          }
          // No dialog came: close whatever dialog there is so the awaited promise settles.
          for (const app of foundry.applications.instances.values()) {
            if (app instanceof foundry.applications.api.DialogV2) await app.close();
          }
          return null;
        };
        // The dialog is closed rather than clicked: closing is "Keep it" (it resolves false).
        const kept = api.uncollect(group, clue.id);
        const asked = !!(await dialogButton("no"));
        for (const app of foundry.applications.instances.values()) {
          if (app instanceof foundry.applications.api.DialogV2) await app.close();
        }
        const keptResult = await Promise.race([kept, new Promise(r => setTimeout(() => r("pending"), 3000))]);
        const stillThere = !!api.entry(group, clue.id);
        const takenResult = await api.uncollect(group, clue.id, { confirm: false });
        const nowGone = await wait(() => !api.entry(group, clue.id));
        await api.collect(clue, group, { how: "check" });
        return {
          asked,
          keptResult,
          stillThere,
          takenResult,
          nowGone,
          clueId: clue.id,
          allowed1,
          byPartyDrop,
          stamp: entry1 ? { scene: entry1.foundIn.sceneName, foundAt: entry1.snapshot.foundAt, kind: entry1.kind } : null,
          partyCarries,
          createdOnGroup,
          createdOnMember,
          memberCarries,
          gone,
          allowed2,
          byMemberDrop,
          inStrip,
          byCollect
        };
      },
      { id: MODULE_ID, type: CLUE_TYPE, groupId: B.groupId, name: SCRATCH, readerName }
    );
    scratchId = C.clueId;
    assert(C.allowed1 === false && C.byPartyDrop, "a Clue dropped on the party's sheet is collected, and the sheet is told no");
    assert(C.stamp?.scene && C.stamp.foundAt === "the check's desk" && C.stamp.kind === "document", `the entry is stamped (scene "${C.stamp?.scene}", at "${C.stamp?.foundAt}", ${C.stamp?.kind})`);
    assert(!C.partyCarries && !C.memberCarries, "no inventory holds the Clue");
    assert(C.createdOnGroup === 0 && C.createdOnMember === 0, `a direct create on the group and on a member makes nothing (${C.createdOnGroup}, ${C.createdOnMember})`);
    assert(C.gone, "Take back removes the entry (a forced deletion in the flags)");
    assert(C.allowed2 === false && C.byMemberDrop, "a Clue dropped on a member's sheet is collected for their party");
    assert(C.inStrip, "an uncollected Clue shows in the GM strip");
    assert(C.byCollect, "Collect puts it back");
    assert(C.asked && C.keptResult === false && C.stillThere, "Take back asks first, and Keep it leaves the entry");
    assert(C.takenResult === true && C.nowGone, "Take it out removes it");

    // --- D. a player opens it in Mysteries: the read is marked ----------------------------
    console.log(`# D. a player (${readerName}) opens it in Mysteries`);
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

    const D = await fp.evaluate(
      async ({ id, type, groupId, clueId }) => {
        const api = game.modules.get(id).api;
        const group = game.actors.get(groupId);
        const worldClue = game.items.get(clueId) ?? null;
        const win = api.openMysteries();
        for (let i = 0; i < 50 && !win.rendered; i++) await new Promise(r => setTimeout(r, 100));
        const strip = !!win.element.querySelector(".clueboard-gm-strip");
        const removes = win.element.querySelectorAll('[data-action="remove"]').length;
        const cardsBefore = win.element.querySelectorAll(".clueboard-card").length;
        const unreadBefore = win.element.querySelector(".clueboard-count")?.textContent?.trim() ?? null;
        const card = win.element.querySelector(`.clueboard-card[data-id="${clueId}"]`);
        const wasUnread = card?.classList.contains("unread") ?? null;
        card?.click();
        await new Promise(r => setTimeout(r, 800));
        const reader = [...foundry.applications.instances.values()].find(a => a.constructor.name === "Reader");
        const text = reader?.element?.querySelector(".clueboard-doc-text")?.textContent?.trim() ?? null;
        const stamp = !!reader?.element?.querySelector(".clueboard-stamp");
        await reader?.close();
        const entry = api.entry(group, clueId);
        await new Promise(r => setTimeout(r, 400));
        const nowUnread = win.element.querySelector(`.clueboard-card[data-id="${clueId}"]`)?.classList.contains("unread") ?? null;
        const unreadAfter = win.element.querySelector(".clueboard-count")?.textContent?.trim() ?? null;
        await win.close();
        return {
          ownsGroup: group.isOwner,
          seesWorldClue: !!worldClue && worldClue.testUserPermission(game.user, "LIMITED"),
          anyClueVisible: game.items.some(i => i.type === type && i.testUserPermission(game.user, "LIMITED")),
          strip,
          removes,
          cardsBefore,
          unreadBefore,
          wasUnread,
          text,
          stamp,
          readers: Object.values(entry?.readers ?? {}).map(r => r.actorName),
          nowUnread,
          unreadAfter
        };
      },
      { id: MODULE_ID, type: CLUE_TYPE, groupId: B.groupId, clueId: C.clueId }
    );
    assert(D.ownsGroup, "the player owns the group");
    assert(!D.seesWorldClue && !D.anyClueVisible, "the player sees no Clue item in the world");
    assert(!D.strip && D.removes === 0, "the player sees no GM strip and no Remove");
    assert(D.cardsBefore >= 1 && D.wasUnread === true, `the card is there and unread (${D.cardsBefore} cards; "${D.unreadBefore}")`);
    assert(D.text?.includes("A scrap for the check"), `opening it shows the text: "${D.text}"`);
    assert(D.stamp, "the Reader shows the stamp");
    assert(D.readers.includes(temp.readerName), `the read is marked for the reader (${D.readers.join(", ")})`);
    assert(D.nowUnread === false, `the card is read now ("${D.unreadAfter}")`);

    // the chat stayed quiet
    const chatAfter = await f.evaluate(() => game.messages.contents.slice(-2).map(m => m.flavor || m.content?.slice(0, 60)));
    console.log(`  last chat lines: ${JSON.stringify(chatAfter)}`);

    // --- E. the DM edits the Clue: the entry moves to revision 2 --------------------------
    console.log("# E. the DM edits the Clue (GM page)");
    const E = await f.evaluate(
      async ({ id, groupId, clueId }) => {
        const api = game.modules.get(id).api;
        const group = game.actors.get(groupId);
        const clue = game.items.get(clueId);
        await clue.update({ "system.text": "<p>A scrap for the check, <strong>revised</strong>.</p>" });
        for (let i = 0; i < 30 && (api.entry(group, clueId)?.snapshot.revision ?? 0) < 2; i++) await new Promise(r => setTimeout(r, 200));
        const e = api.entry(group, clueId);
        return { revision: e?.snapshot.revision, html: e?.snapshot.html ?? "", readers: Object.values(e?.readers ?? {}).length };
      },
      { id: MODULE_ID, groupId: B.groupId, clueId: C.clueId }
    );
    assert(E.revision === 2 && E.html.includes("revised"), `the entry's snapshot followed the edit (revision ${E.revision})`);
    assert(E.readers === 1, "the readers survived the re-snapshot");

    // --- G. threads: the party's own sorting ---------------------------------------------
    console.log("# G. threads (the player makes one, pins, orders; the GM deletes it)");
    const G1 = await fp.evaluate(
      async ({ id, groupId, clueId, name }) => {
        const api = game.modules.get(id).api;
        const group = game.actors.get(groupId);
        for (const th of api.threads(group).filter(th => th.name === name)) await api.removeThread(group, th.id, { confirm: false });
        const thread = await api.createThread(group, { name, question: "Is this a check?" });
        const other = api.entries(group).find(e => e.id !== clueId);
        await api.pin(group, clueId, thread.id);
        await api.pin(group, other.id, thread.id);
        const pinnedTwice = await api.pin(group, clueId, thread.id);
        const win = api.openMysteries();
        for (let i = 0; i < 50 && !win.rendered; i++) await new Promise(r => setTimeout(r, 100));
        win.showTab(group.id, thread.id);
        await new Promise(r => setTimeout(r, 500));
        const tabs = [...win.element.querySelectorAll(".clueboard-tab[data-tab]")].map(b => b.dataset.tab);
        const head = win.element.querySelector(".clueboard-thread-head h4")?.textContent?.trim() ?? null;
        const cardsBefore = [...win.element.querySelectorAll(".clueboard-card[data-id]")].map(c => c.dataset.id);
        await api.movePin(group, thread.id, other.id, clueId);
        await new Promise(r => setTimeout(r, 500));
        const cardsAfter = [...win.element.querySelectorAll(".clueboard-card[data-id]")].map(c => c.dataset.id);
        // A pin keeps the place: on All Clues, scrolled down and searching, pin a clue to the
        // thread; the view, the scroll and the search are what they were.
        await win.showTab(group.id, "all");
        win.setPosition({ height: 420 });
        await new Promise(r => setTimeout(r, 300));
        const main = () => win.element.querySelector(".clueboard-main");
        const input = win.element.querySelector("input[name=search]");
        input.value = "e";
        input.dispatchEvent(new Event("input"));
        main().scrollTop = 120;
        const scrollBefore = main().scrollTop;
        const third = api.entries(group).find(e => e.id !== clueId && e.id !== other.id);
        await api.pin(group, third.id, thread.id);
        await new Promise(r => setTimeout(r, 600));
        const keptView = win.element.querySelector(".clueboard-tab.active")?.dataset.tab === "all";
        const keptScroll = Math.abs(main().scrollTop - scrollBefore) < 4 && scrollBefore > 0;
        const keptSearch = win.element.querySelector("input[name=search]").value === "e";
        await api.unpin(group, third.id, thread.id);
        win.element.querySelector("input[name=search]").value = "";
        win.element.querySelector("input[name=search]").dispatchEvent(new Event("input"));
        win.setPosition({ height: 760 });
        // the unpin's redraw lands first; a click on a button it is about to replace goes nowhere
        await new Promise(r => setTimeout(r, 600));
        win.element.querySelector('.clueboard-tab[data-tab="unsorted"]')?.click();
        await new Promise(r => setTimeout(r, 500));
        const clickedToUnsorted = win.element.querySelector(".clueboard-tab.active")?.dataset.tab === "unsorted";
        const unsortedHasPinned = !!win.element.querySelector(`.clueboard-card[data-id="${clueId}"]`);
        await api.unpin(group, other.id, thread.id);
        const afterUnpin = Object.keys(api.entry(group, other.id).threads ?? {}).includes(thread.id);
        await win.close();
        return { threadId: thread.id, colour: thread.colour, pinnedTwice, tabs, head, cardsBefore, cardsAfter, clickedToUnsorted, unsortedHasPinned, afterUnpin, otherId: other.id, keptView, keptScroll, keptSearch, scrollBefore };
      },
      { id: MODULE_ID, groupId: B.groupId, clueId: C.clueId, name: THREAD }
    );
    assert(G1.threadId && G1.colour, `a player who owns the party made a thread (${G1.colour})`);
    assert(G1.tabs.includes("all") && G1.tabs.includes("unsorted") && G1.tabs.includes(G1.threadId), `the window shows All, Unsorted and the thread's tab (${G1.tabs.length} tabs)`);
    assert(G1.head === THREAD, `the thread's head shows its name ("${G1.head}")`);
    assert(G1.pinnedTwice && G1.cardsBefore.join() === [C.clueId, G1.otherId].join(), `two clues pinned, in pin order; a second pin is a no-op (${G1.cardsBefore.length} cards)`);
    assert(G1.cardsAfter.join() === [G1.otherId, C.clueId].join(), "a move before another card reorders the thread");
    assert(G1.keptView && G1.keptScroll && G1.keptSearch, `a pin keeps the view, the scroll (${G1.scrollBefore}px) and the search`);
    assert(G1.clickedToUnsorted, "a click on a tab switches the window to it");
    assert(!G1.unsortedHasPinned, "a pinned clue is not in Unsorted");
    assert(!G1.afterUnpin, "an unpin takes the clue off the thread");

    const G2 = await f.evaluate(
      async ({ id, groupId, clueId, threadId }) => {
        const api = game.modules.get(id).api;
        const group = api.parties().find(g => g.id === groupId);
        const before = api.threads(group).some(th => th.id === threadId);
        const removed = await api.removeThread(group, threadId, { confirm: false });
        const after = api.threads(group).some(th => th.id === threadId);
        const pinLeft = Object.keys(api.entry(group, clueId)?.threads ?? {}).includes(threadId);
        return { before, removed, after, pinLeft };
      },
      { id: MODULE_ID, groupId: B.groupId, clueId: C.clueId, threadId: G1.threadId }
    );
    assert(G2.before && G2.removed && !G2.after && !G2.pinLeft, "the GM deletes the thread and its pins go with it");
  }

  // --- H. the export -----------------------------------------------------------------------
  console.log("# H. the export (GM page, nothing written)");
  const H = await f.evaluate(
    ({ id, groupId }) => {
      const api = game.modules.get(id).api;
      const group = game.actors.get(groupId);
      const data = api.exportData(group);
      const entries = api.entries(group);
      const first = data.clues[0];
      return {
        format: data.format,
        party: data.party,
        clues: data.clues.length,
        entries: entries.length,
        mysteries: data.mysteries.length,
        threads: api.threads(group).length,
        firstKeys: first ? Object.keys(first) : [],
        firstPlain: first ? !/<[^>]+>/.test(first.text) && first.text.length > 0 : null,
        kindsLabelled: data.clues.every(c => /^[A-Z]/.test(c.kind)),
        json: (() => {
          try {
            return JSON.stringify(data).length > 0;
          } catch {
            return false;
          }
        })()
      };
    },
    { id: MODULE_ID, groupId }
  );
  assert(H.format === "fvtt-mod-clueboard/mysteries" && H.party, `the export names its format and the party (${H.party})`);
  assert(H.clues === H.entries && H.mysteries === H.threads, `the export carries every clue and mystery (${H.clues} clues, ${H.mysteries} mysteries)`);
  assert(["id", "name", "kind", "foundAt", "foundIn", "text", "html", "revision", "readBy", "note", "mysteries"].every(k => H.firstKeys.includes(k)), "a clue carries its name, kind, found-at, text, html, readers, note and mysteries");
  assert(H.firstPlain !== false && H.kindsLabelled && H.json, "the text is plain words, the kinds are labelled, the whole serialises");

  // --- F. screenshots, on the GM page ------------------------------------------------------
  if (shots) {
    console.log(`# F. screenshots into ${shots}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(shots, { recursive: true });
    await f.page.setViewportSize?.({ width: 1600, height: 1000 }).catch(() => {});
    await f.evaluate(async () => {
      document.getElementById("clueboard-mysteries-button")?.click();
      await new Promise(r => setTimeout(r, 900));
    });
    await f.page.screenshot({ path: `${shots}/1-mysteries.png` });
    await f.evaluate(
      async ({ id, groupId }) => {
        await foundry.applications.instances.get("clueboard-mysteries")?.close();
        const api = game.modules.get(id).api;
        const group = game.actors.get(groupId);
        const [first] = api.entries(group);
        if (first) await api.openReader({ group, id: first.id });
        await new Promise(r => setTimeout(r, 800));
      },
      { id: MODULE_ID, groupId }
    );
    await f.page.screenshot({ path: `${shots}/2-reader.png` });
    await f.evaluate(
      async ({ type, scratch }) => {
        for (const app of foundry.applications.instances.values()) if (app.constructor.name === "Reader") await app.close();
        const clue = game.items.find(i => i.type === type && i.name !== scratch) ?? game.items.find(i => i.type === type);
        await clue?.sheet.render({ force: true });
        await new Promise(r => setTimeout(r, 900));
      },
      { type: CLUE_TYPE, scratch: SCRATCH }
    );
    await f.page.screenshot({ path: `${shots}/3-clue-sheet.png` });
    await f.evaluate(async type => {
      for (const app of foundry.applications.instances.values()) if (app.document?.type === type) await app.close();
    }, CLUE_TYPE);
    console.log("  written: 1-mysteries.png, 2-reader.png, 3-clue-sheet.png");
  }
} finally {
  await cleanup();
}

// --- the console --------------------------------------------------------------------------
console.log("# console");
const ours = lines.filter(l => /clue ?board/i.test(l) && !/http 404/.test(l) && /error|pageerror/.test(l));
for (const l of lines.filter(l => !/http 404/.test(l)).slice(0, 40)) console.log(`  ${l}`);
assert(ours.length === 0, `no errors of the module's on either page (${ours.length})`);
console.log(fails ? `RED (${fails} failed)` : "GREEN");
process.exit(fails ? 1 : 0);
