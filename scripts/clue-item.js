/**
 * The Clue: an item type of the module's own, declared in module.json and given its data model
 * and sheet here. A Clue lives in the Items directory (or a compendium) as the DM's master copy;
 * it is never gear, so it has no price, weight, quantity or activity, and dnd5e refuses it on an
 * actor, which is the point: collecting a Clue puts it on the party's record, never in a bag.
 */

import { log, MODULE_ID, t } from "./common.js";
import { KINDS } from "./decide/clue.js";
import { collect, holdersOf, partiesForCollect, uncollect } from "./mysteries.js";

const { fields } = foundry.data;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const ItemSheetV2 = foundry.applications.sheets.ItemSheetV2;

export class ClueItemModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: new fields.StringField({ required: true, blank: false, initial: KINDS[0], choices: KINDS }),
      text: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      foundAt: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }
}

export class ClueItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["clueboard-clue-sheet"],
    window: { icon: "fa-solid fa-scroll", resizable: true, contentClasses: ["standard-form"] },
    position: { width: 540, height: "auto" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      collect: ClueItemSheet.#onCollect,
      uncollect: ClueItemSheet.#onUncollect
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/clue-item.hbs`, scrollable: [".clueboard-clue-text"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    context.item = item;
    context.uuid = item.uuid;
    context.name = item.name;
    context.img = item.img;
    context.editable = this.isEditable;
    context.text = item.system.text;
    context.textHTML = await TextEditor.enrichHTML(item.system.text ?? "", { secrets: game.user.isGM, relativeTo: item });
    context.foundAt = item.system.foundAt;
    context.kind = item.system.kind;
    context.kinds = KINDS.map(k => ({ value: k, label: t(`kinds.${k}`), selected: k === item.system.kind }));
    context.inWorld = !item.pack && !item.parent;
    context.holders = holdersOf(item.id).map(({ group, entry }) => ({
      groupId: group.id,
      groupName: group.name,
      readers: Object.values(entry.readers ?? {}).map(r => r.actorName)
    }));
    context.canCollect = game.user.isGM;
    context.parties = partiesForCollect().filter(g => !context.holders.some(h => h.groupId === g.id));
    return context;
  }

  static async #onCollect(_event, target) {
    const group = game.actors.get(target.dataset.group);
    if (!group) return;
    await collect(this.document, group, { how: "sheet" });
    this.render();
  }

  static async #onUncollect(_event, target) {
    const group = game.actors.get(target.dataset.group);
    if (!group) return;
    await uncollect(group, this.document.id);
    this.render();
  }
}

/** Register the type's model, sheet and default artwork (at init). */
export function registerClueItem(type) {
  CONFIG.Item.dataModels[type] = ClueItemModel;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, ClueItemSheet, {
    types: [type],
    makeDefault: true,
    label: `${MODULE_ID}.sheet`
  });
  // dnd5e's Create Item dialog and a new Clue take their icon from this table.
  const artwork = CONFIG.DND5E?.defaultArtwork?.Item;
  if (artwork) artwork[type] = "icons/sundries/documents/document-sealed-red-tan.webp";
  else log.warn("CONFIG.DND5E.defaultArtwork not found: a new Clue takes Foundry's default icon.");
}
