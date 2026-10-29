/**
 * Mysteries: the party's record, and the window that shows it.
 *
 * Each party (a dnd5e Group actor) keeps its own record on the actor itself (store.js). A Clue
 * gets in by being collected: the DM drops it on the party, on a member, or on this window, or
 * presses Collect on its sheet or in the window's GM strip. A player's opening of an entry marks
 * the read; the reader's own client writes it, on a party the players own.
 */

import { log, MODULE_ID, t } from "./common.js";
import {
  CLUE_TYPE,
  defaultParty,
  isClue,
  nextColour,
  partyFor,
  pinnedTo,
  readerList,
  reorder,
  snapshotOf,
  sortAndFilter,
  THREAD_COLOURS,
  unreadCount,
  unsorted
} from "./decide/clue.js";
import * as store from "./store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------------- */
/*  The party                                         */
/* -------------------------------------------------- */

export const { groups, findEntry, holdersOf, entriesOf, entryOf, primaryParty, threadsOf, threadOf } = store;

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
      window: { title: t("collect.confirmTitle"), icon: "fa-solid fa-user-secret" },
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
/*  Threads: the party's own sorting                  */
/* -------------------------------------------------- */

/** Whether this user may organise a party's Mysteries: its owners, which the players are. */
export function mayOrganise(group, { tell = true } = {}) {
  if (group?.isOwner) return true;
  if (tell) ui.notifications.warn(t("mysteries.notOwner", { group: group?.name ?? "" }));
  return false;
}

/** The thread dialog's form: name, question, colour. Returns the values, or null. */
async function threadForm(title, thread = null) {
  const esc = foundry.utils.escapeHTML;
  const colours = THREAD_COLOURS.map(
    c => `<option value="${c}" ${thread?.colour === c ? "selected" : ""}>${esc(t(`mysteries.colours.${c}`))}</option>`
  ).join("");
  const content = `
    <p class="hint">${esc(t("mysteries.newThreadHint"))}</p>
    <div class="form-group"><label>${esc(t("mysteries.threadName"))}</label><div class="form-fields"><input type="text" name="name" value="${esc(thread?.name ?? "")}" autofocus required></div></div>
    <div class="form-group"><label>${esc(t("mysteries.threadQuestion"))}</label><div class="form-fields"><input type="text" name="question" value="${esc(thread?.question ?? "")}"></div></div>
    ${thread ? `<div class="form-group"><label>${esc(t("mysteries.threadColour"))}</label><div class="form-fields"><select name="colour">${colours}</select></div></div>` : ""}`;
  const values = await foundry.applications.api.DialogV2.prompt({
    window: { title, icon: "fa-solid fa-user-secret" },
    content,
    ok: {
      callback: (_ev, button) => {
        const f = button.form.elements;
        return { name: f.name.value.trim(), question: f.question.value.trim(), colour: f.colour?.value };
      }
    },
    rejectClose: false
  });
  return values?.name ? values : null;
}

/** A new thread, asked for in a dialog; the colour is the least used. Returns it, or null. */
export async function createThread(group, given = null) {
  if (!mayOrganise(group)) return null;
  const values = given ?? (await threadForm(t("mysteries.newThread")));
  if (!values?.name) return null;
  const threads = threadsOf(group);
  const thread = {
    id: foundry.utils.randomID(),
    name: values.name,
    colour: values.colour && THREAD_COLOURS.includes(values.colour) ? values.colour : nextColour(threads),
    question: values.question ?? "",
    status: "open",
    stand: "",
    order: (threads.at(-1)?.order ?? -1) + 1,
    at: new Date().toISOString(),
    by: game.user.id
  };
  await store.createThread(group, thread);
  Hooks.callAll("clueboard.thread", threadOf(group, thread.id), "created", group);
  return threadOf(group, thread.id);
}

/** The thread's name, question and colour, edited in a dialog. */
export async function editThread(group, id) {
  if (!mayOrganise(group)) return null;
  const thread = threadOf(group, id);
  if (!thread) return null;
  const values = await threadForm(t("mysteries.threadEdit"), thread);
  if (!values) return thread;
  await store.updateThread(group, id, { name: values.name, question: values.question, colour: values.colour ?? thread.colour });
  Hooks.callAll("clueboard.thread", threadOf(group, id), "edited", group);
  return threadOf(group, id);
}

/** One field of a thread (status, stand, order), no dialog. */
export async function updateThread(group, id, changes) {
  if (!mayOrganise(group) || !threadOf(group, id)) return null;
  await store.updateThread(group, id, changes);
  Hooks.callAll("clueboard.thread", threadOf(group, id), "edited", group);
  return threadOf(group, id);
}

/** A thread gone, after a confirm; its clues stay in Mysteries, unpinned from it. */
export async function removeThread(group, id, { confirm = true } = {}) {
  if (!mayOrganise(group)) return false;
  const thread = threadOf(group, id);
  if (!thread) return false;
  const pinned = pinnedTo(entriesOf(group), id);
  if (confirm) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("mysteries.threadDelete"), icon: "fa-solid fa-user-secret" },
      content: `<p>${foundry.utils.escapeHTML(t("mysteries.threadDeleteConfirm", { name: thread.name, count: pinned.length }))}</p>`,
      yes: { label: t("mysteries.threadDeleteYes"), icon: "fa-solid fa-xmark", default: false },
      no: { label: t("mysteries.threadDeleteNo"), default: true },
      rejectClose: false
    });
    if (!ok) return false;
  }
  await store.removeThread(group, id, pinned.map(e => e.id));
  Hooks.callAll("clueboard.thread", null, "removed", group, thread);
  return true;
}

/** A clue pinned to a thread, at its end; a second pin keeps its place. */
export async function pinClue(group, clueId, threadId) {
  if (!mayOrganise(group)) return false;
  const entry = entryOf(group, clueId);
  const thread = threadOf(group, threadId);
  if (!entry || !thread) return false;
  if (entry.threads?.[threadId]) return true;
  const last = pinnedTo(entriesOf(group), threadId).at(-1);
  await store.pin(group, clueId, threadId, (last?.threads?.[threadId]?.order ?? -1) + 1);
  ui.notifications.info(t("mysteries.pinned", { name: entry.snapshot.name, thread: thread.name }));
  Hooks.callAll("clueboard.changed", entryOf(group, clueId), "pinned", thread, group);
  return true;
}

/** A clue unpinned from a thread; it stays in Mysteries. */
export async function unpinClue(group, clueId, threadId) {
  if (!mayOrganise(group)) return false;
  const entry = entryOf(group, clueId);
  if (!entry?.threads?.[threadId]) return false;
  await store.unpin(group, clueId, threadId);
  Hooks.callAll("clueboard.changed", entryOf(group, clueId), "unpinned", threadOf(group, threadId), group);
  return true;
}

/** A pinned clue moved before another in its thread (null: to the end); every place rewritten. */
export async function movePin(group, threadId, clueId, beforeId) {
  if (!mayOrganise(group)) return false;
  const ids = pinnedTo(entriesOf(group), threadId).map(e => e.id);
  const next = reorder(ids, clueId, beforeId);
  if (next.every((id, i) => id === ids[i])) return true;
  await store.setPinOrders(group, threadId, Object.fromEntries(next.map((id, i) => [id, i])));
  Hooks.callAll("clueboard.thread", threadOf(group, threadId), "reordered", group);
  return true;
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

/**
 * One party's section of the window: its tabs (All, Unsorted, each thread), the active tab's
 * cards, the thread's head when one is active, and the count of the unread.
 */
export function sectionFor(group, query = "", tab = "all") {
  const all = entriesOf(group);
  const me = myReader(group);
  const threads = threadsOf(group);
  const thread = threadOf(group, tab);
  const active = thread ? "thread" : tab === "unsorted" ? "unsorted" : "all";
  const shown = active === "thread" ? pinnedTo(all, thread.id) : active === "unsorted" ? unsorted(all) : all;
  const ordered = active === "thread" ? shown.filter(e => sortAndFilter([e], query).length) : sortAndFilter(shown, query);
  const byId = Object.fromEntries(threads.map(th => [th.id, th]));
  const entries = ordered.map(e => ({
    group: group.id,
    id: e.id,
    name: e.snapshot.name,
    img: e.snapshot.img,
    kind: t(`kinds.${e.kind ?? e.snapshot.kind ?? "document"}`),
    excerpt: excerpt(e.snapshot.html),
    foundAt: e.snapshot.foundAt,
    foundIn: e.foundIn.sceneName,
    calendarDate: e.foundIn.calendarDate,
    readers: readerList(e.readers).map(r => ({ name: r.actorName, me: me ? r.actorId === me.id : false })),
    unread: me ? !e.readers?.[me.id] : !Object.keys(e.readers ?? {}).length,
    notes: e.notes,
    threads: Object.keys(e.threads ?? {})
      .map(id => byId[id])
      .filter(Boolean)
      .map(th => ({ id: th.id, name: th.name, colour: th.colour })),
    search: `${e.snapshot.name} ${plainText(e.snapshot.html)} ${e.snapshot.foundAt} ${e.notes}`.toLowerCase()
  }));
  const unread = unreadCount(all, me?.id ?? null);
  const views = [
    { id: "all", name: t("mysteries.all"), count: all.length, active: active === "all" },
    { id: "unsorted", name: t("mysteries.unsorted"), count: unsorted(all).length, active: active === "unsorted" }
  ];
  const mysteries = threads.map(th => ({
    id: th.id,
    name: th.name,
    colour: th.colour,
    answered: th.status === "answered",
    count: pinnedTo(all, th.id).length,
    active: thread?.id === th.id
  }));
  return {
    id: group.id,
    name: group.name,
    entries,
    views,
    mysteries,
    active,
    thread: thread
      ? { ...thread, answered: thread.status === "answered", count: pinnedTo(all, thread.id).length }
      : null,
    mayOrganise: mayOrganise(group, { tell: false }),
    total: all.length,
    unread,
    unreadText: me ? t("mysteries.unreadMine", { count: unread }) : t("mysteries.unreadAnyone", { count: unread })
  };
}

/* -------------------------------------------------- */
/*  The window                                        */
/* -------------------------------------------------- */

/**
 * Mysteries is a window of its own, opened centred from the sidebar's spy button (clueboard.js)
 * or the API. Never a sidebar panel: a tab's content lives inside the sidebar's layout, and a
 * panel of cards there left the sidebar stuck. One window per client, reused. For the GM it is
 * also the place to collect: a strip of the world's uncollected Clues, and a drop target.
 */
export class MysteriesWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "clueboard-mysteries",
    classes: ["clueboard-mysteries"],
    window: { title: `${MODULE_ID}.mysteries.title`, icon: "fa-solid fa-user-secret", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      open: MysteriesWindow.#onOpen,
      collect: MysteriesWindow.#onCollect,
      remove: MysteriesWindow.#onRemove,
      openItem: MysteriesWindow.#onOpenItem,
      // Not "tab": ApplicationV2 handles that action itself, before any of ours, and throws.
      showTab: MysteriesWindow.#onShowTab,
      newThread: MysteriesWindow.#onNewThread,
      editThread: MysteriesWindow.#onEditThread,
      deleteThread: MysteriesWindow.#onDeleteThread,
      toggleStatus: MysteriesWindow.#onToggleStatus,
      unpin: MysteriesWindow.#onUnpin
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

  /** The clue view, "all" or "unsorted", for the whole window. */
  #view = "all";

  /** The open mystery per party (a thread's id), or none: then the clue view shows. */
  #tabs = {};

  /**
   * Show a party's mystery, or a clue view ("all", "unsorted"), which closes any open mystery
   * (the API's and the live check's way in).
   */
  showTab(groupId, tab) {
    if (tab === "all" || tab === "unsorted") {
      this.#view = tab;
      this.#tabs = {};
    } else {
      this.#tabs[groupId] = tab;
    }
    return this.rendered ? this.render() : Promise.resolve(this);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = groups().filter(g => g.testUserPermission(game.user, "OBSERVER"));
    context.sections = list.map(g => sectionFor(g, "", this.#tabs[g.id] ?? this.#view));
    context.several = context.sections.length > 1;
    context.none = !context.sections.length;
    context.empty = context.sections.every(s => !s.entries.length);
    context.query = this.#query;
    // The clue views, for the whole window: the counts summed over the parties shown.
    const anyMystery = Object.keys(this.#tabs).length > 0;
    context.views = ["all", "unsorted"].map(id => ({
      id,
      name: t(`mysteries.${id}`),
      count: context.sections.reduce((n, s) => n + (s.views.find(v => v.id === id)?.count ?? 0), 0),
      active: !anyMystery && this.#view === id
    }));
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
    this.#wireThreads();
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

  /** A card being dragged (its party and id), set at dragstart; a drag of anything else is null. */
  static #dragging = null;

  /**
   * The party's own sorting: a card dragged onto a thread's tab pins it there; inside a thread, a
   * card dropped on another goes before it, on the empty space after it, at the end. The stand
   * saves as it is typed away from.
   */
  #wireThreads() {
    const root = this.element;
    for (const section of root.querySelectorAll(".clueboard-section[data-group]")) {
      const group = game.actors.get(section.dataset.group);
      if (!group) continue;
      const may = mayOrganise(group, { tell: false });
      const threadId = section.dataset.thread || null;
      for (const card of section.querySelectorAll(".clueboard-card[data-id]")) {
        card.draggable = may;
        card.addEventListener("dragstart", ev => {
          MysteriesWindow.#dragging = { group: group.id, id: card.dataset.id };
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", card.dataset.id);
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => {
          MysteriesWindow.#dragging = null;
          card.classList.remove("dragging");
          for (const el of root.querySelectorAll(".drop-before, .drop-ok")) el.classList.remove("drop-before", "drop-ok");
        });
        if (threadId) {
          card.addEventListener("dragover", ev => {
            const d = MysteriesWindow.#dragging;
            if (!d || d.group !== group.id || d.id === card.dataset.id) return;
            ev.preventDefault();
            ev.stopPropagation();
            card.classList.add("drop-before");
          });
          card.addEventListener("dragleave", () => card.classList.remove("drop-before"));
          card.addEventListener("drop", ev => {
            const d = MysteriesWindow.#dragging;
            if (!d || d.group !== group.id) return;
            ev.preventDefault();
            ev.stopPropagation();
            void movePin(group, threadId, d.id, card.dataset.id);
          });
        }
      }
      if (threadId) {
        const grid = section.querySelector(".clueboard-cards");
        grid?.addEventListener("dragover", ev => {
          const d = MysteriesWindow.#dragging;
          if (!d || d.group !== group.id) return;
          ev.preventDefault();
        });
        grid?.addEventListener("drop", ev => {
          const d = MysteriesWindow.#dragging;
          if (!d || d.group !== group.id || ev.target.closest(".clueboard-card")) return;
          ev.preventDefault();
          ev.stopPropagation();
          void movePin(group, threadId, d.id, null);
        });
      }
      for (const tab of section.querySelectorAll(".clueboard-tab[data-droppable]")) {
        tab.addEventListener("dragover", ev => {
          const d = MysteriesWindow.#dragging;
          if (!d || d.group !== group.id) return;
          ev.preventDefault();
          ev.stopPropagation();
          tab.classList.add("drop-ok");
        });
        tab.addEventListener("dragleave", () => tab.classList.remove("drop-ok"));
        tab.addEventListener("drop", ev => {
          const d = MysteriesWindow.#dragging;
          if (!d || d.group !== group.id) return;
          ev.preventDefault();
          ev.stopPropagation();
          tab.classList.remove("drop-ok");
          void pinClue(group, d.id, tab.dataset.tab);
        });
      }
      const stand = section.querySelector("textarea[name=stand]");
      if (stand && threadId) {
        stand.addEventListener("change", ev => {
          const value = ev.currentTarget.value;
          if (value !== (threadOf(group, threadId)?.stand ?? "")) void updateThread(group, threadId, { stand: value });
        });
      }
    }
  }

  static #onShowTab(_event, target) {
    const section = target.closest("[data-group]");
    this.showTab(section?.dataset.group ?? null, target.dataset.tab);
  }

  static async #onNewThread(_event, target) {
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group);
    if (!group) return;
    const thread = await createThread(group);
    if (thread) this.showTab(group.id, thread.id);
  }

  static async #onEditThread(_event, target) {
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group);
    if (group) await editThread(group, target.dataset.thread);
  }

  static async #onDeleteThread(_event, target) {
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group);
    if (!group) return;
    if (await removeThread(group, target.dataset.thread)) this.showTab(group.id, "all");
  }

  static async #onToggleStatus(_event, target) {
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group);
    const thread = threadOf(group, target.dataset.thread);
    if (group && thread) await updateThread(group, thread.id, { status: thread.status === "answered" ? "open" : "answered" });
  }

  static async #onUnpin(event, target) {
    event.stopPropagation();
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group);
    if (group) await unpinClue(group, target.dataset.id, target.dataset.thread);
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
