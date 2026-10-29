import { describe, expect, it } from "vitest";
import {
  changesSnapshot,
  clueId,
  countUngathered,
  isClue,
  resolveHolder,
  snapshotOf,
  readerList,
  sortAndFilter,
  entryList
} from "../scripts/decide/clue.js";

const loot = (value, extra = {}) => ({ type: "loot", system: { type: { value } }, ...extra });

describe("a Clue", () => {
  it("is a loot item of the clue type and nothing else", () => {
    expect(isClue(loot("clue"))).toBe(true);
    expect(isClue(loot("gear"))).toBe(false);
    expect(isClue({ type: "weapon", system: { type: { value: "clue" } } })).toBe(false);
    expect(isClue(null)).toBe(false);
  });

  it("has an id only once the flag is written", () => {
    expect(clueId(loot("clue"), "fvtt-mod-clueboard")).toBe(null);
    expect(
      clueId(loot("clue", { flags: { "fvtt-mod-clueboard": { id: "abc" } } }), "fvtt-mod-clueboard")
    ).toBe("abc");
    expect(
      clueId(loot("clue", { flags: { "fvtt-mod-clueboard": { id: "" } } }), "fvtt-mod-clueboard")
    ).toBe(null);
  });
});

describe("the snapshot", () => {
  const letter = {
    name: "Durgan's Unfinished Letter",
    img: "icons/letter.webp",
    system: {
      identified: false,
      description: { value: "<p>Sadric. You rode off…</p>" },
      unidentified: { name: "A sealed letter", description: "<p>Red wax, an axe.</p>" }
    }
  };

  it("takes the item's face as the reader sees it", () => {
    const seen = snapshotOf(letter, { identified: true, at: "2026-10-27T20:00:00.000Z" });
    expect(seen).toEqual({
      name: "Durgan's Unfinished Letter",
      img: "icons/letter.webp",
      html: "<p>Sadric. You rode off…</p>",
      at: "2026-10-27T20:00:00.000Z"
    });
  });

  it("takes the mask when the item is unidentified to the reader", () => {
    const seen = snapshotOf(letter, { identified: false, at: "x" });
    expect(seen.name).toBe("A sealed letter");
    expect(seen.html).toBe("<p>Red wax, an axe.</p>");
  });

  it("survives an item with no description", () => {
    expect(snapshotOf({ name: "A shoe" }, { at: "x" })).toEqual({
      name: "A shoe",
      img: "",
      html: "",
      at: "x"
    });
  });

  it("knows which changes touch it", () => {
    expect(changesSnapshot({ system: { description: { value: "x" } } })).toBe(true);
    expect(changesSnapshot({ name: "y" })).toBe(true);
    expect(changesSnapshot({ system: { quantity: 2 } })).toBe(false);
    expect(changesSnapshot({ flags: { a: 1 } })).toBe(false);
    expect(changesSnapshot(null)).toBe(false);
  });
});

describe("the holder", () => {
  it("is the stash when the stash carries it, whatever else does", () => {
    const h = resolveHolder([
      { actorId: "k", actorName: "Kartor" },
      { actorId: "g", actorName: "Echoes of Halruaa", isGroup: true }
    ]);
    expect(h).toEqual({ actorId: "g", actorName: "Echoes of Halruaa", left: false });
  });

  it("is the member who carries it otherwise", () => {
    expect(resolveHolder([{ actorId: "k", actorName: "Kartor" }])).toEqual({
      actorId: "k",
      actorName: "Kartor",
      left: false
    });
  });

  it("has left the party when nobody carries it, remembering the last holder", () => {
    expect(resolveHolder([], { actorId: "k", actorName: "Kartor" })).toEqual({
      left: true,
      lastHolder: "Kartor"
    });
    expect(resolveHolder([])).toEqual({ left: true, lastHolder: "" });
  });
});

describe("the Mysteries list", () => {
  const entry = (name, at, html = "", notes = "") => ({
    id: name.toLowerCase().replace(/\W+/g, "-"),
    snapshot: { name, html, at },
    notes
  });
  const names = list => list.map(e => e.snapshot.name);
  const entries = [
    entry("The Luck Shoe", "2026-10-27T19:00:00Z", "<p>a pick inside a ring</p>"),
    entry("The Wayhouse Ledger", "2026-10-27T21:00:00Z", "<p>27 Tarsakh 1385</p>", "two hands"),
    entry("Ysolde's Key", "2026-10-27T18:00:00Z")
  ];

  it("lists the newest gather first", () => {
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

  it("counts the ungathered once per id, and every unread Clue without one", () => {
    const clues = [{ id: null }, { id: null }, { id: "a" }, { id: "a" }, { id: "b" }];
    expect(countUngathered(clues, new Set(["b"]))).toBe(3);
    expect(countUngathered([], new Set())).toBe(0);
  });
});
