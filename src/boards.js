// The package's pure functions: a board in, a board out, as saved. They need no DOM and run in Node.
// The canonical model they work on inside (model.js) never leaves the package.

import * as M from "./model.js";
import { layout, withLayers } from "./layout.js";

/**
 * Checks a board (object or JSON text) and never throws: `{ ok, errors, warnings }`, the same
 * findings Atlas reports, also for text that is not JSON or a board of the wrong shape.
 */
export function validate(board) {
  try {
    const model = M.normalize(board);
    const r = M.validate(model);
    // Placement warnings too (a group split by constraints), as `map.warnings` has them.
    return r.ok ? { ...r, warnings: [...r.warnings, ...layout(model).warnings] } : r;
  } catch (e) {
    if (e instanceof M.AtlasError) return { ok: false, errors: e.errors, warnings: [] };
    throw e;
  }
}

/**
 * Applies edit operations to a board as one step and returns the edited board, canonical, with the
 * columns of a board without flow lanes saved in `layer` as Atlas saves them. It does not reorder:
 * Atlas tidies a board without `meta.ordered` when it loads it. Throws an AtlasError, and changes
 * nothing, when the board or an operation is invalid.
 */
export function apply(board, ops) {
  const { model } = M.apply(M.load(board).model, ops);
  return M.serialize(withLayers(model, layout(model)));
}

/** What changed from board `a` to board `b`, by id (the `diff` of `change` events). */
export function diff(a, b) {
  return M.diff(M.normalize(a), M.normalize(b));
}

// Deprecated since 0.5.0, removed in 0.6.0: the canonical model is not part of the package.
export const parse = text => (M.deprecated("parse()", "validate() or JSON.parse"), M.parse(text));
export const normalize = input => (M.deprecated("normalize()", "validate() and apply(), which take boards"), M.normalize(input));
export const load = input => (M.deprecated("load()", "validate()"), M.load(input));
export const serialize = model => (M.deprecated("serialize()", "apply(), which returns the board to save"), M.serialize(model));
