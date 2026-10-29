/**
 * Mysteries: the party's record, and the window that shows it.
 *
 * Each party (a dnd5e Group actor) keeps its own record on the actor itself (store.js): no
 * journal, no folder, nothing in a directory. The reader's own client writes the read it made,
 * on a party the players own; the client that moved an item writes the holder it moved to.
 */

import { log, MODULE_ID, setting, t } from "./common.js";
import { clueId, countUngathered, isClue, readerList, resolveHolder, snapshotOf, sortAndFilter } from "./decide/clue.js";
import * as store from "./store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------------- */
/*  The party                                         */
/* -------------------------------------------------- */

export const { groups, findEntry, entriesOf, entryOf } = store;

/** A group's members, as actors (a member whose actor is gone is skipped). */
export const membersOf = group => Array.from(group?.system?.members ?? []).map(m => m.actor).filter(Boolean);

/** The group and its members: every actor a clue can be carried by. */
export const partyActorsOf = group => [group, ...membersOf(group)];

/** A stash row Party Stash is handing to another player: not a carrier until it lands. */
export const isHandOffRow = item => Boolean(item?.flags?.["fvtt-mod-partystash"]?.giveTo);

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
 * has none, makes the entry if the party's record has none for the id, and adds the reader.
 * Returns the entry, or null with a notice when nothing could be recorded.
 * @param {Item} item   A Clue in a Group actor's inventory.
 * @param {Actor} group The group.
 */
export async function gather(item, group) {
  if (!isClue(item) || item.parent !== group || group?.type !== "group") return null;
  if (game.user.isGM) return entryOf(group, clueId(item, MODULE_ID));
  if (!group.isOwner) {
    ui.notifications.warn(t("read.notOwner", { group: group.name }));
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
    const existing = entryOf(group, id);
    if (!existing) {
      const snapshot = { ...snapshotOf(item, { identified: game.user.isGM, at: now }), revision: 1 };
      await store.createEntry(group, {
        id,
        source: { uuid: item.uuid, name: item.name },
        snapshot,
        foundIn: stampNow(reader),
        readers: { [reader.id]: readerRecord },
        holder: { actorId: group.id, actorName: group.name, left: false, lastHolder: "", at: now },
        notes: ""
      });
      const entry = entryOf(group, id);
      ui.notifications.info(t("read.gathered", { name: snapshot.name, reader: reader.name }));
      Hooks.callAll("clueboard.gathered", entry, reader, item, group);
      return entry;
    }
    if (!existing.readers?.[reader.id]) {
      await store.addReader(group, id, readerRecord);
      ui.notifications.info(t("read.readAgain", { name: existing.snapshot.name, reader: reader.name }));
      Hooks.callAll("clueboard.changed", entryOf(group, id), "reader", reader, group);
    }
    return entryOf(group, id);
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
 * just deleted from, named when nobody carries the clue any more. A client that does not own
 * the party leaves the write to the next one that does (the holder is recomputed whole).
 */
export async function followHolder(id, lastParent = null) {
  const found = findEntry(id);
  if (!found) return;
  const { group, entry } = found;
  if (!group.isOwner) {
    log.debug?.(`not the party's owner: the holder of ${id} waits for the next owner's move`);
    return;
  }
  const was = entry.holder;
  const now = resolveHolder(carriersOf(id), lastParent ? { actorId: lastParent.id, actorName: lastParent.name } : was);
  const same = now.left ? was.left && was.lastHolder === now.lastHolder : !was.left && was.actorId === now.actorId;
  if (same) return;
  const at = new Date().toISOString();
  await store.setHolder(
    group,
    id,
    now.left
      ? { actorId: "", actorName: "", left: true, lastHolder: now.lastHolder, at }
      : { actorId: now.actorId, actorName: now.actorName, left: false, lastHolder: "", at }
  );
  Hooks.callAll("clueboard.changed", entryOf(group, id), "holder", now, group);
}

/** The item's text changed while the party holds it: the entry shows what it reads now. */
export async function refreshSnapshot(id, item) {
  const found = findEntry(id);
  if (!found || found.entry.holder.left || !found.group.isOwner) return;
  const { group, entry } = found;
  const snapshot = {
    ...snapshotOf(item, { identified: true, at: entry.snapshot.at || new Date().toISOString() }),
    revision: (entry.snapshot.revision ?? 1) + 1
  };
  await store.setSnapshot(group, id, snapshot);
  Hooks.callAll("clueboard.changed", entryOf(group, id), "snapshot", snapshot, group);
}

/* -------------------------------------------------- */
/*  What the window shows                             */
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

/** One party's section of the window: its entries as cards, and its count of the unread. */
export function sectionFor(group, query = "") {
  const all = entriesOf(group);
  const entries = sortAndFilter(all, query).map(e => ({
    group: group.id,
    id: e.id,
    name: e.snapshot.name,
    img: e.snapshot.img,
    excerpt: excerpt(e.snapshot.html),
    foundIn: e.foundIn.sceneName,
    calendarDate: e.foundIn.calendarDate,
    readers: readerList(e.readers).map(r => r.actorName),
    holder: holderText(e.holder),
    left: e.holder.left,
    notes: e.notes,
    search: `${e.snapshot.name} ${excerpt(e.snapshot.html)} ${e.notes}`.toLowerCase()
  }));
  let ungathered = 0;
  if (setting("countUngathered")) {
    const gathered = new Set(all.map(e => e.id));
    const clues = partyActorsOf(group).flatMap(a => a.items.filter(isClue).map(i => ({ id: clueId(i, MODULE_ID) })));
    ungathered = countUngathered(clues, gathered);
  }
  return {
    id: group.id,
    name: group.name,
    entries,
    total: all.length,
    ungathered,
    ungatheredText: ungathered === 1 ? t("mysteries.ungatheredOne") : t("mysteries.ungathered", { count: ungathered })
  };
}

/* -------------------------------------------------- */
/*  The window                                        */
/* -------------------------------------------------- */

/**
 * Mysteries is a window of its own, opened centred from the sidebar's scroll button (clueboard.js)
 * or the API. Never a sidebar panel: a tab's content lives inside the sidebar's layout, and a
 * panel of cards there left the sidebar stuck. One window per client, reused.
 */
export class MysteriesWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "clueboard-mysteries",
    classes: ["clueboard-mysteries"],
    window: { title: `${MODULE_ID}.mysteries.title`, icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      open: MysteriesWindow.#onOpen
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/mysteries.hbs`,
      scrollable: [".clueboard-entries"]
    }
  };

  /** The one open window, so the button and the API reuse it. */
  static current = null;

  /** Open the window centred, or bring it to the front when it is already open. */
  static open() {
    MysteriesWindow.current ??= new MysteriesWindow();
    const app = MysteriesWindow.current;
    if (app.rendered) {
      app.bringToFront();
      return app;
    }
    app.render({ force: true });
    return app;
  }

  /** Re-render when open: a party's record changed. The search survives the render. */
  static refresh() {
    const app = MysteriesWindow.current;
    if (app?.rendered) app.render();
  }

  #query = "";

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = groups().filter(g => g.testUserPermission(game.user, "OBSERVER"));
    context.sections = list.map(g => sectionFor(g));
    context.several = context.sections.length > 1;
    context.none = !context.sections.length;
    context.empty = context.sections.every(s => !s.entries.length);
    context.query = this.#query;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    input?.addEventListener("input", ev => this.#filter(ev.currentTarget.value));
    if (this.#query) this.#filter(this.#query);
  }

  #filter(query) {
    this.#query = query;
    const q = query.trim().toLowerCase();
    for (const card of this.element.querySelectorAll("[data-search]")) {
      card.hidden = Boolean(q) && !card.dataset.search.includes(q);
    }
  }

  static async #onOpen(_event, target) {
    const group = game.actors.get(target.dataset.group);
    if (group) await openReaderFor(group, target.dataset.id);
  }
}

/** The Reader on an entry (the import is lazy: reader.js imports this module). */
async function openReaderFor(group, id) {
  const { openReader } = await import("./reader.js");
  return openReader({ group, id });
}
