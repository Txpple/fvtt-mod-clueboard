/**
 * The Mysteries entry: a JournalEntryPage of the module's type, and its sheet. The page is the
 * record (the snapshot as read, the stamp, the readers, the holder, the party's note); the sheet
 * shows it inside the journal and lets an owner edit the note.
 */

import { MODULE_ID, t } from "./common.js";
import { holderText } from "./mysteries.js";

const { fields } = foundry.data;

export class ClueModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const reader = () =>
      new fields.SchemaField({
        actorId: new fields.StringField({ required: true, blank: true, initial: "" }),
        actorName: new fields.StringField({ required: true, blank: true, initial: "" }),
        userId: new fields.StringField({ required: true, blank: true, initial: "" }),
        at: new fields.StringField({ required: true, blank: true, initial: "" })
      });
    return {
      id: new fields.StringField({ required: true, blank: false }),
      source: new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: true, initial: "" }),
        name: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      snapshot: new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        img: new fields.FilePathField({ categories: ["IMAGE"], required: false, blank: true }),
        html: new fields.HTMLField({ required: true, blank: true, initial: "" }),
        revision: new fields.NumberField({ required: true, integer: true, min: 1, initial: 1 }),
        at: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      foundIn: new fields.SchemaField({
        sceneId: new fields.StringField({ required: true, blank: true, initial: "" }),
        sceneName: new fields.StringField({ required: true, blank: true, initial: "" }),
        calendarDate: new fields.StringField({ required: true, blank: true, initial: "" }),
        realDate: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      readers: new fields.ArrayField(reader()),
      holder: new fields.SchemaField({
        actorId: new fields.StringField({ required: true, blank: true, initial: "" }),
        actorName: new fields.StringField({ required: true, blank: true, initial: "" }),
        left: new fields.BooleanField({ initial: false }),
        lastHolder: new fields.StringField({ required: true, blank: true, initial: "" }),
        at: new fields.StringField({ required: true, blank: true, initial: "" })
      }),
      notes: new fields.StringField({ required: true, blank: true, initial: "" }),
      tags: new fields.ArrayField(new fields.StringField({ blank: false }))
    };
  }
}

const Base = foundry.applications.sheets.journal.JournalEntryPageHandlebarsSheet;

export class ClueSheet extends Base {
  static DEFAULT_OPTIONS = {
    classes: ["clueboard-page"]
  };

  static EDIT_PARTS = {
    header: Base.EDIT_PARTS.header,
    content: { template: `modules/${MODULE_ID}/templates/clue-page-edit.hbs` },
    footer: Base.EDIT_PARTS.footer
  };

  static VIEW_PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/clue-page-view.hbs`, root: true }
  };

  /** @override */
  async _prepareContentContext(context, _options) {
    const sys = this.page.system;
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    context.html = await TextEditor.enrichHTML(sys.snapshot.html ?? "", { secrets: game.user.isGM, relativeTo: this.page });
    context.img = sys.snapshot.img;
    context.revision = sys.snapshot.revision > 1 ? t("read.revision", { n: sys.snapshot.revision }) : "";
    context.stamp = {
      foundIn: sys.foundIn.sceneName,
      calendarDate: sys.foundIn.calendarDate,
      realDate: sys.foundIn.realDate ? new Date(sys.foundIn.realDate).toLocaleDateString() : "",
      readers: sys.readers.map(r => ({ name: r.actorName, me: r.userId === game.user.id })),
      holder: holderText(sys.holder),
      left: sys.holder.left,
      notes: sys.notes
    };
    context.notesField = this.page.system.schema.fields.notes;
    context.notes = sys.notes;
  }
}
