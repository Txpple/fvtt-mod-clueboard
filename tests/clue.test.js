import { describe, expect, it } from "vitest";
import {
  changesSnapshot,
  CLUE_TYPE,
  defaultParty,
  entryList,
  isClue,
  KINDS,
  nextColour,
  partyFor,
  pinnedTo,
  readerList,
  reorder,
  snapshotOf,
  sortAndFilter,
  THREAD_COLOURS,
  threadList,
  unreadCount,
  unsorted
} from "../scripts/decide/clue.js";

describe("what a Clue is", () => {
  it("is an item of the module's own type, nothing else", () => {
    expect(isClue({ type: CLUE_TYPE })).toBe(true);
    expect(isClue({ type: "loot", system: { type: { value: "clue" } } })).toBe(false);
    expect(isClue(null)).toBe(false);
  });

  it("snapshots the name, image, text, found-at and kind, with a default kind", () => {
    const item = {
      name: "Hollis's Note",
      img: "icons/x.webp",
      system: { kind: "document", text: "<p>Marit.</p>", foundAt: "the child's bed" }
    };
    expect(snapshotOf(item, { at: "2026-10-29T12:00:00Z" })).toEqual({
      name: "Hollis's Note",
      img: "icons/x.webp",
      html: "<p>Marit.</p>",
      foundAt: "the child's bed",
      kind: "document",
      at: "2026-10-29T12:00:00Z"
    });
    expect(snapshotOf({ name: "x", system: { kind: "gossip" } }).kind).toBe(KINDS[0]);
    expect(snapshotOf({ name: "x", system: { text: 3 } }).html).toBe("");
  });

  it("knows which changes touch the snapshot", () => {
    expect(changesSnapshot({ name: "x" })).toBe(true);
    expect(changesSnapshot({ img: "x" })).toBe(true);
    expect(changesSnapshot({ system: { text: "<p>x</p>" } })).toBe(true);
    expect(changesSnapshot({ system: { foundAt: "x" } })).toBe(true);
    expect(changesSnapshot({ system: { kind: "document" } })).toBe(true);
    expect(changesSnapshot({ sort: 1 })).toBe(false);
    expect(changesSnapshot({ flags: { x: 1 } })).toBe(false);
    expect(changesSnapshot(null)).toBe(false);
  });
});

describe("which party a drop lands in", () => {
  const groups = [
    { id: "party", memberIds: ["kartor", "cecil"] },
    { id: "rivals", memberIds: ["vex"] }
  ];

  it("takes the group itself, else the member's group", () => {
    expect(partyFor({ id: "rivals", isGroup: true }, groups)).toBe("rivals");
    expect(partyFor({ id: "cecil", isGroup: false }, groups)).toBe("party");
    expect(partyFor({ id: "vex", isGroup: false }, groups)).toBe("rivals");
  });

  it("falls back to the primary party, then the only party, else nothing", () => {
    expect(partyFor({ id: "npc", isGroup: false }, groups, "rivals")).toBe("rivals");
    expect(partyFor({ id: "npc", isGroup: false }, groups, "gone")).toBe(null);
    expect(partyFor({ id: "npc", isGroup: false }, groups)).toBe(null);
    expect(partyFor({ id: "npc", isGroup: false }, [groups[0]])).toBe("party");
    expect(defaultParty([], null)).toBe(null);
  });
});

describe("the Mysteries list", () => {
  const entry = (name, at, html = "", notes = "", readers = {}) => ({
    id: name.toLowerCase().replace(/\W+/g, "-"),
    snapshot: { name, html, foundAt: "" },
    foundIn: { realDate: at },
    readers,
    notes
  });
  const entries = [
    entry("The Luck Shoe", "2026-10-27T19:00:00Z", "<p>a pick inside a ring</p>"),
    entry("The Wayhouse Ledger", "2026-10-27T21:00:00Z", "<p>27 Tarsakh 1385</p>", "two hands", {
      cecil: { actorId: "cecil" }
    }),
    entry("Ysolde's Key", "2026-10-27T18:00:00Z", "", "", { kartor: { actorId: "kartor" } })
  ];
  const names = list => list.map(e => e.snapshot.name);

  it("lists the newest collection first", () => {
    expect(names(sortAndFilter(entries))).toEqual([
      "The Wayhouse Ledger",
      "The Luck Shoe",
      "Ysolde's Key"
    ]);
  });

  it("searches names, text and notes, ignoring tags and case", () => {
    expect(names(sortAndFilter(entries, "RING"))).toEqual(["The Luck Shoe"]);
    expect(names(sortAndFilter(entries, "two hands"))).toEqual(["The Wayhouse Ledger"]);
    expect(sortAndFilter(entries, "<p>")).toEqual([]);
  });

  it("reads the stored map as a list, newest first, skipping what is not an entry", () => {
    const stored = Object.fromEntries(entries.map(e => [e.id, e]));
    expect(names(entryList({ ...stored, junk: 3, none: null, noid: { snapshot: {} } }))).toEqual([
      "The Wayhouse Ledger",
      "The Luck Shoe",
      "Ysolde's Key"
    ]);
    expect(entryList(undefined)).toEqual([]);
    expect(entryList("x")).toEqual([]);
  });

  it("lists the readers in the order they read", () => {
    const readers = {
      b: { actorId: "b", actorName: "Cecil", at: "2026-10-28T02:00:00Z" },
      a: { actorId: "a", actorName: "Kartor", at: "2026-10-28T01:00:00Z" }
    };
    expect(readerList(readers).map(r => r.actorName)).toEqual(["Kartor", "Cecil"]);
    expect(readerList(null)).toEqual([]);
  });

  it("counts the unread by a character, or by anyone", () => {
    expect(unreadCount(entries, "kartor")).toBe(2);
    expect(unreadCount(entries, "cecil")).toBe(2);
    expect(unreadCount(entries, null)).toBe(1);
    expect(unreadCount([], "kartor")).toBe(0);
  });
});

describe("threads", () => {
  const e = (id, threads = {}, at = "2026-10-29T10:00:00Z") => ({
    id,
    threads,
    foundIn: { realDate: at }
  });

  it("lists threads in the party's order, then by name", () => {
    const stored = {
      b: { id: "b", name: "B", order: 2 },
      a: { id: "a", name: "A", order: 2 },
      c: { id: "c", name: "C", order: 1 },
      junk: 3
    };
    expect(threadList(stored).map(t => t.id)).toEqual(["c", "a", "b"]);
    expect(threadList(null)).toEqual([]);
  });

  it("gives a new thread the least-used colour, in palette order", () => {
    expect(nextColour([])).toBe(THREAD_COLOURS[0]);
    expect(nextColour([{ colour: "gold" }])).toBe("red");
    expect(nextColour(THREAD_COLOURS.map(colour => ({ colour })))).toBe("gold");
    expect(nextColour([{ colour: "gold" }, { colour: "gold" }, { colour: "red" }])).toBe("blue");
  });

  it("finds what is pinned to a thread, in its order, and what is unsorted", () => {
    const entries = [
      e("x", { t1: { order: 2 } }),
      e("y", { t1: { order: 1 }, t2: { order: 0 } }),
      e("z"),
      e("w", {})
    ];
    expect(pinnedTo(entries, "t1").map(x => x.id)).toEqual(["y", "x"]);
    expect(pinnedTo(entries, "t2").map(x => x.id)).toEqual(["y"]);
    expect(unsorted(entries).map(x => x.id)).toEqual(["z", "w"]);
  });

  it("moves an id before another, or to the end, without touching the list", () => {
    const ids = ["a", "b", "c", "d"];
    expect(reorder(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(reorder(ids, "a", null)).toEqual(["b", "c", "d", "a"]);
    expect(reorder(ids, "a", "nope")).toEqual(["b", "c", "d", "a"]);
    expect(reorder(ids, "b", "b")).toEqual(["a", "b", "c", "d"]);
    expect(reorder(ids, "q", "b")).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});
