/**
 * The Reader: an entry's text as a document, with its stamp, and never a word to chat. Opened
 * from a card in Mysteries; a player's opening marks the read (mysteries.js), a GM's marks
 * nothing. An entry is named by its party and the Clue's id and read live from the party's
 * record, so the Reader redraws when that record changes (clueboard.js).
 */

import { log, MODULE_ID, t } from "./common.js";
import { readerList } from "./decide/clue.js";
import { entryOf, markRead } from "./mysteries.js";
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
   * @param {Actor} options.group  The party whose record holds the entry.
   * @param {string} options.clue  The entry's id (the Clue item's).
   */
  constructor({ group, clue, ...options } = {}) {
    super(options);
    this.group = group;
    this.clue = clue;
  }

  /** The entry as the party's record holds it now, or null. */
  get entry() {
    return entryOf(this.group, this.clue);
  }

  /** @override */
  get title() {
    return this.entry?.snapshot.name || t("mysteries.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const entry = this.entry;
    if (!entry) {
      context.gone = true;
      return context;
    }
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const source = entry.source.uuid ? fromUuidSync(entry.source.uuid) : null;
    context.name = entry.snapshot.name;
    context.img = entry.snapshot.img;
    context.html = await TextEditor.enrichHTML(entry.snapshot.html ?? "", { secrets: game.user.isGM, relativeTo: source ?? this.group });
    context.revision = entry.snapshot.revision > 1 ? t("read.revision", { n: entry.snapshot.revision }) : "";
    context.stamp = {
      foundAt: entry.snapshot.foundAt,
      foundIn: entry.foundIn.sceneName,
      calendarDate: entry.foundIn.calendarDate,
      realDate: entry.foundIn.realDate ? new Date(entry.foundIn.realDate).toLocaleDateString() : "",
      readers: readerList(entry.readers).map(r => ({ name: r.actorName, me: r.userId === game.user.id })),
      notes: entry.notes
    };
    context.canNote = Boolean(this.group?.isOwner);
    context.canOpenItem = Boolean(source?.testUserPermission?.(game.user, "OBSERVER"));
    context.gmSilent = game.user.isGM;
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
    const item = this.entry?.source.uuid ? await fromUuid(this.entry.source.uuid) : null;
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
 * Open the Reader on a party's entry. A player's opening marks the read first.
 * @param {{ group: Actor, id: string }} options
 */
export async function openReader({ group, id }) {
  try {
    if (!entryOf(group, id)) {
      ui.notifications.warn(t("read.entryGone"));
      return null;
    }
    await markRead(group, id);
    const reader = new Reader({ group, clue: id });
    return reader.render({ force: true });
  } catch (err) {
    log.error("opening the Reader failed", err);
    ui.notifications.error(t("read.failed", { reason: err?.message ?? String(err) }));
    return null;
  }
}
