/**
 * The Reader: an item's image and description as a document, nothing else of the sheet, and
 * never a word to chat. On a Clue in the party stash it gathers first (mysteries.js) and shows
 * the entry's stamp; on an entry from Mysteries it shows the snapshot, which outlives the item.
 * An entry is named by its party and its clue id and read live from the party's record, so the
 * Reader redraws when that record changes (clueboard.js).
 */

import { log, MODULE_ID, t } from "./common.js";
import { clueId, isClue, readerList } from "./decide/clue.js";
import { entryOf, findEntry, gather, holderText } from "./mysteries.js";
import * as store from "./store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class Reader extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "clueboard-reader-{id}",
    classes: ["clueboard-reader"],
    window: { icon: "fa-solid fa-book-open", resizable: true, contentClasses: ["standard-form"] },
    position: { width: 560, height: "auto" },
    actions: {
      note: Reader.#onNote,
      openItem: Reader.#onOpenItem
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/reader.hbs`, scrollable: [".clueboard-doc"] }
  };

  /**
   * @param {object} options
   * @param {Item} [options.item]    The item being read (may be absent for an entry whose item is gone).
   * @param {Actor} [options.group]  The party whose record holds the entry.
   * @param {string} [options.clue]  The entry's clue id.
   */
  constructor({ item = null, group = null, clue = null, ...options } = {}) {
    super(options);
    this.item = item;
    this.group = group;
    this.clue = clue;
  }

  /** The entry as the party's record holds it now, or null. */
  get entry() {
    return entryOf(this.group, this.clue);
  }

  /** @override */
  get title() {
    return this.entry?.snapshot.name || this.item?.name || t("read.button");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const entry = this.entry;
    const item = this.item;
    const fromEntry = Boolean(entry);
    let name;
    let img;
    let html;
    if (fromEntry) {
      ({ name, img, html } = entry.snapshot);
    } else {
      const masked = !game.user.isGM && item?.system?.identified === false;
      name = (masked ? item.system.unidentified?.name : null) || item?.name || "";
      img = item?.img ?? "";
      html = (masked ? item.system.unidentified?.description : null) ?? item?.system?.description?.value ?? "";
    }
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    context.name = name;
    context.img = img;
    context.html = await TextEditor.enrichHTML(html ?? "", { secrets: game.user.isGM, relativeTo: item ?? this.group });
    context.isClue = fromEntry || isClue(item);
    context.revision = entry?.snapshot.revision > 1 ? t("read.revision", { n: entry.snapshot.revision }) : "";
    context.stamp = entry
      ? {
          foundIn: entry.foundIn.sceneName,
          calendarDate: entry.foundIn.calendarDate,
          realDate: entry.foundIn.realDate ? new Date(entry.foundIn.realDate).toLocaleDateString() : "",
          readers: readerList(entry.readers).map(r => ({ name: r.actorName, me: r.userId === game.user.id })),
          holder: holderText(entry.holder),
          left: entry.holder.left,
          notes: entry.notes
        }
      : null;
    context.canNote = Boolean(entry && this.group?.isOwner);
    context.canOpenItem = Boolean(item?.sheet) || Boolean(entry?.source.uuid);
    context.gmSilent = game.user.isGM && !fromEntry && isClue(item);
    context.notClue = !fromEntry && item && !isClue(item);
    return context;
  }

  static async #onNote() {
    const entry = this.entry;
    if (!entry || !this.group?.isOwner) return;
    const current = foundry.utils.escapeHTML(entry.notes ?? "");
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("read.note") },
      content: `<p>${t("read.notePrompt", { name: foundry.utils.escapeHTML(entry.snapshot.name) })}</p><textarea name="notes" rows="4" autofocus>${current}</textarea>`,
      ok: { callback: (_ev, button) => button.form.elements.notes.value },
      rejectClose: false
    });
    if (value === null || value === undefined) return;
    await store.setNotes(this.group, entry.id, value);
    Hooks.callAll("clueboard.changed", this.entry, "notes", value, this.group);
    this.render();
  }

  static async #onOpenItem() {
    const item = this.item ?? (this.entry?.source.uuid ? await fromUuid(this.entry.source.uuid) : null);
    if (!item) {
      ui.notifications.warn(t("read.itemGone"));
      return;
    }
    item.sheet?.render(true);
  }
}

/** Redraw every open Reader on this party's record. */
export function refreshReaders(group) {
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof Reader && app.group === group && app.rendered) app.render();
  }
}

/**
 * Open the Reader. With an item in a group's stash, a player's read gathers it first; a GM's
 * read is silent. With a group and a clue id, the entry is read as it was gathered.
 * @param {{ item?: Item, group?: Actor, id?: string }} options
 */
export async function openReader({ item = null, group = null, id = null }) {
  try {
    let clue = id;
    if (item && group && isClue(item)) {
      const entry = await gather(item, group);
      clue = entry?.id ?? clueId(item, MODULE_ID);
    } else if (item && !clue) {
      const found = findEntry(clueId(item, MODULE_ID));
      if (found) ({ group, entry: { id: clue } } = found);
    }
    const entry = entryOf(group, clue);
    if (entry && !item && entry.source.uuid) {
      const source = await fromUuid(entry.source.uuid).catch(() => null);
      if (source instanceof Item) item = source;
    }
    const reader = new Reader({ item, group, clue: entry ? clue : null });
    return reader.render({ force: true });
  } catch (err) {
    log.error("opening the Reader failed", err);
    ui.notifications.error(t("read.failed", { reason: err?.message ?? String(err) }));
    return null;
  }
}
