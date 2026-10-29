/**
 * The store: a party's Mysteries live on its dnd5e Group actor, under the module's flags, and
 * nowhere else. No journal, no folder, no inventory row: nothing of it appears in a directory or
 * on a sheet; the window, the Reader and the API are the only ways to it.
 *
 *   flags.fvtt-mod-clueboard.schema            2
 *   flags.fvtt-mod-clueboard.entries.<itemId>  one entry (MysteryEntry below), keyed by the
 *                                              world Clue item it was collected from
 *
 * Every write names the narrowest key it changes (an entry, a reader inside it, the snapshot,
 * the note), so two clients writing at once never overwrite each other. The writer must own the
 * group: the GM, or a player on a party the players own (Party Stash needs the same).
 */

import { MODULE_ID } from "./common.js";
import { entryList, KINDS } from "./decide/clue.js";

export const SCHEMA = 2;

const { fields } = foundry.data;

const text = () => new fields.StringField({ required: true, blank: true, initial: "" });

/** One entry: the Clue as collected, where and when, who read it, the party's note. */
export class MysteryEntry extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      id: new fields.StringField({ required: true, blank: false }),
      kind: new fields.StringField({ required: true, blank: false, initial: KINDS[0], choices: KINDS }),
      source: new fields.SchemaField({ uuid: text(), name: text() }),
      snapshot: new fields.SchemaField({
        name: text(),
        img: text(),
        html: text(),
        foundAt: text(),
        revision: new fields.NumberField({ required: true, integer: true, min: 1, initial: 1 }),
        at: text()
      }),
      foundIn: new fields.SchemaField({ sceneId: text(), sceneName: text(), calendarDate: text(), realDate: text() }),
      readers: new fields.TypedObjectField(
        new fields.SchemaField({ actorId: text(), actorName: text(), userId: text(), at: text() })
      ),
      notes: text()
    };
  }
}

/** A plain, validated copy of an entry (throws on data the schema refuses). */
export const clean = data => new MysteryEntry(data, { strict: true }).toObject();

/** The flag path of an entry, or of a key inside it. */
const path = (id, key = "") => `flags.${MODULE_ID}.entries.${id}${key ? `.${key}` : ""}`;

/** A group's entries, newest collection first (plain objects, read from the flags). */
export const entriesOf = group => entryList(group?.flags?.[MODULE_ID]?.entries);

/** One entry of a group's, or null. */
export const entryOf = (group, id) => (id ? (group?.flags?.[MODULE_ID]?.entries?.[id] ?? null) : null);

/** Every Group actor in the world: each is a party with a record. */
export const groups = () => game.actors.filter(a => a.type === "group");

/** dnd5e's primary party, when the world names one. */
export function primaryParty() {
  try {
    return game.settings.get("dnd5e", "primaryParty")?.actor ?? null;
  } catch {
    return null;
  }
}

/** Every party holding an entry for a Clue, with the entry. */
export function holdersOf(id) {
  const out = [];
  for (const group of groups()) {
    const entry = entryOf(group, id);
    if (entry) out.push({ group, entry });
  }
  return out;
}

/** The first party holding an entry for a Clue, with the entry, or null. */
export const findEntry = id => holdersOf(id)[0] ?? null;

/**
 * Write to a group's record. `render: false`: a flag write has nothing to show on the group's
 * sheet, so a sheet a player has open does not redraw under them.
 */
const write = (group, changes) => group.update(changes, { render: false });

/** A new entry, whole, and the schema version beside it. */
export const createEntry = (group, entry) =>
  write(group, { [path(entry.id)]: clean(entry), [`flags.${MODULE_ID}.schema`]: SCHEMA });

/** An entry gone (the Clue item stays in the world). */
export const removeEntry = (group, id) => write(group, { [path(id)]: new foundry.data.operators.ForcedDeletion() });

/** One more reader on an entry (keyed by the actor, so a second read by the same one is a no-op). */
export const addReader = (group, id, reader) => write(group, { [path(id, `readers.${reader.actorId}`)]: reader });

/** The snapshot, whole, and the kind it carries (a Clue's kind can change after collecting). */
export const setSnapshot = (group, id, snapshot) =>
  write(group, { [path(id, "snapshot")]: snapshot, [path(id, "kind")]: snapshot.kind });

/** The party's note. */
export const setNotes = (group, id, notes) => write(group, { [path(id, "notes")]: String(notes ?? "") });
