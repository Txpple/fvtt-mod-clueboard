// @ts-check
/**
 * Which cards a click leaves picked: Card Catalogue's rule (its shell/pick.js), copied by hand so each
 * module installs alone; a change to either is made in both. Pure, tested in tests/pick.test.js.
 */

/**
 * The cards picked after a click (the user: "multiselect cards so i can mass move / drag them"). A
 * plain click picks the one card; Ctrl (or Cmd) adds it or takes it out; Shift picks the run from the
 * anchor to it, in the order drawn (added to what was picked when Ctrl is held too). The anchor is
 * where the next Shift run starts.
 * @param {{ picked: Iterable<string>, anchor: string | null, key: string, order: readonly string[], ctrl?: boolean, shift?: boolean }} click
 * @returns {{ picked: Set<string>, anchor: string }}
 */
export function pickWith({ picked, anchor, key, order, ctrl = false, shift = false }) {
  const was = new Set(picked);
  if (shift && anchor && order.includes(anchor) && order.includes(key)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(key)].sort((x, y) => x - y);
    const run = order.slice(a, b + 1);
    return { picked: new Set(ctrl ? [...was, ...run] : run), anchor };
  }
  if (ctrl) {
    if (was.has(key)) was.delete(key);
    else was.add(key);
    return { picked: was, anchor: key };
  }
  return { picked: new Set([key]), anchor: key };
}

/**
 * The cards a drag carries: every picked card when the dragged one is picked, else that one alone.
 * @param {Set<string>} picked
 * @param {string} key the card dragged
 */
export const dragged = (picked, key) => (picked.has(key) && picked.size > 1 ? [...picked] : [key]);
