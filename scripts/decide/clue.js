// @ts-check
/**
 * Clue Board's decisions that need no Foundry: what a Clue is, what a snapshot holds, which
 * party a drop lands in, and how a party's record reads as a list. Pure functions over plain
 * data, so the unit tests run them without a world.
 */

/** The item type the module declares (module id dot subtype, as Foundry names it). */
export const CLUE_TYPE = "fvtt-mod-clueboard.clue";

/** The kinds a Clue can be: what the party found, read or heard. More are one line each. */
export const KINDS = ["document", "object", "statement", "location", "body", "rumour", "vision"];

/**
 * A Clue is an item of the module's own type. Nothing else is one.
 * @param {{ type?: string } | null | undefined} item
 */
export function isClue(item) {
  return item?.type === CLUE_TYPE;
}

/**
 * What the party has: the Clue as it reads now. The text is the item's own; a Clue has no
 * mask, no price and no weight, so there is nothing to hide from a player.
 * @param {{ name?: string, img?: string, system?: { kind?: string, text?: string, foundAt?: string } }} item
 * @param {{ at?: string }} [options]
 * @returns {{ name: string, img: string, html: string, foundAt: string, kind: string, at: string }}
 */
export function snapshotOf(item, { at = new Date().toISOString() } = {}) {
  const sys = item?.system ?? {};
  return {
    name: item?.name ?? "",
    img: item?.img ?? "",
    html: typeof sys.text === "string" ? sys.text : "",
    foundAt: typeof sys.foundAt === "string" ? sys.foundAt : "",
    kind: KINDS.includes(sys.kind ?? "") ? /** @type {string} */ (sys.kind) : KINDS[0],
    at
  };
}

/**
 * Whether a change to a Clue touches what a snapshot holds (its name, image, text, found-at or
 * kind).
 * @param {Record<string, any> | null | undefined} changes  The update's diff, as Foundry hands it.
 */
export function changesSnapshot(changes) {
  if (!changes || typeof changes !== "object") return false;
  if ("name" in changes || "img" in changes) return true;
  const sys = changes.system;
  if (!sys || typeof sys !== "object") return false;
  return "text" in sys || "foundAt" in sys || "kind" in sys;
}

/**
 * The party a Clue dropped on an actor belongs to: the actor itself when it is a group, else the
 * group the actor is a member of, else the primary party, else the only party; null when none
 * of those decides (several parties and no primary).
 * @param {{ id: string, isGroup: boolean }} actor
 * @param {Array<{ id: string, memberIds: string[] }>} groups
 * @param {string | null} [primaryId]
 * @returns {string | null}  The group's id.
 */
export function partyFor(actor, groups, primaryId = null) {
  if (actor.isGroup) return actor.id;
  const member = groups.find(g => g.memberIds.includes(actor.id));
  if (member) return member.id;
  return defaultParty(groups, primaryId);
}

/**
 * The party when none is named: the primary party when the world has one, else the only
 * party, else null.
 * @param {Array<{ id: string }>} groups
 * @param {string | null} [primaryId]
 */
export function defaultParty(groups, primaryId = null) {
  if (primaryId && groups.some(g => g.id === primaryId)) return primaryId;
  return groups.length === 1 ? groups[0].id : null;
}

/**
 * A party's record as a list: the stored map of entries (keyed by the Clue's id) newest
 * collection first. Anything that is not an entry object is skipped.
 * @param {Record<string, any> | null | undefined} stored
 * @returns {Array<any>}
 */
export function entryList(stored) {
  if (!stored || typeof stored !== "object") return [];
  return Object.values(stored)
    .filter(e => e && typeof e === "object" && typeof e.id === "string")
    .sort((a, b) => (b.foundIn?.realDate ?? "").localeCompare(a.foundIn?.realDate ?? ""));
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
 * Entries filtered by a search string over the name, the text, the found-at line and the
 * party's note, newest collection first.
 * @param {Array<{ snapshot?: { name?: string, html?: string, foundAt?: string }, foundIn?: { realDate?: string }, notes?: string }>} entries
 * @param {string} [query]
 */
export function sortAndFilter(entries, query = "") {
  const q = query.trim().toLowerCase();
  const strip = (/** @type {string} */ html) => html.replace(/<[^>]+>/g, " ");
  return entries
    .filter(e => {
      if (!q) return true;
      const s = e.snapshot ?? {};
      const hay = `${s.name ?? ""} ${strip(s.html ?? "")} ${s.foundAt ?? ""} ${e.notes ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.foundIn?.realDate ?? "").localeCompare(a.foundIn?.realDate ?? ""));
}

/**
 * How many entries are unread: by a given character (its actor id), or by anyone when none is
 * given (the GM's count).
 * @param {Array<{ readers?: Record<string, any> }>} entries
 * @param {string | null} [actorId]
 */
export function unreadCount(entries, actorId = null) {
  let n = 0;
  for (const e of entries) {
    const readers = e.readers && typeof e.readers === "object" ? e.readers : {};
    const read = actorId ? actorId in readers : Object.keys(readers).length > 0;
    if (!read) n += 1;
  }
  return n;
}
