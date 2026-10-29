/**
 * Mysteries: the party's record, and the window that shows it.
 *
 * Each party (a dnd5e Group actor) keeps its own record on the actor itself (store.js). A Clue
 * gets in by being collected: the DM drops it on the party, on a member, or on this window, or
 * presses Collect on its sheet or in the window's GM strip. A player's opening of an entry marks
 * the read; the reader's own client writes it, on a party the players own.
 */

import { log, MODULE_ID, t } from "./common.js";
import { CLUE_TYPE, defaultParty, isClue, partyFor, readerList, snapshotOf, sortAndFilter, unreadCount } from "./decide/clue.js";
import * as store from "./store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------------- */
/*  The party                                         */
/* -------------------------------------------------- */

export const { groups, findEntry, holdersOf, entriesOf, entryOf, primaryParty } = store;

/** A group's members, as actors (a member whose actor is gone is skipped). */
export const membersOf = group => Array.from(group?.system?.members ?? []).map(m => m.actor).filter(Boolean);

/** The parties as the pure decisions see them. */
const partyTable = () => groups().map(g => ({ id: g.id, memberIds: membersOf(g).map(m => m.id) }));

/** The party a Clue dropped on this actor goes to, or null when a pick is needed. */
export function partyOf(actor) {
  const id = partyFor({ id: actor.id, isGroup: actor.type === "group" }, partyTable(), primaryParty()?.id ?? null);
  return id ? game.actors.get(id) : null;
}

/** The parties the DM can collect into. */
export const partiesForCollect = () => groups();

/** The party when none is named: the primary, the only one, else the DM's pick (null if declined). */
export async function pickParty() {
  const id = defaultParty(partyTable(), primaryParty()?.id ?? null);
  if (id) return game.actors.get(id);
  const list = groups();
  if (!list.length) {
    ui.notifications.warn(t("collect.noParty"));
    return null;
  }
  const options = list.map(g => `<option value="${g.id}">${foundry.utils.escapeHTML(g.name)}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("collect.pickParty") },
    content: `<select name="party" autofocus>${options}</select>`,
    ok: { callback: (_ev, button) => button.form.elements.party.value },
    rejectClose: false
  });
  return picked ? (game.actors.get(picked) ?? null) : null;
}

/* -------------------------------------------------- */
/*  The stamp                                         */
/* -------------------------------------------------- */

/** Where and when: the scene the table is viewing, the calendar date, the clock. */
export function stampNow() {
  const scene = canvas?.scene ?? game.scenes.active ?? null;
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
/*  Collecting                                        */
/* -------------------------------------------------- */

/** The world's Clue items the party has no entry for. */
export const uncollectedFor = group => game.items.filter(i => isClue(i) && !entryOf(group, i.id));

/**
 * Put a Clue on a party's record. A compendium Clue is first imported into the world (the DM's
 * master copy), in a "Clues" folder. The DM's act; returns the entry, or null with a notice.
 * @param {Item} item
 * @param {Actor} group
 * @param {{ how?: string }} [options]  Where the collect came from, for the log.
 */
export async function collect(item, group, { how = "api" } = {}) {
  if (!isClue(item) || group?.type !== "group") return null;
  if (!game.user.isGM) {
    ui.notifications.warn(t("collect.gmOnly"));
    return null;
  }
  try {
    let source = item;
    if (item.pack || item.parent) {
      const folder = await cluesFolder();
      const data = item.toObject();
      delete data._id;
      source = await Item.implementation.create({ ...data, folder: folder?.id ?? null });
    }
    if (entryOf(group, source.id)) {
      ui.notifications.info(t("collect.already", { name: source.name, group: group.name }));
      return entryOf(group, source.id);
    }
    const snapshot = { ...snapshotOf(source), revision: 1 };
    await store.createEntry(group, {
      id: source.id,
      kind: snapshot.kind,
      source: { uuid: source.uuid, name: source.name },
      snapshot,
      foundIn: stampNow(),
      readers: {},
      notes: ""
    });
    const entry = entryOf(group, source.id);
    log.info(`collected "${source.name}" for ${group.name} (${how})`);
    ui.notifications.info(t("collect.done", { name: source.name, group: group.name }));
    Hooks.callAll("clueboard.collected", entry, group, source);
    return entry;
  } catch (err) {
    log.error("collecting failed", err);
    ui.notifications.error(t("collect.failed", { reason: err?.message ?? String(err) }));
    return null;
  }
}

/**
 * Take a Clue off a party's record, after the GM confirms: the readers and the note on it go
 * with it, and the item stays in the world. `confirm: false` is for scripts, never for a button.
 * Returns true when the entry was removed.
 */
export async function uncollect(group, id, { confirm = true } = {}) {
  if (!game.user.isGM) return false;
  const entry = entryOf(group, id);
  if (!entry) return false;
  if (confirm) {
    const readers = readerList(entry.readers).map(r => r.actorName);
    const detail = readers.length
      ? t("collect.confirmReaders", { readers: readers.join(", ") })
      : t("collect.confirmNoReaders");
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("collect.confirmTitle"), icon: "fa-solid fa-scroll" },
      content: `<p>${t("collect.confirm", { name: foundry.utils.escapeHTML(entry.snapshot.name), group: foundry.utils.escapeHTML(group.name) })}</p><p>${foundry.utils.escapeHTML(detail)}</p>`,
      yes: { label: t("collect.confirmYes"), icon: "fa-solid fa-xmark", default: false },
      no: { label: t("collect.confirmNo"), default: true },
      rejectClose: false
    });
    if (!ok) return false;
  }
  await store.removeEntry(group, id);
  ui.notifications.info(t("collect.removed", { name: entry.snapshot.name, group: group.name }));
  Hooks.callAll("clueboard.changed", null, "removed", entry, group);
  return true;
}

/** The folder imported Clues land in, made on first need (GM). */
async function cluesFolder() {
  let folder = game.folders.find(f => f.type === "Item" && f.getFlag(MODULE_ID, "folder") === true);
  if (!folder) {
    folder = await Folder.create({ name: t("collect.folder"), type: "Item", flags: { [MODULE_ID]: { folder: true } } });
  }
  return folder;
}

/** The DM's Clue changed: every party holding it shows what it reads now, with the revision. */
export async function refreshSnapshot(item) {
  for (const { group, entry } of holdersOf(item.id)) {
    const snapshot = { ...snapshotOf(item, { at: entry.snapshot.at }), revision: (entry.snapshot.revision ?? 1) + 1 };
    await store.setSnapshot(group, item.id, snapshot);
    Hooks.callAll("clueboard.changed", entryOf(group, item.id), "snapshot", snapshot, group);
  }
}

/* -------------------------------------------------- */
/*  Reading                                           */
/* -------------------------------------------------- */

/**
 * The character a player's read is recorded for: the user's own, when it is in the party; else
 * the one member they own; else their pick among several; else null.
 */
export async function pickReader(group, { ask = true } = {}) {
  const members = membersOf(group);
  const own = game.user.character;
  if (own && members.includes(own)) return own;
  const owned = members.filter(m => m.isOwner);
  if (owned.length === 1) return owned[0];
  if (!owned.length || !ask) return null;
  const options = owned.map(m => `<option value="${m.id}">${foundry.utils.escapeHTML(m.name)}</option>`).join("");
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("read.pickReader") },
    content: `<p>${t("read.pickReaderHint")}</p><select name="reader" autofocus>${options}</select>`,
    ok: { callback: (_ev, button) => button.form.elements.reader.value },
    rejectClose: false
  });
  return picked ? (game.actors.get(picked) ?? null) : null;
}

/**
 * A player opened an entry: the read is marked for their character, once. A GM's opening marks
 * nothing. Returns the entry as it stands.
 */
export async function markRead(group, id) {
  const entry = entryOf(group, id);
  if (!entry || game.user.isGM) return entry;
  if (!group.isOwner) {
    ui.notifications.warn(t("read.notOwner", { group: group.name }));
    return entry;
  }
  const reader = await pickReader(group);
  if (!reader) {
    ui.notifications.warn(t("read.noReader"));
    return entry;
  }
  if (entry.readers?.[reader.id]) return entry;
  try {
    await store.addReader(group, id, { actorId: reader.id, actorName: reader.name, userId: game.user.id, at: new Date().toISOString() });
    ui.notifications.info(t("read.marked", { name: entry.snapshot.name, reader: reader.name }));
    Hooks.callAll("clueboard.changed", entryOf(group, id), "reader", reader, group);
  } catch (err) {
    log.error("marking the read failed", err);
    ui.notifications.error(t("read.failed", { reason: err?.message ?? String(err) }));
  }
  return entryOf(group, id);
}

/* -------------------------------------------------- */
/*  What the window shows                             */
/* -------------------------------------------------- */

/**
 * An entry's text as plain words, for the card and the search. Plain text, not HTML: the
 * template escapes it once. A block's end and a line break become a space; an inline tag
 * becomes nothing. The browser's own parser decodes the entities; nothing is rendered or run.
 */
const plainText = html => {
  const spaced = String(html ?? "").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|blockquote|tr|td|th)>/gi, " ");
  const text = new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
};

const excerpt = html => plainText(html).slice(0, 180);

/** The character this user's reads count for, without asking: null for a GM or a user with none. */
export function myReader(group) {
  if (game.user.isGM) return null;
  const members = membersOf(group);
  const own = game.user.character;
  if (own && members.includes(own)) return own;
  const owned = members.filter(m => m.isOwner);
  return owned.length === 1 ? owned[0] : null;
}

/** One party's section of the window: its entries as cards, and its count of the unread. */
export function sectionFor(group, query = "") {
  const all = entriesOf(group);
  const me = myReader(group);
  const entries = sortAndFilter(all, query).map(e => ({
    group: group.id,
    id: e.id,
    name: e.snapshot.name,
    img: e.snapshot.img,
    excerpt: excerpt(e.snapshot.html),
    foundAt: e.snapshot.foundAt,
    foundIn: e.foundIn.sceneName,
    calendarDate: e.foundIn.calendarDate,
    readers: readerList(e.readers).map(r => ({ name: r.actorName, me: me ? r.actorId === me.id : false })),
    unread: me ? !e.readers?.[me.id] : !Object.keys(e.readers ?? {}).length,
    notes: e.notes,
    search: `${e.snapshot.name} ${plainText(e.snapshot.html)} ${e.snapshot.foundAt} ${e.notes}`.toLowerCase()
  }));
  const unread = unreadCount(all, me?.id ?? null);
  return {
    id: group.id,
    name: group.name,
    entries,
    total: all.length,
    unread,
    unreadText: me ? t("mysteries.unreadMine", { count: unread }) : t("mysteries.unreadAnyone", { count: unread })
  };
}

/* -------------------------------------------------- */
/*  The window                                        */
/* -------------------------------------------------- */

/**
 * Mysteries is a window of its own, opened centred from the sidebar's scroll button (clueboard.js)
 * or the API. Never a sidebar panel: a tab's content lives inside the sidebar's layout, and a
 * panel of cards there left the sidebar stuck. One window per client, reused. For the GM it is
 * also the place to collect: a strip of the world's uncollected Clues, and a drop target.
 */
export class MysteriesWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "clueboard-mysteries",
    classes: ["clueboard-mysteries"],
    window: { title: `${MODULE_ID}.mysteries.title`, icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      open: MysteriesWindow.#onOpen,
      collect: MysteriesWindow.#onCollect,
      remove: MysteriesWindow.#onRemove,
      openItem: MysteriesWindow.#onOpenItem
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

  /** Re-render when open: a party's record or the world's Clues changed. The search survives. */
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
    context.isGM = game.user.isGM;
    if (context.isGM) {
      // The strip: every world Clue no party has. With several parties, Collect asks which.
      const held = new Set(list.flatMap(g => entriesOf(g).map(e => e.id)));
      context.uncollected = game.items
        .filter(i => isClue(i) && !held.has(i.id))
        .map(i => ({ id: i.id, uuid: i.uuid, name: i.name, img: i.img }))
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    }
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    input?.addEventListener("input", ev => this.#filter(ev.currentTarget.value));
    if (this.#query) this.#filter(this.#query);
    if (game.user.isGM) {
      const el = this.element;
      el.addEventListener("dragover", ev => {
        if (!this.#draggedClue(ev)) return;
        ev.preventDefault();
        el.classList.add("clueboard-drop-ok");
      });
      el.addEventListener("dragleave", ev => {
        if (!el.contains(ev.relatedTarget)) el.classList.remove("clueboard-drop-ok");
      });
      el.addEventListener("drop", ev => {
        el.classList.remove("clueboard-drop-ok");
        const uuid = this.#draggedClue(ev);
        if (!uuid) return;
        ev.preventDefault();
        void this.#dropped(uuid);
      });
    }
  }

  /** The uuid of a Clue being dragged over the window, or null. */
  #draggedClue(ev) {
    try {
      const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      const data = TextEditor.getDragEventData(ev);
      if (data?.type !== "Item" || !data.uuid) return null;
      const doc = fromUuidSync(data.uuid);
      return doc?.type === CLUE_TYPE ? data.uuid : null;
    } catch {
      return null;
    }
  }

  async #dropped(uuid) {
    const item = await fromUuid(uuid);
    const group = await pickParty();
    if (item && group) await collect(item, group, { how: "window" });
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

  static async #onCollect(_event, target) {
    const item = await fromUuid(target.dataset.uuid);
    const group = await pickParty();
    if (item && group) await collect(item, group, { how: "strip" });
  }

  static async #onRemove(event, target) {
    event.stopPropagation();
    const group = game.actors.get(target.dataset.group);
    if (group) await uncollect(group, target.dataset.id);
  }

  static async #onOpenItem(event, target) {
    event.stopPropagation();
    const item = await fromUuid(target.dataset.uuid);
    item?.sheet?.render(true);
  }
}

/** The Reader on an entry (the import is lazy: reader.js imports this module). */
async function openReaderFor(group, id) {
  const { openReader } = await import("./reader.js");
  return openReader({ group, id });
}
