// @ts-check
/**
 * Clue Board's decisions that need no Foundry: what a Clue is, what a snapshot holds, where a
 * clue's holder is, and how the sidebar's tab table takes a new entry. Pure functions over plain
 * data, so the unit tests run them without a world.
 */

/** The loot subtype that makes an item a Clue (`system.type.value` on a dnd5e loot item). */
export const CLUE_TYPE = "clue";

/** The journal page type the module registers (module id dot subtype). */
export const PAGE_TYPE = "fvtt-mod-clueboard.clue";

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
 * The entries of a Mysteries journal, newest gather first, filtered by a search string over
 * name, text and notes.
 * @param {Array<{ name: string, system: { snapshot?: { html?: string, at?: string }, notes?: string } }>} entries
 * @param {string} [query]
 */
export function sortAndFilter(entries, query = "") {
  const q = query.trim().toLowerCase();
  const strip = (/** @type {string} */ html) => html.replace(/<[^>]+>/g, " ");
  return entries
    .filter(e => {
      if (!q) return true;
      const hay = `${e.name} ${strip(e.system?.snapshot?.html ?? "")} ${e.system?.notes ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.system?.snapshot?.at ?? "").localeCompare(a.system?.snapshot?.at ?? ""));
}

/**
 * How many Clues in the party's hands nobody has read: a Clue with no id, or with an id no entry
 * carries, counts once per id (or per item when it has none).
 * @param {Array<{ id: string | null }>} clues  Every Clue item on the party's actors, with its id flag.
 * @param {Set<string>} gathered  The ids the journal holds.
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
