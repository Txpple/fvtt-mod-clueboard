/**
 * What every file of the module shares: the id, the logger, the elect, the strings. No imports
 * from the module's other files, so nothing here can be caught in an import cycle.
 */

import { createElect } from "./kit/elect.js";
import { createLogger } from "./kit/log.js";

export const MODULE_ID = "fvtt-mod-clueboard";

/** Every line opens with the module's title; debug lines need CONFIG.debug["fvtt-mod-clueboard"]. */
export const log = createLogger(MODULE_ID);

/** The one client that keeps the party's Mysteries journals (a GM chore; players cannot create journals). */
export const elect = createElect(MODULE_ID, { log });

/** A string from lang/en.json, under this module's key; with data, formatted. */
export const t = (key, data) =>
  data ? game.i18n.format(`${MODULE_ID}.${key}`, data) : game.i18n.localize(`${MODULE_ID}.${key}`);

/** A world setting of this module's. */
export const setting = key => game.settings.get(MODULE_ID, key);
