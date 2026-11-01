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
  pictureOf,
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

/**
 * When: the calendar date and the clock. Never a scene: the one the collecting client views (a DM
 * between scenes, the MCP's page) is no record of where the clue was found; the Clue's own Found
 * at line is.
 */
export function stampNow() {
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
 * @param {{ how?: string, stamp?: boolean }} [options]  Where the collect came from, for the log;
 *   `stamp: false` leaves the calendar date out of the stamp, for a clue found before it was
 *   collected.
 */
export async function collect(item, group, { how = "api", stamp = true } = {}) {
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
      foundIn: stamp ? stampNow() : { ...stampNow(), calendarDate: "" },
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

/** Each kind's icon: on a card's badge, and on its words when it has no picture. */
const KIND_ICONS = {
  document: "fa-file-lines",
  object: "fa-key",
  statement: "fa-comment-dots",
  location: "fa-location-dot",
  body: "fa-skull",
  rumour: "fa-ear-listen",
  vision: "fa-eye"
};

/* -------------------------------------------------- */
/*  The export                                        */
/* -------------------------------------------------- */

/**
 * A party's Mysteries as plain data, for a file: every clue with its text (as HTML and as plain
 * words), where and when it was found, who has read it, the party's note and the mysteries it is
 * pinned to; then the mysteries themselves. Nothing of the DM's: it is what the party has.
 */
export function exportData(group) {
  const threads = threadsOf(group);
  const byId = Object.fromEntries(threads.map(th => [th.id, th]));
  const entries = entriesOf(group);
  const kindLabel = kind => t(`kinds.${kind ?? "document"}`);
  return {
    format: "fvtt-mod-clueboard/mysteries",
    version: 1,
    party: group.name,
    world: game.world.title,
    exportedAt: new Date().toISOString(),
    clues: entries.map(e => ({
      id: e.id,
      name: e.snapshot.name,
      kind: kindLabel(e.kind ?? e.snapshot.kind),
      foundAt: e.snapshot.foundAt,
      foundIn: { calendarDate: e.foundIn.calendarDate, realDate: e.foundIn.realDate },
      text: plainText(e.snapshot.html),
      html: e.snapshot.html,
      revision: e.snapshot.revision,
      readBy: readerList(e.readers).map(r => ({ name: r.actorName, at: r.at })),
      note: e.notes,
      mysteries: Object.keys(e.threads ?? {})
        .map(id => byId[id]?.name)
        .filter(Boolean)
    })),
    mysteries: threads.map(th => ({
      id: th.id,
      name: th.name,
      question: th.question,
      status: th.status === "answered" ? "solved" : "unsolved",
      whereWeStand: th.stand,
      colour: th.colour,
      clues: pinnedTo(entries, th.id).map(e => e.snapshot.name)
    }))
  };
}

/** The export written to a file the browser saves: `<party>-clues-<date>.json`. */
export function exportToFile(group) {
  const data = exportData(group);
  const slug = (group.name || "party").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = `${slug}-clues-${data.exportedAt.slice(0, 10)}.json`;
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", name);
  ui.notifications.info(t("mysteries.exported", { name, count: data.clues.length }));
  return name;
}

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
  const entries = ordered.map(e => {
    const kind = e.kind ?? e.snapshot.kind ?? "document";
    const readers = readerList(e.readers).map(r => ({ name: r.actorName, me: me ? r.actorId === me.id : false }));
    return {
    group: group.id,
    id: e.id,
    key: `${group.id}:${e.id}`,
    name: e.snapshot.name,
    picture: pictureOf(e.snapshot.img),
    kind: t(`kinds.${kind}`),
    kindIcon: KIND_ICONS[kind] ?? KIND_ICONS.document,
    excerpt: excerpt(e.snapshot.html),
    where: [e.snapshot.foundAt, e.foundIn.calendarDate].filter(Boolean).join(" · "),
    readers,
    readText: readers.length ? t("mysteries.readBy", { names: readers.map(r => r.name).join(", ") }) : t("mysteries.readByNone"),
    unread: me ? !e.readers?.[me.id] : !Object.keys(e.readers ?? {}).length,
    notes: e.notes,
    threads: Object.keys(e.threads ?? {})
      .map(id => byId[id])
      .filter(Boolean)
      .map(th => ({ id: th.id, name: th.name, colour: th.colour })),
    search: `${e.snapshot.name} ${plainText(e.snapshot.html)} ${e.snapshot.foundAt} ${e.notes}`.toLowerCase()
    };
  });
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
    heading: thread ? thread.name : (views.find(v => v.active)?.name ?? ""),
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
    position: { width: 1100, height: 800 },
    actions: {
      pick: MysteriesWindow.#onPick,
      go: MysteriesWindow.#onGo,
      openMenu: MysteriesWindow.#onOpenMenu,
      closeMenu: MysteriesWindow.#onCloseMenu,
      act: MysteriesWindow.#onAct,
      size: MysteriesWindow.#onSize,
      searchAll: MysteriesWindow.#onSearchAll,
      collect: MysteriesWindow.#onCollect,
      openItem: MysteriesWindow.#onOpenItem,
      export: MysteriesWindow.#onExport,
      // Not "tab": ApplicationV2 handles that action itself, before any of ours, and throws.
      showTab: MysteriesWindow.#onShowTab,
      newThread: MysteriesWindow.#onNewThread,
      editThread: MysteriesWindow.#onEditThread,
      deleteThread: MysteriesWindow.#onDeleteThread,
      toggleStatus: MysteriesWindow.#onToggleStatus
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/mysteries.hbs`,
      // Both keep their scroll through a redraw (a pin, a read, another client's write), so a
      // player dragging clue after clue onto the rail never loses their place.
      scrollable: [".clueboard-main", ".clueboard-rail"]
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

  /** The picked card's key (`<party>:<clue>`): marked in place, kept through a redraw. */
  #selected = null;

  /** The card whose chevron is open (`{ group, id }`), or none. */
  #menu = null;

  /** The chevron just opened: its first button takes the focus once. */
  #menuFresh = false;

  /** The chevron's toggle to focus again after its redraw (a thread pinned from it). */
  #menuFocus = null;

  /** The card whose chevron closed: its chevron takes the focus back. */
  #returnTo = null;

  /** What had the focus before a redraw (another client's write redraws too). */
  #focus = null;

  /** The card size, S, M or L, this browser's. */
  #size = loadSize();

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
    for (const s of context.sections) for (const e of s.entries) e.selected = e.key === this.#selected;
    context.query = this.#query;
    context.isGM = game.user.isGM;
    context.size = this.#size;
    context.sizes = SIZES.map(id => ({ id, label: t(`size.${id}`), aria: t(`size.${id}Aria`), on: id === this.#size }));
    context.menu = this.#menuContext();
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

  /** The open chevron's head and rows, or null (its card gone: the chevron closes). */
  #menuContext() {
    const group = this.#menu ? game.actors.get(this.#menu.group) : null;
    const entry = group ? entryOf(group, this.#menu.id) : null;
    if (!entry) {
      this.#menu = null;
      return null;
    }
    const kind = entry.kind ?? entry.snapshot.kind ?? "document";
    return {
      name: entry.snapshot.name,
      picture: pictureOf(entry.snapshot.img),
      kind: t(`kinds.${kind}`),
      kindIcon: KIND_ICONS[kind] ?? KIND_ICONS.document,
      rows: menuRows(group, entry).map(r => ({
        ...r,
        label: t(r.label),
        hint: r.hint ? t(r.hint) : "",
        choices: r.choices?.map(c => ({ ...c, act: r.act })) ?? null
      }))
    };
  }

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const active = this.element?.contains(document.activeElement) ? document.activeElement : null;
    this.#focus = active
      ? {
          name: active.name || null,
          action: active.dataset?.action ?? null,
          key: active.closest("[data-key]")?.dataset.key ?? null,
          tab: active.dataset?.tab ?? null,
          start: active.selectionStart ?? null
        }
      : null;
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.#threadMenu();
    this.element.addEventListener("keydown", ev => {
      if (this.#menu && ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        return this.#closeMenu();
      }
      const typing = ev.target.closest?.("input, textarea, select, [contenteditable]");
      if (ev.key === "/" && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        this.element.querySelector("input[name=search]")?.focus();
      }
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    input?.addEventListener("input", ev => this.#filter(ev.currentTarget.value));
    input?.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && this.#query) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.currentTarget.value = "";
        this.#filter("");
      }
    });
    this.#filter(this.#query);
    this.element.querySelector(".clueboard-veil")?.addEventListener("click", ev => {
      if (ev.target === ev.currentTarget) this.#closeMenu();
    });
    this.#wireThreads();
    this.#restoreFocus(context);
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

  async #dropped(uuid) {
    const item = await fromUuid(uuid);
    const group = await pickParty();
    if (item && group) await collect(item, group, { how: "window" });
  }

  /**
   * The search, applied to the drawn cards with no redraw: each party's count says how many match,
   * an empty view says so, and the matches outside the view are a button away.
   */
  #filter(query) {
    this.#query = query;
    const q = query.trim().toLowerCase();
    for (const section of this.element.querySelectorAll(".clueboard-section[data-group]")) {
      let shown = 0;
      for (const card of section.querySelectorAll(".clueboard-card[data-search]")) {
        card.hidden = Boolean(q) && !card.dataset.search.includes(q);
        if (!card.hidden) shown++;
      }
      const group = game.actors.get(section.dataset.group);
      const view = section.querySelector(".clueboard-rail-row.active")?.dataset.tab ?? "all";
      const everywhere = q && group && view !== "all" ? entriesOf(group).filter(e => matches(e, q)).length : shown;
      const elsewhere = Math.max(0, everywhere - shown);
      const count = section.querySelector(".clueboard-count");
      if (count) count.textContent = q ? t("mysteries.matching", { n: shown, q: query.trim() }) : (count.dataset.base ?? "");
      const none = section.querySelector(".clueboard-nomatch");
      if (none) {
        none.hidden = !q || shown > 0 || !section.querySelector(".clueboard-card");
        none.textContent = q ? t(elsewhere ? "mysteries.searchHere" : "mysteries.searchNone", { q: query.trim() }) : "";
      }
      const more = section.querySelector(".clueboard-more");
      if (more) {
        more.hidden = !elsewhere;
        more.textContent = elsewhere ? t("mysteries.searchMore", { n: elsewhere }) : "";
      }
    }
  }

  /** After a redraw: the chevron's first button, its toggle, the card it closed from, or what had the focus. */
  #restoreFocus(context) {
    const root = this.element;
    if (context.menu && this.#menuFresh) {
      this.#menuFresh = false;
      return root.querySelector(".clueboard-menu button:not([disabled])")?.focus();
    }
    if (context.menu && this.#menuFocus !== null) {
      const arg = this.#menuFocus;
      this.#menuFocus = null;
      return root.querySelector(`.clueboard-menu [data-act="pin"][data-arg="${CSS.escape(arg)}"]`)?.focus();
    }
    const back = this.#returnTo;
    this.#returnTo = null;
    if (back) {
      const el = root.querySelector(`.clueboard-card[data-key="${CSS.escape(back)}"] [data-action="openMenu"]`);
      if (el && !el.closest("[hidden]")) return el.focus({ preventScroll: true });
    }
    const f = this.#focus;
    this.#focus = null;
    if (!f) return;
    let el = null;
    if (f.name) el = root.querySelector(`[name="${CSS.escape(f.name)}"]`);
    else if (f.action) {
      const scope = f.key ? root.querySelector(`[data-key="${CSS.escape(f.key)}"]`) : root;
      el = scope?.querySelector(`[data-action="${CSS.escape(f.action)}"]${f.tab ? `[data-tab="${CSS.escape(f.tab)}"]` : ""}`);
    }
    if (!el || el.closest("[hidden]")) return;
    el.focus({ preventScroll: true });
    if (f.start !== null && typeof el.setSelectionRange === "function") {
      try {
        el.setSelectionRange(f.start, f.start);
      } catch {
        // Not a text field.
      }
    }
  }

  /**
   * The right-click menu on a thread's row (its owners'): edit it, mark it Solved or Unsolved, delete
   * it, as its head's buttons do. Bound once; Foundry's menu finds the row under the click.
   */
  #threadMenu() {
    const Menu = foundry.applications.ux.ContextMenu.implementation ?? foundry.applications.ux.ContextMenu;
    const of = row => {
      const group = game.actors.get(row.closest("[data-group]")?.dataset.group);
      return { group, thread: group ? threadOf(group, row.dataset.tab) : null };
    };
    const may = row => {
      const { group, thread } = of(row);
      return Boolean(thread) && mayOrganise(group, { tell: false });
    };
    const solved = row => of(row).thread?.status === "answered";
    new Menu(
      this.element,
      ".clueboard-rail-row[data-droppable]",
      [
        {
          label: `${MODULE_ID}.mysteries.threadEdit`,
          icon: '<i class="fa-solid fa-pen"></i>',
          condition: may,
          onClick: (_ev, row) => {
            const { group, thread } = of(row);
            if (thread) return editThread(group, thread.id);
          }
        },
        {
          label: `${MODULE_ID}.mysteries.markSolved`,
          icon: '<i class="fa-solid fa-circle-check"></i>',
          condition: row => may(row) && !solved(row),
          onClick: (_ev, row) => {
            const { group, thread } = of(row);
            if (thread) return updateThread(group, thread.id, { status: "answered" });
          }
        },
        {
          label: `${MODULE_ID}.mysteries.markUnsolved`,
          icon: '<i class="fa-regular fa-circle"></i>',
          condition: row => may(row) && solved(row),
          onClick: (_ev, row) => {
            const { group, thread } = of(row);
            if (thread) return updateThread(group, thread.id, { status: "open" });
          }
        },
        {
          label: `${MODULE_ID}.mysteries.threadDelete`,
          icon: '<i class="fa-solid fa-trash"></i>',
          condition: may,
          onClick: async (_ev, row) => {
            const { group, thread } = of(row);
            if (thread && (await removeThread(group, thread.id)) && this.#tabs[group.id] === thread.id) this.showTab(group.id, "all");
          }
        }
      ],
      { jQuery: false, fixed: true }
    );
  }

  #closeMenu() {
    if (!this.#menu) return;
    this.#returnTo = `${this.#menu.group}:${this.#menu.id}`;
    this.#menu = null;
    this.render();
  }

  /** A chevron row by name. Pinning keeps the chevron open, so a clue goes to several threads at once. */
  async #act(name, arg) {
    const m = this.#menu;
    const group = m ? game.actors.get(m.group) : null;
    const entry = group ? entryOf(group, m.id) : null;
    if (!entry) return this.#closeMenu();
    const row = menuRows(group, entry).find(r => r.act === name);
    if (!row || row.disabled) return;
    if (name !== "pin") {
      this.#returnTo = `${m.group}:${m.id}`;
      this.#menu = null;
      this.render();
    }
    try {
      await row.run(group, entry, arg || null);
    } catch (err) {
      log.error(`the chevron's ${name} failed`, err);
      ui.notifications.error(err?.message || t("menu.failed"));
    }
    if (name === "pin" && this.#menu) {
      this.#menuFocus = arg ?? "";
      this.render();
    }
  }

  /** A click picks a card in place; a double click, or Enter, reads it (Card Catalogue's rule). */
  static #onPick(event, target) {
    const card = target.closest(".clueboard-card[data-key]");
    if (!card) return;
    this.#selected = card.dataset.key;
    if ((event?.detail ?? 0) === 1) return markPicked(this.element, card.dataset.key);
    const group = game.actors.get(card.dataset.group);
    if (group) return openReaderFor(group, card.dataset.id);
  }

  /** The card's Read. */
  static #onGo(event, target) {
    event.stopPropagation();
    if (event.detail > 1) return;
    const card = target.closest(".clueboard-card[data-key]");
    const group = game.actors.get(card?.dataset.group);
    if (!group) return;
    this.#selected = card.dataset.key;
    markPicked(this.element, card.dataset.key);
    return openReaderFor(group, card.dataset.id);
  }

  static #onOpenMenu(event, target) {
    event.stopPropagation();
    const card = target.closest(".clueboard-card[data-key]");
    if (!card) return;
    this.#selected = card.dataset.key;
    this.#menu = { group: card.dataset.group, id: card.dataset.id };
    this.#menuFresh = true;
    this.render();
  }

  static #onCloseMenu() {
    this.#closeMenu();
  }

  static #onAct(_event, target) {
    return this.#act(target.dataset.act, target.dataset.arg ?? null);
  }

  static #onSize(_event, target) {
    this.#size = saveSize(target.dataset.size);
    this.render();
  }

  /** Nothing in this view matches: the same search in All. */
  static #onSearchAll(_event, target) {
    this.showTab(target.closest("[data-group]")?.dataset.group ?? null, "all");
  }

  static async #onCollect(_event, target) {
    const item = await fromUuid(target.dataset.uuid);
    const group = await pickParty();
    if (item && group) await collect(item, group, { how: "strip" });
  }

  static async #onExport(_event, target) {
    const group = game.actors.get(target.closest("[data-group]")?.dataset.group) ?? (await pickParty());
    if (group) exportToFile(group);
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

/** Whether an entry matches a lowercased search, by the words a card is searched on. */
function matches(e, q) {
  return `${e.snapshot.name} ${plainText(e.snapshot.html)} ${e.snapshot.foundAt} ${e.notes}`.toLowerCase().includes(q);
}

/** A card picked in place: its edge and its pressed state, the others' cleared, with no redraw. */
function markPicked(root, key) {
  for (const card of root?.querySelectorAll(".clueboard-card[data-key]") ?? []) {
    const on = card.dataset.key === key;
    card.classList.toggle("on", on);
    card.querySelector('[data-action="pick"]')?.setAttribute("aria-pressed", String(on));
  }
}

/**
 * A card's chevron: Read; the threads it is pinned to, each a toggle, and a new one (its party's
 * owners); for the GM, the picture shown to everyone, the Clue's sheet, and taking it off the board.
 */
function menuRows(group, entry) {
  const picture = pictureOf(entry.snapshot.img);
  const rows = [
    {
      act: "read",
      icon: "fa-book-open",
      label: "menu.read",
      hint: myReader(group) ? "menu.readMark" : "menu.readHint",
      run: () => openReaderFor(group, entry.id)
    }
  ];
  if (mayOrganise(group, { tell: false })) {
    const pins = entry.threads ?? {};
    rows.push({
      act: "pin",
      icon: "fa-thumbtack",
      label: "menu.threads",
      hint: "menu.threadsHint",
      choices: [
        ...threadsOf(group).map(th => ({ arg: th.id, label: th.name, colour: th.colour, on: Boolean(pins[th.id]) })),
        { arg: "", label: t("mysteries.newThread"), icon: "fa-plus" }
      ],
      run: async (g, e, threadId) => {
        if (!threadId) {
          const thread = await createThread(g);
          return thread ? pinClue(g, e.id, thread.id) : false;
        }
        return e.threads?.[threadId] ? unpinClue(g, e.id, threadId) : pinClue(g, e.id, threadId);
      }
    });
  }
  if (game.user.isGM) {
    const item = game.items.get(entry.id);
    rows.push(
      {
        act: "show",
        icon: "fa-image",
        label: "menu.show",
        hint: picture ? "menu.showHint" : "menu.showNone",
        disabled: !picture,
        run: () => showPicture(picture, entry.snapshot.name)
      },
      {
        act: "edit",
        icon: "fa-pen-to-square",
        label: "menu.edit",
        hint: item ? "menu.editHint" : "menu.editGone",
        disabled: !item,
        run: () => item?.sheet?.render(true)
      },
      {
        act: "remove",
        icon: "fa-xmark",
        label: "menu.remove",
        hint: "menu.removeHint",
        danger: true,
        run: (g, e) => uncollect(g, e.id)
      }
    );
  }
  return rows;
}

/** The picture in Foundry's own popout, shown to everyone connected. */
async function showPicture(src, name) {
  const ImagePopout = foundry.applications?.apps?.ImagePopout;
  if (!ImagePopout || !src) return false;
  const popout = new ImagePopout({ src, window: { title: name } });
  await popout.render({ force: true });
  await popout.shareImage?.();
  return true;
}

/** The card sizes; this browser's pick, under the world and the user. Blocked storage forgets. */
const SIZES = ["s", "m", "l"];
const sizeKey = () => `${MODULE_ID}.size.${game.world?.id ?? "world"}.${game.user?.id ?? "user"}`;

function loadSize() {
  try {
    const size = globalThis.localStorage?.getItem(sizeKey());
    return SIZES.includes(size) ? size : "m";
  } catch {
    return "m";
  }
}

function saveSize(size) {
  const pick = SIZES.includes(size) ? size : "m";
  try {
    globalThis.localStorage?.setItem(sizeKey(), pick);
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
  return pick;
}
