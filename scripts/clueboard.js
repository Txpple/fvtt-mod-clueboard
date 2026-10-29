/**
 * Open Roll 5e: Clue Board — the entry point (module.json's `esmodules`).
 *
 * Three things: a Clue item type of the module's own (clue-item.js), collecting (a drop on the
 * party, a member or the Mysteries window, or Collect on the sheet or in the window's GM strip),
 * and the Mysteries window, opened from a scroll button on the sidebar's strip directly after
 * Journal (a button, not a sidebar tab: nothing of the module's is drawn inside the sidebar).
 * Nothing here touches an inventory, a character sheet or an item card. The plan is the suite's
 * docs/plans/clueboard.md.
 *
 * The party's record lives on its Group actor (store.js); the GM collects, the reader's own client
 * marks the read, on a party the players own; no elect, no journal, no GM chore. The kit
 * (scripts/kit/, byte-identical across the family) gives the module its logger (common.js).
 */

import { registerClueItem } from "./clue-item.js";
import { log, MODULE_ID, setting, t } from "./common.js";
import { changesSnapshot, CLUE_TYPE, isClue } from "./decide/clue.js";
import * as mysteries from "./mysteries.js";
import { openReader, refreshReaders } from "./reader.js";

export { MODULE_ID, log, t, setting };

const BUTTON_ID = "clueboard-mysteries-button";

/* -------------------------------------------------- */
/*  init: the setting, the Clue type, the templates   */
/* -------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: `${MODULE_ID}.settings.enabled.name`,
    hint: `${MODULE_ID}.settings.enabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // The Clue type exists whether or not the module is enabled, so a world that holds Clues never
  // sees them as an unknown type.
  registerClueItem(CLUE_TYPE);

  if (!setting("enabled")) return;

  const load = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  load([
    `modules/${MODULE_ID}/templates/reader.hbs`,
    `modules/${MODULE_ID}/templates/mysteries.hbs`,
    `modules/${MODULE_ID}/templates/clue-item.hbs`
  ]).catch(err => log.error("preloading the templates failed", err));
});

/* -------------------------------------------------- */
/*  A Clue dropped on an actor is collected, never carried */
/* -------------------------------------------------- */

/**
 * The actor sheet asks before it does anything with a drop. A Clue dropped on the party, or on
 * a member, goes to the party's record; the sheet never sees it, so no inventory ever holds one.
 * The DM's gesture; a player cannot see a world Clue to drag it.
 */
Hooks.on("dropActorSheetData", (actor, _sheet, data) => {
  try {
    if (!setting("enabled") || data?.type !== "Item" || !data.uuid) return;
    const doc = fromUuidSync(data.uuid);
    if (doc?.type !== CLUE_TYPE) return;
    void (async () => {
      const item = await fromUuid(data.uuid);
      const group = mysteries.partyOf(actor) ?? (await mysteries.pickParty());
      if (item && group) await mysteries.collect(item, group, { how: "drop" });
    })();
    return false;
  } catch (err) {
    log.error("handling a dropped Clue failed", err);
  }
});

/** Belt and braces: a Clue created inside any actor by another path is refused, with a word. */
Hooks.on("preCreateItem", (item, _data, _options, userId) => {
  if (!isClue(item) || !item.parent) return;
  if (userId === game.user.id) ui.notifications.warn(t("collect.neverCarried"));
  return false;
});

/* -------------------------------------------------- */
/*  The record follows the DM's Clue; the window and the Readers follow the record */
/* -------------------------------------------------- */

/** Only the client that made the change writes, so an edit lands one write, not one per client. */
const mine = userId => userId === game.user.id;

Hooks.on("updateItem", (item, changes, _options, userId) => {
  if (!isClue(item) || item.parent) return;
  if (mine(userId) && setting("enabled") && changesSnapshot(changes)) {
    mysteries.refreshSnapshot(item).catch(err => log.error("refreshing a Clue's snapshot failed", err));
  }
  mysteries.MysteriesWindow.refresh();
});

/** The world's Clues changed: the GM strip follows. */
for (const hook of ["createItem", "deleteItem"]) {
  Hooks.on(hook, item => {
    if (isClue(item) && !item.parent) mysteries.MysteriesWindow.refresh();
  });
}

/** A party's record changed (on any client): redraw what shows it. */
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "group" || !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
  mysteries.MysteriesWindow.refresh();
  refreshReaders(actor);
  for (const app of foundry.applications.instances.values()) {
    if (app.constructor.name === "ClueItemSheet" && app.rendered) app.render();
  }
});

/** A party made or removed changes the window's sections. */
for (const hook of ["createActor", "deleteActor"]) {
  Hooks.on(hook, actor => {
    if (actor.type === "group") mysteries.MysteriesWindow.refresh();
  });
}

/* -------------------------------------------------- */
/*  The scroll button on the sidebar's strip          */
/* -------------------------------------------------- */

/**
 * One button on the sidebar's strip, directly after Journal, that opens the Mysteries window in
 * the middle of the screen. It is not a tab: no `data-tab`, no `data-action`, so the sidebar
 * never switches, expands or draws anything for it. The strip is drawn on the sidebar's first
 * render; a later render finds the button already there.
 */
Hooks.on("renderSidebar", app => {
  try {
    if (!setting("enabled")) return;
    const menu = app.element?.querySelector("#sidebar-tabs menu, nav.tabs menu");
    if (!menu || menu.querySelector(`#${BUTTON_ID}`)) return;
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = BUTTON_ID;
    button.className = "ui-control plain icon fa-solid fa-scroll";
    button.dataset.tooltip = "";
    button.setAttribute("aria-label", t("tab"));
    button.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      mysteries.MysteriesWindow.open();
    });
    li.append(button);
    const journal = menu.querySelector('[data-tab="journal"]')?.closest("li");
    if (journal) journal.after(li);
    else menu.lastElementChild?.before(li);
  } catch (err) {
    log.error("adding the Mysteries button failed", err);
  }
});

/* -------------------------------------------------- */
/*  ready: the stylesheet probe and the API           */
/* -------------------------------------------------- */

/**
 * Party Stash's probe: Foundry v14 bundles module CSS, so the honest question is whether a rule
 * of ours reaches an element. The probe class gives `flex-direction: column`, which no bare div
 * has; when it does not, the stylesheet is loaded directly.
 */
Hooks.once("ready", () => {
  try {
    const probe = document.createElement("div");
    probe.className = "clueboard-css-probe";
    document.body.append(probe);
    const applied = getComputedStyle(probe).flexDirection === "column";
    probe.remove();
    if (!applied && !document.querySelector(`link[data-${MODULE_ID}-fallback]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `modules/${MODULE_ID}/styles/clueboard.css`;
      link.setAttribute(`data-${MODULE_ID}-fallback`, "true");
      document.head.append(link);
      log.warn("the manifest stylesheet is not in the cascade; loading it directly.");
    }
  } catch (err) {
    log.error("the stylesheet probe failed", err);
  }

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      CLUE_TYPE,
      isClue,
      collect: mysteries.collect,
      uncollect: mysteries.uncollect,
      markRead: mysteries.markRead,
      openReader,
      openMysteries: () => mysteries.MysteriesWindow.open(),
      entries: mysteries.entriesOf,
      entry: mysteries.entryOf,
      findEntry: mysteries.findEntry,
      parties: mysteries.groups
    };
  }
});
