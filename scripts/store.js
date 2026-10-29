/**
 * The store: a party's Mysteries live on its dnd5e Group actor, under the module's flags, and
 * nowhere else. No journal, no folder, no document type: nothing of it appears in a directory or
 * on a sheet; the window, the Reader and the API are the only ways to it.
 *
 *   flags.fvtt-mod-clueboard.schema            1
 *   flags.fvtt-mod-clueboard.entries.<clueId>  one entry (MysteryEntry below)
 *
 * Every write names the narrowest key it changes (an entry, a reader inside it, the holder, the
 * note), so two players reading at once land two writes that never overwrite each other. The
 * writer must own the group; the players own the party, which Party Stash needs as well.
 */

import { MODULE_ID } from "./common.js";
import { entryList } from "./decide/clue.js";

export const SCHEMA = 1;

const { fields } = foundry.data;

const text = () => new fields.StringField({ required: true, blank: true, initial: "" });

/** One entry: the clue as read, where and when, who read it, who holds it, the party's note. */
export class MysteryEntry extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      id: new fields.StringField({ required: true, blank: false }),
      source: new fields.SchemaField({ uuid: text(), name: text() }),
      snapshot: new fields.SchemaField({
        name: text(),
        img: text(),
        html: text(),
        revision: new fields.NumberField({ required: true, integer: true, min: 1, initial: 1 }),
        at: text()
      }),
      foundIn: new fields.SchemaField({ sceneId: text(), sceneName: text(), calendarDate: text(), realDate: text() }),
      readers: new fields.TypedObjectField(
        new fields.SchemaField({ actorId: text(), actorName: text(), userId: text(), at: text() })
      ),
      holder: new fields.SchemaField({
        actorId: text(),
        actorName: text(),
        left: new fields.BooleanField({ initial: false }),
        lastHolder: text(),
        at: text()
      }),
      notes: text()
    };
  }
}

/** A plain, validated copy of an entry (throws on data the schema refuses). */
export const clean = data => new MysteryEntry(data, { strict: true }).toObject();

/** The flag path of an entry, or of a key inside it. */
const path = (id, key = "") => `flags.${MODULE_ID}.entries.${id}${key ? `.${key}` : ""}`;

/** A group's entries, newest gather first (plain objects, read from the flags). */
export const entriesOf = group => entryList(group?.flags?.[MODULE_ID]?.entries);

/** One entry of a group's, or null. */
export const entryOf = (group, id) => (id ? (group?.flags?.[MODULE_ID]?.entries?.[id] ?? null) : null);

/** Every Group actor in the world: each is a party with a stash and a record. */
export const groups = () => game.actors.filter(a => a.type === "group");

/** The entry carrying a clue id, in any party's record, with its group. */
export function findEntry(id) {
  if (!id) return null;
  for (const group of groups()) {
    const entry = entryOf(group, id);
    if (entry) return { group, entry };
  }
  return null;
}

/**
 * Write to a group's record. `render: false`: a flag write has nothing to show on the group's
 * sheet, so the stash a player is reading from does not redraw under them.
 */
const write = (group, changes) => group.update(changes, { render: false });

/** A new entry, whole. */
export const createEntry = (group, entry) =>
  write(group, { [path(entry.id)]: clean(entry), [`flags.${MODULE_ID}.schema`]: SCHEMA });

/** One more reader on an entry (keyed by the actor, so a second read by the same one is a no-op). */
export const addReader = (group, id, reader) => write(group, { [path(id, `readers.${reader.actorId}`)]: reader });

/** The holder, whole. */
export const setHolder = (group, id, holder) => write(group, { [path(id, "holder")]: holder });

/** The snapshot, whole. */
export const setSnapshot = (group, id, snapshot) => write(group, { [path(id, "snapshot")]: snapshot });

/** The party's note. */
export const setNotes = (group, id, notes) => write(group, { [path(id, "notes")]: String(notes ?? "") });
