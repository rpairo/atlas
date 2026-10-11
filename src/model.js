// The board document: format, parsing, validation and edit operations.
//
// A board is plain JSON. The order of `nodes` is meaningful: it is the sketch, the memory of the
// board. Within each lane, nodes appear in the order they are drawn, so a saved board always
// reloads exactly as it was, and editing never reshuffles what the reader already knows.
// Everything here is pure: no DOM, no randomness, same input → same output.

export const FORMAT = "atlas/1";

export const LIMITS = Object.freeze({
  bytes: 512 * 1024,
  nodes: 300,
  edges: 1000,
  lanes: 40,
  groups: 100,
  constraints: 500,
  text: 2000,
  details: 50,
  groupDepth: 6,
});

export const DIRECTIONS = Object.freeze(["right", "down", "left", "up"]);
export const LANE_KINDS = Object.freeze(["flow", "before", "after"]);
export const CONSTRAINT_TYPES = Object.freeze(["before", "first", "last"]);

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
// Edge ids may be derived ("from->to#n"), so they also allow ">" and "#".
const EDGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:#>-]{0,140}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UNASSIGNED = "unassigned";

export class AtlasError extends Error {
  constructor(errors) {
    super(errors.map(e => `${e.path}: ${e.message}`).join("; "));
    this.name = "AtlasError";
    this.errors = errors;
  }
}

/** Parses JSON text without letting it touch object prototypes. */
export function parse(text) {
  if (typeof text !== "string") throw new AtlasError([err("", "type", "expected JSON text")]);
  if (byteLength(text) > LIMITS.bytes) {
    throw new AtlasError([err("", "too-large", `document exceeds ${LIMITS.bytes} bytes`)]);
  }
  let value;
  try {
    value = JSON.parse(text, (key, v) => {
      if (FORBIDDEN_KEYS.has(key)) return undefined;
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`the number at "${key}" is out of range`);
      return v;
    });
  } catch (e) {
    throw new AtlasError([err("", "json", e.message)]);
  }
  return value;
}

/**
 * Turns any accepted input into the canonical board: every list present, every edge with an id,
 * unknown fields kept aside so that export() can give them back untouched.
 */
export function normalize(input) {
  // An object goes through the same parser as text: the same size limit and the same refusal of
  // prototype keys. null is not a board; undefined is an empty one.
  const doc = typeof input === "string" ? parse(input) : input === undefined ? {} : parse(textOf(input));
  const shape = [];
  if (!isObject(doc)) throw new AtlasError([err("", "type", "a board must be a JSON object")]);
  if (doc.meta !== undefined && !isObject(doc.meta)) shape.push(err("meta", "type", "meta must be an object"));
  for (const k of ["lanes", "groups", "nodes", "edges", "constraints"]) {
    if (doc[k] !== undefined && !Array.isArray(doc[k])) shape.push(err(k, "type", `${k} must be a list`));
  }
  for (const k of ["edgeTypes", "nodeTypes"]) {
    if (doc[k] !== undefined && !isObject(doc[k])) shape.push(err(k, "type", `${k} must be an object`));
  }
  if (shape.length) throw new AtlasError(shape);
  const known = new Set(["format", "meta", "lanes", "groups", "nodes", "edges", "constraints", "edgeTypes", "nodeTypes"]);
  const extra = {};
  for (const [k, v] of Object.entries(doc)) if (!known.has(k) && !FORBIDDEN_KEYS.has(k)) extra[k] = v;

  // A field set to null is a field left out (as in the edit operations), so a board that writes
  // "lane": null loads, and is saved without it, as the schema wants.
  const meta = { direction: "right", ...compact(isObject(doc.meta) ? doc.meta : {}) };
  const lanes = asArray(doc.lanes).map(l => ({ kind: "flow", ...compact(l) }));
  const groups = asArray(doc.groups).map(g => compact(g));
  const nodes = asArray(doc.nodes).map(n => compact(n));
  const constraints = asArray(doc.constraints).map(c => compact(c));

  // Edges without an id get a derived one, stable as long as the edge list keeps its order, and
  // never one that another edge already has explicitly.
  const taken = new Set(asArray(doc.edges).map(e => e?.id).filter(id => id !== undefined && id !== null && id !== ""));
  const edges = asArray(doc.edges).map(e => {
    const edge = compact(e);
    if ((edge.id === undefined || edge.id === "") && typeof edge.from === "string" && typeof edge.to === "string") {
      edge.id = edgeId(edge, id => taken.has(id));
      taken.add(edge.id);
    }
    return edge;
  });

  return {
    format: doc.format ?? FORMAT,
    meta,
    lanes,
    groups,
    nodes,
    edges,
    constraints,
    edgeTypes: isObject(doc.edgeTypes) ? { ...doc.edgeTypes } : {},
    nodeTypes: isObject(doc.nodeTypes) ? { ...doc.nodeTypes } : {},
    extra,
  };
}

/** The document as it should be saved: canonical order, unknown fields restored. */
export function serialize(model) {
  const out = { format: FORMAT, meta: clone(model.meta) };
  if (model.lanes.length) out.lanes = clone(model.lanes);
  if (model.groups.length) out.groups = clone(model.groups);
  out.nodes = clone(model.nodes);
  out.edges = clone(model.edges);
  if (model.constraints.length) out.constraints = clone(model.constraints);
  if (Object.keys(model.edgeTypes).length) out.edgeTypes = clone(model.edgeTypes);
  if (Object.keys(model.nodeTypes).length) out.nodeTypes = clone(model.nodeTypes);
  return { ...clone(model.extra), ...out };
}

/**
 * Checks a canonical board. Errors make it unusable; warnings are drawn anyway and reported.
 * Every finding has a JSON-path-like `path`, a stable `code` and a readable `message`.
 */
export function validate(model) {
  const errors = [];
  const warnings = [];

  const major = typeof model.format === "string" ? /^atlas\/(\d+)$/.exec(model.format) : null;
  if (!major) errors.push(err("format", "format", `unknown format "${show(model.format)}"`));
  else if (major[1] !== "1") errors.push(err("format", "version", `format version ${major[1]} is not supported`));

  if (!DIRECTIONS.includes(model.meta.direction)) {
    errors.push(err("meta.direction", "enum", `direction must be one of ${DIRECTIONS.join(", ")}`));
  }
  text(errors, "meta.title", model.meta.title);
  text(errors, "meta.lang", model.meta.lang);
  if (model.meta.selected !== undefined) checkId(errors, "meta.selected", model.meta.selected);
  if (model.meta.ordered !== undefined && typeof model.meta.ordered !== "boolean") errors.push(err("meta.ordered", "type", "ordered must be true or false"));

  limit(errors, "lanes", model.lanes.length, LIMITS.lanes);
  limit(errors, "groups", model.groups.length, LIMITS.groups);
  limit(errors, "nodes", model.nodes.length, LIMITS.nodes);
  limit(errors, "edges", model.edges.length, LIMITS.edges);
  limit(errors, "constraints", model.constraints.length, LIMITS.constraints);

  // Lanes, groups and nodes share one namespace: an id names exactly one thing.
  const owner = new Map();
  const claim = (id, path) => {
    if (!checkId(errors, path, id)) return false;
    if (owner.has(id)) {
      errors.push(err(path, "duplicate", `id "${id}" is already used by ${owner.get(id)}`));
      return false;
    }
    owner.set(id, path);
    return true;
  };

  const lanes = new Map();
  model.lanes.forEach((l, i) => {
    const p = `lanes[${i}]`;
    if (claim(l.id, `${p}.id`)) lanes.set(l.id, l);
    if (!LANE_KINDS.includes(l.kind)) errors.push(err(`${p}.kind`, "enum", `kind must be one of ${LANE_KINDS.join(", ")}`));
    text(errors, `${p}.title`, l.title);
  });
  if (lanes.has(UNASSIGNED)) errors.push(err("lanes", "reserved", `lane id "${UNASSIGNED}" is reserved`));
  const before = model.lanes.filter(l => l.kind === "before").length;
  const after = model.lanes.filter(l => l.kind === "after").length;
  if (before > 1) errors.push(err("lanes", "bands", "at most one lane of kind \"before\""));
  if (after > 1) errors.push(err("lanes", "bands", "at most one lane of kind \"after\""));

  const groups = new Map();
  model.groups.forEach((g, i) => {
    const p = `groups[${i}]`;
    if (claim(g.id, `${p}.id`)) groups.set(g.id, g);
    text(errors, `${p}.title`, g.title);
  });
  model.groups.forEach((g, i) => {
    if (g.parent != null && !groups.has(g.parent)) {
      errors.push(err(`groups[${i}].parent`, "missing", `group "${show(g.parent)}" does not exist`));
    }
  });
  for (const g of model.groups) {
    const chain = new Set([g.id]);
    let cur = g;
    while (cur && cur.parent != null && groups.has(cur.parent)) {
      if (chain.has(cur.parent)) {
        errors.push(err(`groups`, "cycle", `group "${show(g.id)}" is its own ancestor`));
        break;
      }
      chain.add(cur.parent);
      if (chain.size > LIMITS.groupDepth) {
        errors.push(err(`groups`, "depth", `group "${show(g.id)}" is nested deeper than ${LIMITS.groupDepth}`));
        break;
      }
      cur = groups.get(cur.parent);
    }
  }

  const nodes = new Map();
  model.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (claim(n.id, `${p}.id`)) nodes.set(n.id, n);
    text(errors, `${p}.title`, n.title);
    text(errors, `${p}.subtitle`, n.subtitle);
    text(errors, `${p}.type`, n.type);
    if (n.pinned !== undefined && typeof n.pinned !== "boolean") errors.push(err(`${p}.pinned`, "type", "pinned must be true or false"));
    // layer is Atlas's saved column (boards without flow lanes). Other values may be a board's own
    // data from before it existed: kept and ignored, with a warning, never an error.
    if (n.layer !== undefined && !Number.isSafeInteger(n.layer)) warnings.push(err(`${p}.layer`, "ignored", "layer is not a whole number; it is kept, and ignored for placement"));
    if (n.details !== undefined) {
      if (!Array.isArray(n.details)) errors.push(err(`${p}.details`, "type", "details must be a list of texts"));
      else {
        if (n.details.length > LIMITS.details) errors.push(err(`${p}.details`, "too-many", `more than ${LIMITS.details} details`));
        n.details.forEach((d, j) => {
          if (typeof d !== "string") errors.push(err(`${p}.details[${j}]`, "type", "expected text"));
          else text(errors, `${p}.details[${j}]`, d);
        });
      }
    }
    if (n.lane != null && !lanes.has(n.lane)) errors.push(err(`${p}.lane`, "missing", `lane "${show(n.lane)}" does not exist`));
    if (n.group != null && !groups.has(n.group)) errors.push(err(`${p}.group`, "missing", `group "${show(n.group)}" does not exist`));
    if (n.lane == null && model.lanes.some(l => l.kind === "flow")) {
      warnings.push(err(`${p}.lane`, "unassigned", `node "${show(n.id)}" has no lane; it goes to "Unassigned"`));
    }
  });

  const edgeIds = new Set();
  const pairs = new Set();
  model.edges.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (typeof e.id !== "string" || !EDGE_ID.test(e.id) || FORBIDDEN_KEYS.has(e.id)) {
      errors.push(err(`${p}.id`, "id", `"${show(e.id)}" is not a valid edge id`));
    } else {
      if (edgeIds.has(e.id)) errors.push(err(`${p}.id`, "duplicate", `edge id "${e.id}" is repeated`));
      edgeIds.add(e.id);
    }
    if (!nodes.has(e.from)) errors.push(err(`${p}.from`, "missing", `node "${show(e.from)}" does not exist`));
    if (!nodes.has(e.to)) errors.push(err(`${p}.to`, "missing", `node "${show(e.to)}" does not exist`));
    if (e.from === e.to) warnings.push(err(p, "self", `edge "${show(e.id)}" connects "${show(e.from)}" to itself; it is listed, not drawn`));
    const pair = `${show(e.from)}\u0000${show(e.to)}`;
    if (pairs.has(pair)) warnings.push(err(p, "parallel", `another edge already goes from "${show(e.from)}" to "${show(e.to)}"; they share one wire`));
    pairs.add(pair);
    text(errors, `${p}.label`, e.label);
    text(errors, `${p}.details`, e.details);
    text(errors, `${p}.type`, e.type);
    if (typeof e.type === "string" && Object.keys(model.edgeTypes).length && !Object.prototype.hasOwnProperty.call(model.edgeTypes, e.type)) {
      warnings.push(err(`${p}.type`, "unknown-type", `edge type "${e.type}" is not declared`));
    }
  });

  if (typeof model.meta.selected === "string" && ID.test(model.meta.selected) && !nodes.has(model.meta.selected)) {
    warnings.push(err("meta.selected", "missing", `node "${model.meta.selected}" does not exist; nothing is selected`));
  }

  // Constraints compile into a partial order per lane; anything unsatisfiable is an error that
  // names the constraints in conflict. Nothing is ever broken silently.
  const firsts = new Map(), lasts = new Map();
  const beforeEdges = [];
  // Without flow lanes, nodes without a lane go to layers computed from the edges: their
  // constraints are checked by layout(), which knows the layers, and reported as its warnings.
  const auto = !model.lanes.some(l => l.kind === "flow");
  const layered = id => auto && laneOf(nodes.get(id)) === UNASSIGNED;
  model.constraints.forEach((c, i) => {
    const p = `constraints[${i}]`;
    if (!CONSTRAINT_TYPES.includes(c.type)) {
      errors.push(err(`${p}.type`, "enum", `type must be one of ${CONSTRAINT_TYPES.join(", ")}`));
      return;
    }
    const refs = c.type === "before" ? [c.a, c.b] : [c.node];
    for (const r of refs) if (!nodes.has(r)) errors.push(err(p, "missing", `node "${show(r)}" does not exist`));
    if (refs.some(r => !nodes.has(r))) return;
    if (refs.some(layered)) return;
    if (c.type === "before") {
      const la = laneOf(nodes.get(c.a)), lb = laneOf(nodes.get(c.b));
      if (la !== lb) warnings.push(err(p, "cross-lane", `"${c.a}" and "${c.b}" are in different lanes; ignored`));
      else beforeEdges.push([c.a, c.b, p]);
    } else {
      const lane = laneOf(nodes.get(c.node));
      const map = c.type === "first" ? firsts : lasts;
      if (map.has(lane)) errors.push(err(p, "conflict", `lane "${lane}" already has a "${c.type}" node (${map.get(lane)})`));
      else map.set(lane, c.node);
    }
  });
  for (const [lane, node] of firsts) {
    if (lasts.get(lane) === node && model.nodes.filter(n => laneOf(n) === lane).length > 1) {
      errors.push(err("constraints", "conflict", `"${node}" cannot be both first and last of lane "${lane}"`));
    }
  }
  const cycle = findCycle(beforeEdges);
  if (cycle) errors.push(err("constraints", "cycle", `"before" constraints form a cycle: ${cycle.join(" → ")}`));
  for (const [a, b, p] of beforeEdges) {
    const lane = laneOf(nodes.get(a));
    if (firsts.get(lane) === b) errors.push(err(p, "conflict", `"${b}" must be first but "${a}" must come before it`));
    if (lasts.get(lane) === a) errors.push(err(p, "conflict", `"${a}" must be last but must come before "${b}"`));
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Normalizes and validates; throws AtlasError with every problem if the board is unusable. */
export function load(input) {
  const model = normalize(input);
  const result = validate(model);
  if (!result.ok) throw new AtlasError(result.errors);
  return { model, warnings: result.warnings };
}

export function laneOf(node) {
  return node.lane ?? UNASSIGNED;
}

export { UNASSIGNED };

// ---------------------------------------------------------------------------------------------
// Edit operations. Each one is plain data, so a sequence can be stored, sent and replayed. They
// are applied to a copy; the caller keeps the previous model for undo, which makes undo exact.

export const OPS = Object.freeze([
  "addNode", "updateNode", "moveNode", "removeNode", "renameNode",
  "addEdge", "updateEdge", "removeEdge",
  "addLane", "updateLane", "moveLane", "removeLane",
  "addGroup", "updateGroup", "removeGroup",
  "addConstraint", "removeConstraint",
  "setMeta",
]);

/**
 * Applies a list of operations atomically: either all of them succeed and the result validates,
 * or the original model is untouched and an AtlasError explains why.
 */
export function apply(model, ops) {
  const next = clone(model);
  const list = Array.isArray(ops) ? ops : [ops];
  list.forEach((raw, i) => {
    const p = `ops[${i}]`;
    if (!isObject(raw) || !OPS.includes(raw.op)) throw new AtlasError([err(p, "op", `unknown operation "${show(isObject(raw) ? raw.op : raw)}"`)]);
    // A copy: the caller's objects (a details list, a node) never become part of the model.
    const op = copyOp(raw, p);
    checkShape(op, p);
    APPLY[op.op](next, op, p);
  });
  const result = validate(next);
  if (!result.ok) throw new AtlasError(result.errors);
  return { model: next, warnings: result.warnings };
}

/** A deep copy of an operation that keeps `undefined` (which removes a field in changes). */
function copyOp(op, path) {
  try { return structuredClone(op); }
  catch (e) { throw new AtlasError([err(path, "type", `the operation cannot be copied: ${e.message}`)]); }
}

/** The arguments an operation takes have the right shape: ids are text, indexes whole numbers,
 *  changes and payloads objects. Anything else is an AtlasError, not a TypeError further in. */
function checkShape(op, p) {
  const text = (k, optional = false) => need((optional && op[k] == null) || typeof op[k] === "string", `${p}.${k}`, `${k} must be an id`);
  const index = k => need(op[k] == null || Number.isInteger(op[k]), `${p}.${k}`, `${k} must be a whole number`);
  const object = k => need(op[k] == null || isObject(op[k]), `${p}.${k}`, `${k} must be an object`);
  switch (op.op) {
    case "addNode": object("node"); index("index"); text("before", true); text("after", true); break;
    case "moveNode": text("id"); index("index"); text("before", true); text("after", true); need(op.lane == null || typeof op.lane === "string", `${p}.lane`, "lane must be an id or null"); break;
    case "renameNode": text("from"); text("to"); break;
    case "addEdge": object("edge"); break;
    case "addLane": object("lane"); index("index"); break;
    case "moveLane": text("id"); index("index"); break;
    case "removeLane": text("id"); need(op.moveTo == null || typeof op.moveTo === "string", `${p}.moveTo`, "moveTo must be a lane id or null"); break;
    case "addGroup": object("group"); break;
    case "addConstraint": object("constraint"); break;
    case "setMeta": object("changes"); break;
    case "updateNode": case "updateEdge": case "updateLane": case "updateGroup": text("id"); object("changes"); break;
    case "removeNode": case "removeEdge": case "removeGroup": text("id"); break;
  }
}

const APPLY = {
  addNode(m, { node, index, before, after }, p) {
    need(node && node.id, p, "node with an id is required");
    insertAt(m.nodes, compact(node), anchorOr(m, before, after, p) ?? positionIn(m, node.lane ?? null, index));
  },
  updateNode(m, { id, changes }, p) {
    assign(find(m.nodes, id, p), changes);
  },
  moveNode(m, { id, lane, index, before, after }, p) {
    const i = indexOf(m.nodes, id, p);
    const [n] = m.nodes.splice(i, 1);
    if (lane === null) delete n.lane;
    else if (lane !== undefined) n.lane = lane;
    insertAt(m.nodes, n, anchorOr(m, before, after, p) ?? positionIn(m, n.lane ?? null, index));
  },
  removeNode(m, { id }, p) {
    const i = indexOf(m.nodes, id, p);
    m.nodes.splice(i, 1);
    m.edges = m.edges.filter(e => e.from !== id && e.to !== id);
    m.constraints = m.constraints.filter(c => c.node !== id && c.a !== id && c.b !== id);
    if (m.meta.selected === id) delete m.meta.selected;
  },
  renameNode(m, { from, to }, p) {
    find(m.nodes, from, p).id = to;
    for (const e of m.edges) {
      const derived = e.id === `${e.from}->${e.to}` || e.id.startsWith(`${e.from}->${e.to}#`);
      if (e.from === from) e.from = to;
      if (e.to === from) e.to = to;
      if (derived) {
        // The same suffix if it is free, or the next free one: never an id another edge has.
        e.id = edgeId(e, id => m.edges.some(x => x !== e && x.id === id), e.id.replace(/^[^#]*/, `${e.from}->${e.to}`));
      }
    }
    for (const c of m.constraints) for (const k of ["node", "a", "b"]) if (c[k] === from) c[k] = to;
    if (m.meta.selected === from) m.meta.selected = to;
  },
  addEdge(m, { edge }, p) {
    need(edge && edge.from && edge.to, p, "edge with from and to is required");
    const e = compact(edge);
    if (!e.id && typeof e.from === "string" && typeof e.to === "string") e.id = edgeId(e, id => m.edges.some(x => x.id === id));
    m.edges.push(e);
  },
  updateEdge(m, { id, changes }, p) {
    assign(find(m.edges, id, p), changes);
  },
  removeEdge(m, { id }, p) {
    m.edges.splice(indexOf(m.edges, id, p), 1);
  },
  addLane(m, { lane, index }, p) {
    need(lane && lane.id, p, "lane with an id is required");
    insertAt(m.lanes, { kind: "flow", ...compact(lane) }, clampIndex(index, m.lanes.length));
  },
  updateLane(m, { id, changes }, p) {
    const i = indexOf(m.lanes, id, p);
    assign(m.lanes[i], changes);
    // A kind left out falls back to "flow", placed first as normalize() places it: saving twice gives
    // the same text.
    if (m.lanes[i].kind == null) m.lanes[i] = { kind: "flow", ...m.lanes[i] };
  },
  moveLane(m, { id, index }, p) {
    const [l] = m.lanes.splice(indexOf(m.lanes, id, p), 1);
    insertAt(m.lanes, l, clampIndex(index, m.lanes.length));
  },
  removeLane(m, { id, moveTo }, p) {
    m.lanes.splice(indexOf(m.lanes, id, p), 1);
    for (const n of m.nodes) if (n.lane === id) {
      if (moveTo === undefined || moveTo === null) delete n.lane;
      else n.lane = moveTo;
    }
  },
  addGroup(m, { group }, p) {
    need(group && group.id, p, "group with an id is required");
    m.groups.push(compact(group));
  },
  updateGroup(m, { id, changes }, p) {
    assign(find(m.groups, id, p), changes);
  },
  removeGroup(m, { id }, p) {
    const g = find(m.groups, id, p);
    m.groups = m.groups.filter(x => x.id !== id);
    for (const x of m.groups) if (x.parent === id) {
      if (g.parent != null) x.parent = g.parent;
      else delete x.parent;
    }
    for (const n of m.nodes) if (n.group === id) {
      if (g.parent != null) n.group = g.parent;
      else delete n.group;
    }
  },
  addConstraint(m, { constraint }, p) {
    need(constraint && constraint.type, p, "constraint with a type is required");
    m.constraints.push(compact(constraint));
  },
  removeConstraint(m, { index }, p) {
    need(Number.isInteger(index) && index >= 0 && index < m.constraints.length, p, `no constraint at index ${show(index)}`);
    m.constraints.splice(index, 1);
  },
  setMeta(m, { changes }) {
    assign(m.meta, changes ?? {});
    if (m.meta.direction == null) m.meta = { direction: "right", ...m.meta };
  },
};

/** What changed between two models, by id. Drives events and animation. */
export function diff(before, after) {
  const d = { nodes: delta(before.nodes, after.nodes), edges: delta(before.edges, after.edges), lanes: delta(before.lanes, after.lanes), groups: delta(before.groups, after.groups) };
  d.order = !sameOrder(before.nodes, after.nodes);
  d.meta = JSON.stringify(before.meta) !== JSON.stringify(after.meta);
  d.constraints = JSON.stringify(before.constraints) !== JSON.stringify(after.constraints);
  return d;
}

// ---------------------------------------------------------------------------------------------

/** Position right before/after another node (the unambiguous way, also for automatic lanes). */
function anchorOr(m, before, after, p) {
  if (before != null) return indexOf(m.nodes, before, p);
  if (after != null) return indexOf(m.nodes, after, p) + 1;
  return null;
}

/** Index in `nodes` where a node of `lane` lands so that it is the `index`-th of its lane. */
function positionIn(m, lane, index) {
  const inLane = [];
  m.nodes.forEach((n, i) => { if ((n.lane ?? null) === lane) inLane.push(i); });
  if (index === undefined || index === null || index >= inLane.length) {
    return inLane.length ? inLane[inLane.length - 1] + 1 : m.nodes.length;
  }
  return inLane[Math.max(0, index)];
}

function delta(a, b) {
  const A = new Map(a.map(x => [x.id, x])), B = new Map(b.map(x => [x.id, x]));
  const added = [], removed = [], changed = [];
  for (const [id, x] of B) {
    if (!A.has(id)) added.push(id);
    else if (JSON.stringify(A.get(id)) !== JSON.stringify(x)) changed.push(id);
  }
  for (const id of A.keys()) if (!B.has(id)) removed.push(id);
  return { added, removed, changed };
}

function sameOrder(a, b) {
  const ids = x => x.map(n => n.id).join("\u0000");
  return ids(a) === ids(b);
}

function findCycle(edges) {
  const adj = new Map();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  }
  // Depth-first without recursion: a chain of thousands of constraints would overflow the stack.
  const state = new Map();
  for (const start of adj.keys()) {
    if (state.has(start)) continue;
    const path = [start], next = [0];
    state.set(start, 1);
    while (path.length) {
      const v = path[path.length - 1], out = adj.get(v) ?? [];
      const k = next[next.length - 1]++;
      if (k >= out.length) { state.set(v, 2); path.pop(); next.pop(); continue; }
      const w = out[k];
      if (state.get(w) === 1) return [...path.slice(path.indexOf(w)), w];
      if (!state.has(w)) { state.set(w, 1); path.push(w); next.push(0); }
    }
  }
  return null;
}

function checkId(errors, path, id) {
  if (typeof id !== "string" || !ID.test(id) || FORBIDDEN_KEYS.has(id)) {
    errors.push(err(path, "id", `"${show(id)}" is not a valid id (letters, digits, _ . : -, up to 64)`));
    return false;
  }
  return true;
}

function text(errors, path, value) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") errors.push(err(path, "type", "expected text"));
  // Counted in characters (code points), as JSON Schema's maxLength counts them: an emoji is one.
  else if (value.length > LIMITS.text && [...value].length > LIMITS.text) errors.push(err(path, "too-long", `longer than ${LIMITS.text} characters`));
}

function limit(errors, path, n, max) {
  if (n > max) errors.push(err(path, "too-many", `${n} items; the limit is ${max}`));
}

/** A board given as an object, as JSON text. */
function textOf(input) {
  let text;
  try { text = JSON.stringify(input); } catch (e) { throw new AtlasError([err("", "json", e.message)]); }
  if (text === undefined) throw new AtlasError([err("", "type", "a board must be a JSON object")]);
  return text;
}

/** A document value as text for a message, whatever it is (even an object whose toString is not a
 *  function, which would throw inside a template string). */
function show(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return Object.prototype.toString.call(v); }
}

function err(path, code, message) {
  return { path, code, message };
}

function need(cond, path, message) {
  if (!cond) throw new AtlasError([err(path, "invalid", message)]);
}

function find(list, id, path) {
  const x = list.find(v => v.id === id);
  need(x, path, `"${show(id)}" does not exist`);
  return x;
}

function indexOf(list, id, path) {
  const i = list.findIndex(v => v.id === id);
  need(i >= 0, path, `"${show(id)}" does not exist`);
  return i;
}

function insertAt(list, item, index) {
  list.splice(clampIndex(index, list.length), 0, item);
}

function clampIndex(index, length) {
  if (index === undefined || index === null) return length;
  return Math.max(0, Math.min(length, index));
}

/** A copy without undefined or null values: a field set to null is a field left out. */
function compact(o) {
  return Object.fromEntries(Object.entries(isObject(o) ? o : {}).filter(([k, v]) => v !== undefined && v !== null && !FORBIDDEN_KEYS.has(k)));
}

/** Merges changes; a value of undefined or null removes the field. */
/** Merges `changes` into `target`: null or undefined removes a field; the id never changes here. */
/** The derived id of an edge: `first` (by default `from->to`) or, while taken, `from->to#1`, `#2`… */
function edgeId(e, used, first = `${e.from}->${e.to}`) {
  let n = 0, id = first;
  while (used(id)) id = `${e.from}->${e.to}#${++n}`;
  return id;
}

function assign(target, changes) {
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (k === "id" || FORBIDDEN_KEYS.has(k)) continue;
    if (v === undefined || v === null) delete target[k];
    else target[k] = v;
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function byteLength(s) {
  return new TextEncoder().encode(s).length;
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
