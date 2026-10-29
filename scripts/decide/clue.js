// @ts-check
/**
 * Clue Board's decisions that need no Foundry: what a Clue is, what a snapshot holds, where a
 * clue's holder is, and how a party's record reads as a list. Pure functions over plain
 * data, so the unit tests run them without a world.
 */

/** The loot subtype that makes an item a Clue (`system.type.value` on a dnd5e loot item). */
export const CLUE_TYPE = "clue";

/**
 * A Clue is a dnd5e loot item whose loot type is `clue`. Nothing else marks one.
 * @param {{ type?: string, system?: { type?: { value?: string } } } | null | undefined} item
 */
export function isClue(item) {
  return item?.type === "loot" && item?.system?.type?.value === CLUE_TYPE;
}

/**
 * The clue's identity, the id flag written at the first gather; null before that.
 * @param {{ flags?: Record<string, any> } | null | undefined} item
 * @param {string} moduleId
 * @returns {string | null}
 */
export function clueId(item, moduleId) {
  const id = item?.flags?.[moduleId]?.id;
  return typeof id === "string" && id.length ? id : null;
}

/**
 * What the party read: the item as it reads to the reader. An unidentified item shows its mask
 * (dnd5e's `unidentified` name and description) to a player, its true face to a GM.
 * @param {{ name?: string, img?: string, system?: any }} item
 * @param {{ identified?: boolean, at?: string }} [options]
 * @returns {{ name: string, img: string, html: string, at: string }}
 */
export function snapshotOf(item, { identified = true, at = new Date().toISOString() } = {}) {
  const sys = item?.system ?? {};
  const masked = identified === false && sys.identified === false;
  const name = (masked ? sys.unidentified?.name : null) || item?.name || "";
  const html = (masked ? sys.unidentified?.description : null) ?? sys.description?.value ?? "";
  return { name, img: item?.img ?? "", html: typeof html === "string" ? html : "", at };
}

/**
 * Whether a change to an item touches what a snapshot holds (its name, image or description).
 * @param {Record<string, any> | null | undefined} changes  The update's diff, as Foundry hands it.
 */
export function changesSnapshot(changes) {
  if (!changes || typeof changes !== "object") return false;
  if ("name" in changes || "img" in changes) return true;
  const sys = changes.system;
  if (!sys || typeof sys !== "object") return false;
  return "description" in sys || "unidentified" in sys || "identified" in sys;
}

/**
 * Where a clue is, from the actors that carry an item with its id. The party stash (a group
 * actor) wins over a member, since a Party Stash move lands the copy before it deletes the
 * source; none at all means the clue left the party.
 * @param {Array<{ actorId: string, actorName: string, isGroup?: boolean }>} carriers
 * @param {{ actorId?: string, actorName?: string } | null} [last]  The holder before the change.
 * @returns {{ actorId: string, actorName: string, left: false } | { left: true, lastHolder: string }}
 */
export function resolveHolder(carriers, last = null) {
  const group = carriers.find(c => c.isGroup);
  const found = group ?? carriers[0];
  if (found) return { actorId: found.actorId, actorName: found.actorName, left: false };
  return { left: true, lastHolder: last?.actorName ?? "" };
}

/**
 * A party's record as a list: the stored map of entries (keyed by clue id) in gather order,
 * newest first. Anything that is not an entry object is skipped.
 * @param {Record<string, any> | null | undefined} stored
 * @returns {Array<any>}
 */
export function entryList(stored) {
  if (!stored || typeof stored !== "object") return [];
  return Object.values(stored)
    .filter(e => e && typeof e === "object" && typeof e.id === "string")
    .sort((a, b) => (b.snapshot?.at ?? "").localeCompare(a.snapshot?.at ?? ""));
}

/**
 * An entry's readers in the order they read (the store keys them by actor).
 * @param {Record<string, { actorId: string, actorName: string, userId?: string, at?: string }> | null | undefined} readers
 */
export function readerList(readers) {
  if (!readers || typeof readers !== "object") return [];
  return Object.values(readers)
    .filter(r => r && typeof r === "object")
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/**
 * Entries filtered by a search string over the name, the text and the party's note, newest
 * gather first.
 * @param {Array<{ snapshot?: { name?: string, html?: string, at?: string }, notes?: string }>} entries
 * @param {string} [query]
 */
export function sortAndFilter(entries, query = "") {
  const q = query.trim().toLowerCase();
  const strip = (/** @type {string} */ html) => html.replace(/<[^>]+>/g, " ");
  return entries
    .filter(e => {
      if (!q) return true;
      const hay = `${e.snapshot?.name ?? ""} ${strip(e.snapshot?.html ?? "")} ${e.notes ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.snapshot?.at ?? "").localeCompare(a.snapshot?.at ?? ""));
}

/**
 * How many Clues in the party's hands nobody has read: a Clue with no id, or with an id no entry
 * carries, counts once per id (or per item when it has none).
 * @param {Array<{ id: string | null }>} clues  Every Clue item on the party's actors, with its id flag.
 * @param {Set<string>} gathered  The ids the party's record holds.
 */
export function countUngathered(clues, gathered) {
  const seen = new Set();
  let n = 0;
  for (const c of clues) {
    if (c.id === null) {
      n += 1;
      continue;
    }
    if (gathered.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    n += 1;
  }
  return n;
}
