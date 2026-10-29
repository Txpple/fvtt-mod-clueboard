/**
 * Open Roll 5e: Clue Board — the entry point (module.json's `esmodules`).
 *
 * Phase 1 is three things: a Clue loot type (a `CONFIG.DND5E.lootTypes` entry, the one signifier),
 * a Read button on the party stash's rows (the one trigger into Mysteries) and the Mysteries
 * window, opened from a scroll button on the sidebar's strip directly after Journal (a button, not
 * a sidebar tab: nothing of the module's is drawn inside the sidebar). Nothing here touches a character sheet, an item card or an
 * item sheet. The plan is the suite's docs/plans/clueboard.md.
 *
 * The party's record lives on its Group actor (store.js), written by the reader's own client on a
 * party the players own; there is no journal, no document type and no GM chore. The kit
 * (scripts/kit/, byte-identical across the family) gives the module its logger (common.js).
 */

import { log, MODULE_ID, setting, t } from "./common.js";
import { changesSnapshot, CLUE_TYPE, clueId, isClue } from "./decide/clue.js";
import * as mysteries from "./mysteries.js";
import { openReader, refreshReaders } from "./reader.js";

export { MODULE_ID, log, t, setting };

const COLUMN_ID = "clueboardRead";
const BUTTON_ID = "clueboard-mysteries-button";

/* -------------------------------------------------- */
/*  init: settings and the loot type                  */
/* -------------------------------------------------- */

Hooks.once("init", () => {
  for (const [key, def] of Object.entries({ enabled: true, showMark: true, countUngathered: true })) {
    game.settings.register(MODULE_ID, key, {
      name: `${MODULE_ID}.settings.${key}.name`,
      hint: `${MODULE_ID}.settings.${key}.hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: def,
      requiresReload: key === "enabled"
    });
  }

  if (!setting("enabled")) return;

  // The Clue loot type. dnd5e localizes every lootTypes label at i18nInit, ours with them.
  if (CONFIG.DND5E?.lootTypes) {
    CONFIG.DND5E.lootTypes[CLUE_TYPE] ??= { label: `${MODULE_ID}.lootType` };
  } else {
    log.error("CONFIG.DND5E.lootTypes not found: the Clue loot type is not registered (dnd5e 5.x required).");
  }

  const load = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  load([
    `modules/${MODULE_ID}/templates/read-column.hbs`,
    `modules/${MODULE_ID}/templates/reader.hbs`,
    `modules/${MODULE_ID}/templates/mysteries.hbs`
  ]).catch(err => log.error("preloading the templates failed", err));
});

/* -------------------------------------------------- */
/*  setup: the Read column on the group sheet         */
/* -------------------------------------------------- */

Hooks.once("setup", () => {
  if (!setting("enabled")) return;
  const Group = globalThis.dnd5e?.applications?.actor?.GroupActorSheet;
  if (!Group) {
    log.error("dnd5e GroupActorSheet not found: no Read column (dnd5e 5.x required).");
    return;
  }
  // Party Stash's way (its Take column, order 1100): appended to the sheet's own section
  // columns so the system's grid lays it out, past the controls column, at priority 1000 so
  // the system's own columns give way first as the sheet narrows. The width rule in
  // clueboard.css is required: a column id without CSS collapses to zero width.
  const origSections = Group.prototype._configureInventorySections;
  Group.prototype._configureInventorySections = async function (sections) {
    await origSections?.call(this, sections);
    try {
      const column = {
        id: COLUMN_ID,
        width: 84,
        order: 1150,
        priority: 1000,
        label: "",
        template: `modules/${MODULE_ID}/templates/read-column.hbs`
      };
      for (const s of sections) if (Array.isArray(s.columns)) s.columns = [...s.columns, column];
    } catch (err) {
      log.error("adding the Read column failed", err);
    }
  };
});

/** The Read buttons and the bookmark on a group sheet's rows. */
Hooks.on("renderGroupActorSheet", (app, element) => {
  try {
    if (!setting("enabled")) return;
    const group = app.document;
    if (group?.type !== "group") return;
    const root = element instanceof HTMLElement ? element : app.element;
    const showMark = game.user.isGM || setting("showMark");
    for (const row of root?.querySelectorAll(".item[data-item-id]") ?? []) {
      const item = group.items.get(row.dataset.itemId);
      if (!item) continue;
      const button = row.querySelector("button.clueboard-read-button:not([data-wired])");
      if (button) {
        button.dataset.wired = "true";
        button.addEventListener("click", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          void openReader({ item, group });
        });
      }
      if (showMark && isClue(item) && !row.querySelector(".clueboard-mark")) {
        const title = row.querySelector(".item-name .name .title") ?? row.querySelector(".item-name .name");
        if (title) {
          const mark = document.createElement("i");
          mark.className = "fa-solid fa-bookmark clueboard-mark";
          mark.inert = true;
          mark.dataset.tooltip = t("mysteries.markTooltip");
          title.append(mark);
        }
      }
    }
  } catch (err) {
    log.error("wiring the group sheet failed", err);
  }
});

/* -------------------------------------------------- */
/*  The holder follows the item; the snapshot follows the text */
/* -------------------------------------------------- */

/** Only the client that made the change writes, so a move lands one write, not one per client. */
const mine = userId => userId === game.user.id;

Hooks.on("createItem", (item, _options, userId) => {
  if (!mine(userId) || !setting("enabled")) return;
  const id = isClue(item) ? clueId(item, MODULE_ID) : null;
  if (!id || mysteries.isHandOffRow(item)) return;
  mysteries.followHolder(id).catch(err => log.error("following a created Clue failed", err));
});

Hooks.on("deleteItem", (item, _options, userId) => {
  if (!mine(userId) || !setting("enabled")) return;
  const id = isClue(item) ? clueId(item, MODULE_ID) : null;
  if (!id) return;
  mysteries.followHolder(id, item.parent).catch(err => log.error("following a deleted Clue failed", err));
});

Hooks.on("updateItem", (item, changes, _options, userId) => {
  if (!mine(userId) || !setting("enabled")) return;
  const id = isClue(item) ? clueId(item, MODULE_ID) : null;
  if (!id || !changesSnapshot(changes)) return;
  mysteries.refreshSnapshot(id, item).catch(err => log.error("refreshing a Clue's snapshot failed", err));
});

/* -------------------------------------------------- */
/*  The window and the Readers follow the record      */
/* -------------------------------------------------- */

/** A party's record changed (on any client): redraw what shows it. */
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "group" || !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
  mysteries.MysteriesWindow.refresh();
  refreshReaders(actor);
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
      clueId: item => clueId(item, MODULE_ID),
      openReader,
      openMysteries: () => mysteries.MysteriesWindow.open(),
      gather: mysteries.gather,
      entries: mysteries.entriesOf,
      entry: mysteries.entryOf,
      findEntry: mysteries.findEntry
    };
  }
});
