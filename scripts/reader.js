/**
 * The Reader: an item's image and description as a document, nothing else of the sheet, and
 * never a word to chat. On a Clue in the party stash it gathers first (mysteries.js) and shows
 * the entry's stamp; on an entry from Mysteries it shows the snapshot, which outlives the item.
 */

import { log, MODULE_ID, t } from "./common.js";
import { clueId, isClue } from "./decide/clue.js";
import { entryFor, gather, holderText } from "./mysteries.js";

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
   * @param {Item} [options.item]        The item being read (may be absent for an old entry).
   * @param {JournalEntryPage} [options.page]  The Mysteries entry, when the clue has one.
   */
  constructor({ item = null, page = null, ...options } = {}) {
    super(options);
    this.item = item;
    this.page = page;
  }

  /** @override */
  get title() {
    return this.page?.name ?? this.item?.name ?? t("read.button");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.page;
    const item = this.item;
    const fromPage = Boolean(page);
    let name;
    let img;
    let html;
    if (fromPage) {
      ({ name, img, html } = page.system.snapshot);
    } else {
      const masked = !game.user.isGM && item?.system?.identified === false;
      name = (masked ? item.system.unidentified?.name : null) || item?.name || "";
      img = item?.img ?? "";
      html = (masked ? item.system.unidentified?.description : null) ?? item?.system?.description?.value ?? "";
    }
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    context.name = name;
    context.img = img;
    context.html = await TextEditor.enrichHTML(html ?? "", { secrets: game.user.isGM, relativeTo: page ?? item });
    context.isClue = fromPage || isClue(item);
    context.revision = page?.system.snapshot.revision > 1 ? t("read.revision", { n: page.system.snapshot.revision }) : "";
    context.stamp = page
      ? {
          foundIn: page.system.foundIn.sceneName,
          calendarDate: page.system.foundIn.calendarDate,
          realDate: page.system.foundIn.realDate ? new Date(page.system.foundIn.realDate).toLocaleDateString() : "",
          readers: page.system.readers.map(r => ({ name: r.actorName, me: r.userId === game.user.id })),
          holder: holderText(page.system.holder),
          left: page.system.holder.left,
          notes: page.system.notes
        }
      : null;
    context.canNote = Boolean(page?.isOwner);
    context.canOpenItem = Boolean(item?.sheet) || Boolean(page?.system.source.uuid);
    context.gmSilent = game.user.isGM && !fromPage && isClue(item);
    context.notClue = !fromPage && item && !isClue(item);
    return context;
  }

  static async #onNote() {
    const page = this.page;
    if (!page?.isOwner) return;
    const current = foundry.utils.escapeHTML(page.system.notes ?? "");
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("read.note") },
      content: `<p>${t("read.notePrompt", { name: foundry.utils.escapeHTML(page.name) })}</p><textarea name="notes" rows="4" autofocus>${current}</textarea>`,
      ok: { callback: (_ev, button) => button.form.elements.notes.value },
      rejectClose: false
    });
    if (value === null || value === undefined) return;
    await page.update({ "system.notes": value });
    Hooks.callAll("clueboard.changed", page, "notes", value);
    this.render();
  }

  static async #onOpenItem() {
    const item = this.item ?? (this.page?.system.source.uuid ? await fromUuid(this.page.system.source.uuid) : null);
    if (!item) {
      ui.notifications.warn(t("read.itemGone"));
      return;
    }
    item.sheet?.render(true);
  }
}

/**
 * Open the Reader. With an item in a group's stash, a player's read gathers it first; a GM's
 * read is silent. With a page, the entry is read as it was gathered.
 * @param {{ item?: Item, group?: Actor, page?: JournalEntryPage }} options
 */
export async function openReader({ item = null, group = null, page = null }) {
  try {
    if (item && group && isClue(item)) {
      page = (await gather(item, group)) ?? entryFor(clueId(item, MODULE_ID)) ?? null;
    } else if (item && !page) {
      page = entryFor(clueId(item, MODULE_ID));
    }
    if (page && !item && page.system.source.uuid) {
      const source = await fromUuid(page.system.source.uuid);
      if (source instanceof Item) item = source;
    }
    const reader = new Reader({ item, page });
    return reader.render({ force: true });
  } catch (err) {
    log.error("opening the Reader failed", err);
    ui.notifications.error(t("read.failed", { reason: err?.message ?? String(err) }));
    return null;
  }
}
