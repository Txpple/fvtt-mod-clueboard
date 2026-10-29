/**
 * Mysteries: the party's record, and the sidebar tab that shows it.
 *
 * One JournalEntry per party (a dnd5e Group actor), in a "Clue Board" folder, default ownership
 * Owner for every player, made by the elect (players cannot create journals). Each gathered Clue
 * is a page of the module's type (clue-page.js). The reader's own client writes the page it
 * gathered; the client that moved an item writes the holder it moved to.
 */

import { log, MODULE_ID, setting, t } from "./common.js";
import { clueId, countUngathered, isClue, PAGE_TYPE, resolveHolder, snapshotOf, sortAndFilter } from "./decide/clue.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const AbstractSidebarTab = foundry.applications.sidebar.AbstractSidebarTab;

/* -------------------------------------------------- */
/*  The party                                         */
/* -------------------------------------------------- */

/** Every Group actor in the world: each is a party with a stash. */
export const groups = () => game.actors.filter(a => a.type === "group");

/** A group's members, as actors (a member whose actor is gone is skipped). */
export const membersOf = group => Array.from(group?.system?.members ?? []).map(m => m.actor).filter(Boolean);

/** The group and its members: every actor a clue can be carried by. */
export const partyActorsOf = group => [group, ...membersOf(group)];

/** A stash row Party Stash is handing to another player: not a carrier until it lands. */
export const isHandOffRow = item => Boolean(item?.flags?.["fvtt-mod-partystash"]?.giveTo);

/* -------------------------------------------------- */
/*  The journals                                      */
/* -------------------------------------------------- */

/** The party's Mysteries journal, or null until the elect has made it. */
export function journalFor(group) {
  return game.journal.find(j => j.getFlag(MODULE_ID, "group") === group?.id) ?? null;
}

/** Every Mysteries journal, each with its group (a group may be gone; the journal stays). */
export function journals() {
  return game.journal.filter(j => j.getFlag(MODULE_ID, "mysteries") === true);
}

/** The pages of a journal that are Clue entries. */
export const entriesOf = journal => journal.pages.filter(p => p.type === PAGE_TYPE);

/** The entry carrying a clue id, in any Mysteries journal. */
export function entryFor(id) {
  for (const j of journals()) {
    const page = j.pages.find(p => p.type === PAGE_TYPE && p.system.id === id);
    if (page) return page;
  }
  return null;
}

/**
 * The elect's one chore: a folder, and a journal per party that lacks one. GM only; a player
 * calling it is a no-op.
 */
export async function ensureJournals() {
  if (!game.user.isGM) return;
  let folder = game.folders.find(f => f.type === "JournalEntry" && f.getFlag(MODULE_ID, "folder") === true);
  const missing = groups().filter(g => !journalFor(g));
  if (!missing.length) return;
  if (!folder) {
    folder = await Folder.create({
      name: t("mysteries.folder"),
      type: "JournalEntry",
      flags: { [MODULE_ID]: { folder: true } }
    });
  }
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  await JournalEntry.createDocuments(
    missing.map(g => ({
      name: t("mysteries.journalName", { group: g.name }),
      folder: folder.id,
      ownership: { default: OWNER },
      flags: { [MODULE_ID]: { mysteries: true, group: g.id } }
    }))
  );
  log.info(`made ${missing.length} Mysteries journal(s): ${missing.map(g => g.name).join(", ")}`);
}

/* -------------------------------------------------- */
/*  The stamp                                         */
/* -------------------------------------------------- */

/** Where and when: the scene the reader's token stands on (else the viewed one), the calendar, the clock. */
export function stampNow(reader) {
  // The viewed scene when the reader's token stands on it, else the active one if it does,
  // else any scene that has the token, else the viewed scene: a party with tokens on several
  // scenes is stamped where the table is looking.
  const has = s => Boolean(s && reader && s.tokens.some(tk => tk.actorId === reader.id));
  const scene =
    [canvas?.scene, game.scenes.active].find(has) ??
    game.scenes.find(has) ??
    canvas?.scene ??
    game.scenes.active ??
    null;
  let calendarDate = "";
  try {
    // Foundry's stock calendar is the Simplified Gregorian counting from year 0: a world that
    // never chose a calendar would stamp "0000-01-01", which says nothing. Only a chosen one.
    const cal = game.time?.calendar;
    const stock = CONFIG.time?.worldCalendarConfig?.name === "Simplified Gregorian";
    if (cal && !stock) calendarDate = String(cal.format(game.time.worldTime, "timestamp"));
  } catch (err) {
    log.debug?.("no calendar date for the stamp", err);
  }
  return {
    sceneId: scene?.id ?? "",
    sceneName: scene?.name ?? "",
    calendarDate,
    realDate: new Date().toISOString()
  };
}

/* -------------------------------------------------- */
/*  Who is reading                                    */
/* -------------------------------------------------- */

/**
 * The character the read is recorded for: the user's own, when it is in the party; else the one
 * member they own; else their pick among several; else null.
 */
export async function pickReader(group) {
  const members = membersOf(group);
  const own = game.user.character;
  if (own && members.includes(own)) return own;
  const owned = members.filter(m => m.isOwner);
  if (owned.length === 1) return owned[0];
  if (!owned.length) return null;
  const options = owned.map(m => `<option value="${m.id}">${foundry.utils.escapeHTML(m.name)}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("read.pickReader") },
    content: `<p>${t("read.pickReaderHint")}</p><select name="reader" autofocus>${options}</select>`,
    ok: { callback: (_ev, button) => button.form.elements.reader.value },
    rejectClose: false
  });
  return picked ? (game.actors.get(picked) ?? null) : null;
}

/* -------------------------------------------------- */
/*  Gather on read                                    */
/* -------------------------------------------------- */

/**
 * The one trigger: a player reading a Clue in the party stash. Writes the id flag if the item
 * has none, makes the entry if none carries the id, and appends the reader. Returns the entry,
 * or null with a notice when nothing could be recorded.
 * @param {Item} item   A Clue in a Group actor's inventory.
 * @param {Actor} group The group.
 */
export async function gather(item, group) {
  if (!isClue(item) || item.parent !== group || group?.type !== "group") return null;
  if (game.user.isGM) return entryFor(clueId(item, MODULE_ID)) ?? null;
  const journal = journalFor(group);
  if (!journal) {
    ui.notifications.warn(t("read.noJournal"));
    return null;
  }
  const reader = await pickReader(group);
  if (!reader) {
    ui.notifications.warn(t("read.noReader"));
    return null;
  }
  try {
    let id = clueId(item, MODULE_ID);
    if (!id) {
      id = foundry.utils.randomID();
      await item.setFlag(MODULE_ID, "id", id);
    }
    const now = new Date().toISOString();
    const readerRecord = { actorId: reader.id, actorName: reader.name, userId: game.user.id, at: now };
    let page = journal.pages.find(p => p.type === PAGE_TYPE && p.system.id === id);
    if (!page) {
      const snapshot = { ...snapshotOf(item, { identified: game.user.isGM, at: now }), revision: 1 };
      [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [
        {
          name: snapshot.name,
          type: PAGE_TYPE,
          title: { show: true, level: 1 },
          system: {
            id,
            source: { uuid: item.uuid, name: item.name },
            snapshot,
            foundIn: stampNow(reader),
            readers: [readerRecord],
            holder: { actorId: group.id, actorName: group.name, left: false, lastHolder: "", at: now }
          }
        }
      ]);
      ui.notifications.info(t("read.gathered", { name: snapshot.name, reader: reader.name }));
      Hooks.callAll("clueboard.gathered", page, reader, item);
    } else if (!page.system.readers.some(r => r.actorId === reader.id)) {
      await page.update({ "system.readers": [...page.system.readers, readerRecord] });
      ui.notifications.info(t("read.readAgain", { name: page.name, reader: reader.name }));
      Hooks.callAll("clueboard.changed", page, "reader", reader);
    }
    return page;
  } catch (err) {
    log.error("gathering failed", err);
    ui.notifications.error(t("read.failed", { reason: err?.message ?? String(err) }));
    return null;
  }
}

/* -------------------------------------------------- */
/*  The holder follows the item                       */
/* -------------------------------------------------- */

/** Every party actor carrying an item with this clue id. */
export function carriersOf(id) {
  const out = [];
  for (const g of groups()) {
    for (const actor of partyActorsOf(g)) {
      const carries = actor.items.some(i => isClue(i) && clueId(i, MODULE_ID) === id && !isHandOffRow(i));
      if (carries) out.push({ actorId: actor.id, actorName: actor.name, isGroup: actor.type === "group" });
    }
  }
  return out;
}

/**
 * Write the entry's holder from where the item is now. `lastParent` is the actor an item was
 * just deleted from, named when nobody carries the clue any more.
 */
export async function followHolder(id, lastParent = null) {
  const page = entryFor(id);
  if (!page) return;
  const was = page.system.holder;
  const now = resolveHolder(carriersOf(id), lastParent ? { actorId: lastParent.id, actorName: lastParent.name } : was);
  const same = now.left ? was.left && was.lastHolder === now.lastHolder : !was.left && was.actorId === now.actorId;
  if (same) return;
  await page.update({
    "system.holder": now.left
      ? { actorId: "", actorName: "", left: true, lastHolder: now.lastHolder, at: new Date().toISOString() }
      : { actorId: now.actorId, actorName: now.actorName, left: false, lastHolder: "", at: new Date().toISOString() }
  });
  Hooks.callAll("clueboard.changed", page, "holder", now);
}

/** The item's text changed while the party holds it: the entry shows what it reads now. */
export async function refreshSnapshot(id, item) {
  const page = entryFor(id);
  if (!page || page.system.holder.left) return;
  const snapshot = {
    ...snapshotOf(item, { identified: true, at: new Date().toISOString() }),
    revision: (page.system.snapshot.revision ?? 1) + 1
  };
  await page.update({ name: snapshot.name, "system.snapshot": snapshot });
  Hooks.callAll("clueboard.changed", page, "snapshot", snapshot);
}

/* -------------------------------------------------- */
/*  What the tab shows                                */
/* -------------------------------------------------- */

/** The text a holder reads as. */
export function holderText(holder) {
  if (!holder) return "";
  if (holder.left) return holder.lastHolder ? `${t("mysteries.left")} · ${holder.lastHolder}` : t("mysteries.left");
  const actor = game.actors.get(holder.actorId);
  if (actor?.type === "group") return t("mysteries.stash");
  return holder.actorName;
}

const excerpt = html =>
  foundry.utils
    .escapeHTML(String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 180);

/** One journal's section of the tab: its entries as cards, and its count of the unread. */
export function sectionFor(journal, query = "") {
  const group = game.actors.get(journal.getFlag(MODULE_ID, "group"));
  const pages = entriesOf(journal);
  const entries = sortAndFilter(pages, query).map(p => ({
    uuid: p.uuid,
    name: p.name,
    img: p.system.snapshot.img,
    excerpt: excerpt(p.system.snapshot.html),
    foundIn: p.system.foundIn.sceneName,
    calendarDate: p.system.foundIn.calendarDate,
    readers: p.system.readers.map(r => r.actorName),
    holder: holderText(p.system.holder),
    left: p.system.holder.left,
    notes: p.system.notes,
    search: `${p.name} ${excerpt(p.system.snapshot.html)} ${p.system.notes}`.toLowerCase()
  }));
  let ungathered = 0;
  if (group && setting("countUngathered")) {
    const gathered = new Set(pages.map(p => p.system.id));
    const clues = partyActorsOf(group).flatMap(a => a.items.filter(isClue).map(i => ({ id: clueId(i, MODULE_ID) })));
    ungathered = countUngathered(clues, gathered);
  }
  return {
    id: journal.id,
    uuid: journal.uuid,
    name: group?.name ?? journal.name,
    entries,
    total: pages.length,
    ungathered,
    ungatheredText: ungathered === 1 ? t("mysteries.ungatheredOne") : t("mysteries.ungathered", { count: ungathered })
  };
}

/* -------------------------------------------------- */
/*  The sidebar tab                                   */
/* -------------------------------------------------- */

export class MysteriesTab extends HandlebarsApplicationMixin(AbstractSidebarTab) {
  static tabName = "mysteries";

  static DEFAULT_OPTIONS = {
    classes: ["clueboard-mysteries"],
    window: { title: `${MODULE_ID}.mysteries.title` },
    actions: {
      open: MysteriesTab.#onOpen,
      popout: MysteriesTab.#onPopout,
      openJournal: MysteriesTab.#onOpenJournal
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/mysteries-tab.hbs`,
      scrollable: [".clueboard-entries"]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = journals().filter(j => j.testUserPermission(game.user, "OBSERVER"));
    context.sections = list.map(j => sectionFor(j));
    context.several = context.sections.length > 1;
    context.none = !context.sections.length;
    context.empty = context.sections.every(s => !s.entries.length);
    context.isPopout = this.isPopout;
    context.isGM = game.user.isGM;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    input?.addEventListener("input", ev => this.#filter(ev.currentTarget.value));
  }

  #filter(query) {
    const q = query.trim().toLowerCase();
    for (const card of this.element.querySelectorAll("[data-search]")) {
      card.hidden = Boolean(q) && !card.dataset.search.includes(q);
    }
  }

  static async #onOpen(_event, target) {
    const page = await fromUuid(target.dataset.uuid);
    if (page) await openReaderFor(page);
  }

  static #onPopout() {
    this.renderPopout();
  }

  static async #onOpenJournal(_event, target) {
    const journal = await fromUuid(target.dataset.uuid);
    journal?.sheet?.render(true);
  }
}

/** The Reader on an entry (the import is lazy: reader.js imports this module). */
async function openReaderFor(page) {
  const { openReader } = await import("./reader.js");
  return openReader({ page });
}
