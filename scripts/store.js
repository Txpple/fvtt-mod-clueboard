/**
 * The store: a party's Mysteries live on its dnd5e Group actor, under the module's flags, and
 * nowhere else. No journal, no folder, no inventory row: nothing of it appears in a directory or
 * on a sheet; the window, the Reader and the API are the only ways to it.
 *
 *   flags.fvtt-mod-clueboard.schema            2
 *   flags.fvtt-mod-clueboard.entries.<itemId>  one entry (MysteryEntry below), keyed by the
 *                                              world Clue item it was collected from
 *   flags.fvtt-mod-clueboard.threads.<id>      one thread (Thread below): the party's own
 *                                              sorting; an entry's pins live on the entry
 *
 * Every write names the narrowest key it changes (an entry, a reader inside it, the snapshot,
 * the note), so two clients writing at once never overwrite each other. The writer must own the
 * group: the GM, or a player on a party the players own (Party Stash needs the same).
 */

import { MODULE_ID } from "./common.js";
import { entryList, KINDS, threadList } from "./decide/clue.js";

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
      notes: text(),
      threads: new fields.TypedObjectField(
        new fields.SchemaField({ at: text(), order: new fields.NumberField({ required: true, integer: true, initial: 0 }) })
      )
    };
  }
}

/** One thread: a question the party asks of its clues, with where they stand on it. */
export class Thread extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      id: new fields.StringField({ required: true, blank: false }),
      name: new fields.StringField({ required: true, blank: false }),
      colour: new fields.StringField({ required: true, blank: false, initial: "gold" }),
      question: text(),
      status: new fields.StringField({ required: true, blank: false, initial: "open", choices: ["open", "answered"] }),
      stand: text(),
      order: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      at: text(),
      by: text()
    };
  }
}

/** A plain, validated copy of an entry (throws on data the schema refuses). */
export const clean = data => new MysteryEntry(data, { strict: true }).toObject();

/** A plain, validated copy of a thread. */
export const cleanThread = data => new Thread(data, { strict: true }).toObject();

/** The flag path of an entry, or of a key inside it. */
const path = (id, key = "") => `flags.${MODULE_ID}.entries.${id}${key ? `.${key}` : ""}`;

/** The flag path of a thread, or of a key inside it. */
const tpath = (id, key = "") => `flags.${MODULE_ID}.threads.${id}${key ? `.${key}` : ""}`;

const gone = () => new foundry.data.operators.ForcedDeletion();

/** A group's threads, in the party's order (plain objects, read from the flags). */
export const threadsOf = group => threadList(group?.flags?.[MODULE_ID]?.threads);

/** One thread of a group's, or null. */
export const threadOf = (group, id) => (id ? (group?.flags?.[MODULE_ID]?.threads?.[id] ?? null) : null);

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

/* -------------------------------------------------- */
/*  Threads                                           */
/* -------------------------------------------------- */

/** A new thread, whole. */
export const createThread = (group, thread) => write(group, { [tpath(thread.id)]: cleanThread(thread) });

/** Some of a thread's fields (name, colour, question, status, stand, order). */
export const updateThread = (group, id, changes) =>
  write(group, Object.fromEntries(Object.entries(changes).map(([k, v]) => [tpath(id, k), v])));

/** A thread gone, and every pin to it on the named entries, in one write. */
export const removeThread = (group, id, entryIds) =>
  write(group, {
    [tpath(id)]: gone(),
    ...Object.fromEntries(entryIds.map(eid => [path(eid, `threads.${id}`), gone()]))
  });

/** An entry pinned to a thread (a second pin to the same thread keeps its place). */
export const pin = (group, clueId, threadId, order) =>
  write(group, { [path(clueId, `threads.${threadId}`)]: { at: new Date().toISOString(), order } });

/** An entry's pin to a thread gone. */
export const unpin = (group, clueId, threadId) => write(group, { [path(clueId, `threads.${threadId}`)]: gone() });

/** The order of a thread's pins, every entry's place in one write. */
export const setPinOrders = (group, threadId, orders) =>
  write(group, Object.fromEntries(Object.entries(orders).map(([clueId, n]) => [path(clueId, `threads.${threadId}.order`), n])));
