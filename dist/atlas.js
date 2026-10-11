/*! Atlas 0.2.0 | MIT | https://github.com/rpairo/atlas */
const __modules = {};
__modules.model = (() => {
// The board document: format, parsing, validation and edit operations.
//
// A board is plain JSON. The order of `nodes` is meaningful: it is the sketch, the memory of the
// board. Within each lane, nodes appear in the order they are drawn, so a saved board always
// reloads exactly as it was, and editing never reshuffles what the reader already knows.
// Everything here is pure: no DOM, no randomness, same input → same output.

const FORMAT = "atlas/1";

const LIMITS = Object.freeze({
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

const DIRECTIONS = Object.freeze(["right", "down", "left", "up"]);
const LANE_KINDS = Object.freeze(["flow", "before", "after"]);
const CONSTRAINT_TYPES = Object.freeze(["before", "first", "last"]);

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
// Edge ids may be derived ("from->to#n"), so they also allow ">" and "#".
const EDGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:#>-]{0,140}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UNASSIGNED = "unassigned";

class AtlasError extends Error {
  constructor(errors) {
    super(errors.map(e => `${e.path}: ${e.message}`).join("; "));
    this.name = "AtlasError";
    this.errors = errors;
  }
}

/** Parses JSON text without letting it touch object prototypes. */
function parse(text) {
  if (typeof text !== "string") throw new AtlasError([err("", "type", "expected JSON text")]);
  if (byteLength(text) > LIMITS.bytes) {
    throw new AtlasError([err("", "too-large", `document exceeds ${LIMITS.bytes} bytes`)]);
  }
  let value;
  try {
    value = JSON.parse(text, (key, v) => (FORBIDDEN_KEYS.has(key) ? undefined : v));
  } catch (e) {
    throw new AtlasError([err("", "json", e.message)]);
  }
  return value;
}

/**
 * Turns any accepted input into the canonical board: every list present, every edge with an id,
 * unknown fields kept aside so that export() can give them back untouched.
 */
function normalize(input) {
  const doc = typeof input === "string" ? parse(input) : clone(input ?? {});
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
    if (edge.id === undefined || edge.id === "") {
      const base = `${edge.from}->${edge.to}`;
      let n = 0, id = base;
      while (taken.has(id)) id = `${base}#${++n}`;
      taken.add(id);
      edge.id = id;
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
function serialize(model) {
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
function validate(model) {
  const errors = [];
  const warnings = [];

  const major = /^atlas\/(\d+)$/.exec(String(model.format));
  if (!major) errors.push(err("format", "format", `unknown format "${model.format}"`));
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
      errors.push(err(`groups[${i}].parent`, "missing", `group "${g.parent}" does not exist`));
    }
  });
  for (const g of model.groups) {
    const chain = new Set([g.id]);
    let cur = g;
    while (cur && cur.parent != null && groups.has(cur.parent)) {
      if (chain.has(cur.parent)) {
        errors.push(err(`groups`, "cycle", `group "${g.id}" is its own ancestor`));
        break;
      }
      chain.add(cur.parent);
      if (chain.size > LIMITS.groupDepth) {
        errors.push(err(`groups`, "depth", `group "${g.id}" is nested deeper than ${LIMITS.groupDepth}`));
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
    if (n.lane != null && !lanes.has(n.lane)) errors.push(err(`${p}.lane`, "missing", `lane "${n.lane}" does not exist`));
    if (n.group != null && !groups.has(n.group)) errors.push(err(`${p}.group`, "missing", `group "${n.group}" does not exist`));
    if (n.lane == null && model.lanes.some(l => l.kind === "flow")) {
      warnings.push(err(`${p}.lane`, "unassigned", `node "${n.id}" has no lane; it goes to "Unassigned"`));
    }
  });

  const edgeIds = new Set();
  const pairs = new Set();
  model.edges.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (typeof e.id !== "string" || !EDGE_ID.test(e.id) || FORBIDDEN_KEYS.has(e.id)) {
      errors.push(err(`${p}.id`, "id", `"${e.id}" is not a valid edge id`));
    } else {
      if (edgeIds.has(e.id)) errors.push(err(`${p}.id`, "duplicate", `edge id "${e.id}" is repeated`));
      edgeIds.add(e.id);
    }
    if (!nodes.has(e.from)) errors.push(err(`${p}.from`, "missing", `node "${e.from}" does not exist`));
    if (!nodes.has(e.to)) errors.push(err(`${p}.to`, "missing", `node "${e.to}" does not exist`));
    if (e.from === e.to) warnings.push(err(p, "self", `edge "${e.id}" connects "${e.from}" to itself; it is listed, not drawn`));
    const pair = `${e.from}\u0000${e.to}`;
    if (pairs.has(pair)) warnings.push(err(p, "parallel", `another edge already goes from "${e.from}" to "${e.to}"; they share one wire`));
    pairs.add(pair);
    text(errors, `${p}.label`, e.label);
    text(errors, `${p}.details`, e.details);
    text(errors, `${p}.type`, e.type);
    if (typeof e.type === "string" && Object.keys(model.edgeTypes).length && !Object.hasOwn(model.edgeTypes, e.type)) {
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
  model.constraints.forEach((c, i) => {
    const p = `constraints[${i}]`;
    if (!CONSTRAINT_TYPES.includes(c.type)) {
      errors.push(err(`${p}.type`, "enum", `type must be one of ${CONSTRAINT_TYPES.join(", ")}`));
      return;
    }
    const refs = c.type === "before" ? [c.a, c.b] : [c.node];
    for (const r of refs) if (!nodes.has(r)) errors.push(err(p, "missing", `node "${r}" does not exist`));
    if (refs.some(r => !nodes.has(r))) return;
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
function load(input) {
  const model = normalize(input);
  const result = validate(model);
  if (!result.ok) throw new AtlasError(result.errors);
  return { model, warnings: result.warnings };
}

function laneOf(node) {
  return node.lane ?? UNASSIGNED;
}



// ---------------------------------------------------------------------------------------------
// Edit operations. Each one is plain data, so a sequence can be stored, sent and replayed. They
// are applied to a copy; the caller keeps the previous model for undo, which makes undo exact.

const OPS = Object.freeze([
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
function apply(model, ops) {
  const next = clone(model);
  const list = Array.isArray(ops) ? ops : [ops];
  list.forEach((op, i) => {
    if (!op || !OPS.includes(op.op)) throw new AtlasError([err(`ops[${i}]`, "op", `unknown operation "${op && op.op}"`)]);
    APPLY[op.op](next, op, `ops[${i}]`);
  });
  const result = validate(next);
  if (!result.ok) throw new AtlasError(result.errors);
  return { model: next, warnings: result.warnings };
}

const APPLY = {
  addNode(m, { node, index, before, after }, p) {
    need(node && node.id, p, "node with an id is required");
    insertAt(m.nodes, compact(node), anchorOr(m, before, after, p) ?? positionIn(m, node.lane ?? null, index));
  },
  updateNode(m, { id, changes }, p) {
    const n = find(m.nodes, id, p);
    const { id: _ignored, ...rest } = changes ?? {};
    assign(n, rest);
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
      if (derived) e.id = e.id.replace(/^[^#]*/, `${e.from}->${e.to}`);
    }
    for (const c of m.constraints) for (const k of ["node", "a", "b"]) if (c[k] === from) c[k] = to;
    if (m.meta.selected === from) m.meta.selected = to;
  },
  addEdge(m, { edge }, p) {
    need(edge && edge.from && edge.to, p, "edge with from and to is required");
    const e = compact(edge);
    if (!e.id) {
      const base = `${e.from}->${e.to}`;
      let n = 0, id = base;
      while (m.edges.some(x => x.id === id)) id = `${base}#${++n}`;
      e.id = id;
    }
    m.edges.push(e);
  },
  updateEdge(m, { id, changes }, p) {
    const e = find(m.edges, id, p);
    const { id: _ignored, ...rest } = changes ?? {};
    assign(e, rest);
  },
  removeEdge(m, { id }, p) {
    m.edges.splice(indexOf(m.edges, id, p), 1);
  },
  addLane(m, { lane, index }, p) {
    need(lane && lane.id, p, "lane with an id is required");
    insertAt(m.lanes, { kind: "flow", ...compact(lane) }, clampIndex(index, m.lanes.length));
  },
  updateLane(m, { id, changes }, p) {
    const l = find(m.lanes, id, p);
    const { id: _ignored, ...rest } = changes ?? {};
    assign(l, rest);
    l.kind ??= "flow";
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
    const g = find(m.groups, id, p);
    const { id: _ignored, ...rest } = changes ?? {};
    assign(g, rest);
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
    need(Number.isInteger(index) && index >= 0 && index < m.constraints.length, p, `no constraint at index ${index}`);
    m.constraints.splice(index, 1);
  },
  setMeta(m, { changes }) {
    assign(m.meta, changes ?? {});
    m.meta.direction ??= "right";
  },
};

/** What changed between two models, by id. Drives events and animation. */
function diff(before, after) {
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
    errors.push(err(path, "id", `"${id}" is not a valid id (letters, digits, _ . : -, up to 64)`));
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

function err(path, code, message) {
  return { path, code, message };
}

function need(cond, path, message) {
  if (!cond) throw new AtlasError([err(path, "invalid", message)]);
}

function find(list, id, path) {
  const x = list.find(v => v.id === id);
  need(x, path, `"${id}" does not exist`);
  return x;
}

function indexOf(list, id, path) {
  const i = list.findIndex(v => v.id === id);
  need(i >= 0, path, `"${id}" does not exist`);
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
function assign(target, changes) {
  for (const [k, v] of Object.entries(changes)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
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

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

return { FORMAT, LIMITS, DIRECTIONS, LANE_KINDS, CONSTRAINT_TYPES, AtlasError, parse, normalize, serialize, validate, load, laneOf, UNASSIGNED, OPS, apply, diff, clone };
})();

__modules.layout = (() => {
// Placement: which lane each node is in, its order inside the lane and its row slot.
//
// Order of authority, highest first:
//   1. the lane the author declares (never inferred from edges when lanes exist);
//   2. declared constraints (groups, before, first, last);
//   3. the sketch: the current order of the document, so editing never reshuffles the board;
//   4. relations: inside each lane, the order with the fewest crossings;
//   5. balance: shorter lanes spread into row slots so nodes line up with their neighbours.
// With no flow lanes declared, lanes come from the relations themselves (layered drawing).
// Pure and deterministic: no DOM, no randomness, bounded iterations.

const { UNASSIGNED, laneOf } = __modules.model;

const AUTO = "atlas:auto-";
const SWEEPS = 8;

/**
 * @param model canonical board (see model.js)
 * @param options.optimize reorder every lane for fewest crossings (otherwise keep the sketch)
 */
function layout(model, options = {}) {
  const { optimize = false } = options;
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const lanes = resolveLanes(model);
  const rank = new Map();
  if (lanes.before) rank.set(lanes.before.id, -1);
  lanes.flow.forEach((l, i) => rank.set(l.id, i));
  if (lanes.after) rank.set(lanes.after.id, lanes.flow.length);

  const order = new Map();
  for (const l of lanes.all) order.set(l.id, []);
  for (const n of model.nodes) order.get(lanes.laneOfNode.get(n.id)).push(n.id);

  const adjacency = buildAdjacency(model, lanes.laneOfNode);
  const constraints = compileConstraints(model, lanes.laneOfNode);

  for (const l of lanes.all) order.set(l.id, enforce(order.get(l.id), constraints.get(l.id), model));
  if (optimize) minimizeCrossings(lanes, order, adjacency, constraints, model);

  const slots = balance(lanes, order, adjacency);
  const edgeClass = classifyEdges(model, lanes.laneOfNode, rank);
  const warnings = splitGroups(model, order);

  return {
    direction: model.meta.direction,
    mode: lanes.mode,
    flow: lanes.flow.map(l => ({ ...l })),
    before: lanes.before ? { ...lanes.before } : null,
    after: lanes.after ? { ...lanes.after } : null,
    laneOf: lanes.laneOfNode,
    rank,
    order,
    slots: slots.slot,
    rows: slots.rows,
    edgeClass,
    groups: groupSpans(model, order, slots.slot, nodes),
    warnings,
  };
}

/** Groups whose members, in some lane, have other nodes between them (constraints put them there). */
function splitGroups(model, order) {
  const out = [];
  for (const g of model.groups) for (const [lane, ids] of order) {
    const at = [];
    ids.forEach((id, i) => { if (inGroup(model.nodes.find(n => n.id === id), g.id, model)) at.push(i); });
    if (at.length > 1 && at[at.length - 1] - at[0] + 1 !== at.length) {
      out.push({ path: "groups", code: "group-split", message: `constraints put other nodes between the members of group "${g.id}" in lane "${lane}"` });
    }
  }
  return out;
}

/**
 * Where a new node of `lane` should go: the gap with the fewest crossings against its neighbours,
 * respecting constraints; ties go to the gap nearest the median of its neighbours, then the end.
 * With `near`, the allowed gap nearest that index instead. A gap is allowed when the lane keeps its
 * constraints and its groups as they are drawn: a gap that would move a group block, and with it
 * existing nodes, is never offered. `model` must already contain the node and its edges; the
 * returned index is its position among the other nodes of the lane, in the order they are drawn.
 */
function bestInsertion(model, nodeId, near) {
  const lanes = resolveLanes(model);
  const laneId = lanes.laneOfNode.get(nodeId);
  const adjacency = buildAdjacency(model, lanes.laneOfNode);
  const constraints = compileConstraints(model, lanes.laneOfNode);
  const order = new Map();
  for (const l of lanes.all) order.set(l.id, []);
  for (const n of model.nodes) if (n.id !== nodeId) order.get(lanes.laneOfNode.get(n.id)).push(n.id);
  for (const l of lanes.all) order.set(l.id, enforce(order.get(l.id), constraints.get(l.id), model));
  const others = order.get(laneId);
  const pos = positionsOf(order);
  const neighbours = [...(adjacency.get(nodeId) ?? [])].filter(w => lanes.laneOfNode.get(w) !== laneId && pos.has(w));
  const median = medianOf(neighbours.map(w => pos.get(w)));

  let best = null;
  for (let i = 0; i <= others.length; i++) {
    const candidate = [...others.slice(0, i), nodeId, ...others.slice(i)];
    if (!satisfies(candidate, constraints.get(laneId)) || groupBlocks(candidate, model).join() !== candidate.join()) continue;
    if (near !== undefined) {
      const score = [Math.abs(i - near), i];
      if (!best || lexLess(score, best.score)) best = { index: i, score };
      continue;
    }
    order.set(laneId, candidate);
    const p = positionsOf(order);
    const crossings = laneCrossings(laneId, lanes, order, adjacency, p) + sameLanePenalty(candidate, model);
    const distance = median === null ? 0 : Math.abs(i - median);
    const score = [crossings, distance, -i];
    if (!best || lexLess(score, best.score)) best = { index: i, score };
  }
  return best ? best.index : others.length;
}

/** Counts how many pairs of nodes would swap places between two layouts (for "reorder all"). */
function inversions(before, after) {
  let n = 0;
  for (const [lane, a] of before.order) {
    const b = after.order.get(lane);
    if (!b) continue;
    const at = new Map(b.map((id, i) => [id, i]));
    const ids = a.filter(id => at.has(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (at.get(ids[i]) > at.get(ids[j])) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Lanes

function resolveLanes(model) {
  const declaredFlow = model.lanes.filter(l => l.kind === "flow");
  const before = model.lanes.find(l => l.kind === "before") ?? null;
  const after = model.lanes.find(l => l.kind === "after") ?? null;
  const laneOfNode = new Map();
  const flow = declaredFlow.map(l => ({ id: l.id, title: l.title ?? "", kind: "flow" }));
  let mode = "lanes";

  if (declaredFlow.length) {
    let unassigned = false;
    for (const n of model.nodes) {
      const lane = laneOf(n);
      if (lane === UNASSIGNED) unassigned = true;
      laneOfNode.set(n.id, lane);
    }
    if (unassigned) flow.push({ id: UNASSIGNED, title: "Unassigned", kind: "flow", synthetic: true });
  } else {
    // No flow lanes: layers come from the relations (bands still hold their own nodes).
    mode = "auto";
    const free = model.nodes.filter(n => n.lane == null || (n.lane !== before?.id && n.lane !== after?.id));
    const layerOf = autoLayers(free.map(n => n.id), model.edges);
    const count = free.length ? Math.max(...layerOf.values()) + 1 : 0;
    for (let k = 0; k < count; k++) flow.push({ id: AUTO + k, title: "", kind: "flow", synthetic: true });
    for (const n of model.nodes) {
      if (before && n.lane === before.id) laneOfNode.set(n.id, before.id);
      else if (after && n.lane === after.id) laneOfNode.set(n.id, after.id);
      else laneOfNode.set(n.id, AUTO + layerOf.get(n.id));
    }
  }
  const all = [...(before ? [before] : []), ...flow, ...(after ? [after] : [])].map(l => ({ id: l.id, title: l.title ?? "", kind: l.kind, synthetic: !!l.synthetic }));
  return {
    mode,
    flow,
    before: before ? { id: before.id, title: before.title ?? "", kind: "before" } : null,
    after: after ? { id: after.id, title: after.title ?? "", kind: "after" } : null,
    all,
    laneOfNode,
  };
}

/**
 * Layers by longest path after breaking cycles. Cycles are broken by a depth-first search in
 * document order: the edge that closes a cycle is reversed for layering only.
 */
function autoLayers(ids, edges) {
  const set = new Set(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const out = new Map(ids.map(id => [id, []]));
  for (const e of edges) if (set.has(e.from) && set.has(e.to) && e.from !== e.to && !out.get(e.from).includes(e.to)) out.get(e.from).push(e.to);
  // Neighbours in document order, so the order of the edge list never changes the drawing.
  for (const ws of out.values()) ws.sort((a, b) => rank.get(a) - rank.get(b));
  const state = new Map();
  const reversed = new Set();
  const visit = v => {
    state.set(v, 1);
    for (const w of out.get(v)) {
      if (state.get(w) === 1) reversed.add(`${v}\u0000${w}`);
      else if (!state.has(w)) visit(w);
    }
    state.set(v, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const preds = new Map(ids.map(id => [id, []]));
  for (const [v, ws] of out) for (const w of ws) {
    if (reversed.has(`${v}\u0000${w}`)) preds.get(v).push(w);
    else preds.get(w).push(v);
  }
  const layer = new Map();
  const depth = v => {
    if (layer.has(v)) return layer.get(v);
    layer.set(v, 0);
    let d = 0;
    for (const p of preds.get(v)) d = Math.max(d, depth(p) + 1);
    layer.set(v, d);
    return d;
  };
  for (const id of ids) depth(id);
  return layer;
}

// ---------------------------------------------------------------------------------------------
// Constraints: groups keep their members together; "before", "first" and "last" fix order.

function compileConstraints(model, laneOfNode) {
  const byLane = new Map();
  const get = lane => {
    if (!byLane.has(lane)) byLane.set(lane, { before: [], first: null, last: null });
    return byLane.get(lane);
  };
  for (const c of model.constraints) {
    if (c.type === "before") {
      const la = laneOfNode.get(c.a);
      if (la !== undefined && la === laneOfNode.get(c.b)) get(la).before.push([c.a, c.b]);
    } else if (c.type === "first" || c.type === "last") {
      const lane = laneOfNode.get(c.node);
      if (lane !== undefined) get(lane)[c.type] = c.node;
    }
  }
  return byLane;
}

/**
 * The order closest to `ids` that keeps groups together and satisfies the constraints.
 * Groups first (blocks in order of their first member, members keep their order); then a stable
 * topological sort applies before/first/last, so the constraints win over the sketch while
 * moving as little as possible.
 */
function enforce(ids, c, model) {
  let seq = groupBlocks(ids, model);
  if (!c) return seq;
  const pos = new Map(seq.map((id, i) => [id, i]));
  const succ = new Map(seq.map(id => [id, new Set()]));
  const indeg = new Map(seq.map(id => [id, 0]));
  const add = (a, b) => {
    if (a === b || !succ.has(a) || !succ.has(b) || succ.get(a).has(b)) return;
    succ.get(a).add(b);
    indeg.set(b, indeg.get(b) + 1);
  };
  for (const [a, b] of c.before) add(a, b);
  if (c.first) for (const id of seq) add(c.first, id);
  if (c.last) for (const id of seq) add(id, c.last);
  const ready = seq.filter(id => indeg.get(id) === 0);
  const out = [];
  while (ready.length) {
    ready.sort((a, b) => pos.get(a) - pos.get(b));
    const v = ready.shift();
    out.push(v);
    for (const w of succ.get(v)) {
      indeg.set(w, indeg.get(w) - 1);
      if (indeg.get(w) === 0) ready.push(w);
    }
  }
  return out.length === seq.length ? out : seq; // a cycle is rejected by validate(); stay safe
}

function groupBlocks(ids, model) {
  const groups = new Map(model.groups.map(g => [g.id, g]));
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const chain = id => {
    const out = [];
    let g = nodes.get(id)?.group;
    const guard = new Set();
    while (g != null && groups.has(g) && !guard.has(g)) {
      guard.add(g);
      out.unshift(g);
      g = groups.get(g).parent;
    }
    return out;
  };
  // A tree of blocks keyed by group path; children in order of first appearance.
  const root = { items: [], index: new Map() };
  for (const id of ids) {
    let node = root;
    for (const g of chain(id)) {
      if (!node.index.has(g)) {
        const child = { items: [], index: new Map() };
        node.index.set(g, child);
        node.items.push(child);
      }
      node = node.index.get(g);
    }
    node.items.push(id);
  }
  const flat = [];
  const walk = n => { for (const x of n.items) typeof x === "string" ? flat.push(x) : walk(x); };
  walk(root);
  return flat;
}

function satisfies(seq, c) {
  if (!c) return true;
  const pos = new Map(seq.map((id, i) => [id, i]));
  for (const [a, b] of c.before) if (pos.has(a) && pos.has(b) && pos.get(a) > pos.get(b)) return false;
  if (c.first && pos.has(c.first) && pos.get(c.first) !== 0) return false;
  if (c.last && pos.has(c.last) && pos.get(c.last) !== seq.length - 1) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Crossing minimization: median sweeps between neighbouring flow lanes plus local transposition,
// kept only if the total does not get worse. Bands are ordered by where their neighbours are.

function buildAdjacency(model, laneOfNode) {
  const adj = new Map(model.nodes.map(n => [n.id, new Set()]));
  for (const e of model.edges) {
    if (e.from === e.to || !adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
  }
  return adj;
}

function minimizeCrossings(lanes, order, adjacency, constraints, model) {
  const flowIds = lanes.flow.map(l => l.id);
  let best = cloneOrder(order);
  let bestScore = totalCrossings(lanes, order, adjacency, model);
  for (let it = 0; it < SWEEPS && bestScore > 0; it++) {
    const forward = it % 2 === 0;
    const seq = forward ? flowIds : [...flowIds].reverse();
    for (let k = 1; k < seq.length; k++) {
      const lane = seq[k], ref = seq[k - 1];
      sortByMedian(lane, ref, order, adjacency, constraints, model);
    }
    transpose(lanes, order, adjacency, constraints, model);
    const score = totalCrossings(lanes, order, adjacency, model);
    if (score < bestScore) {
      bestScore = score;
      best = cloneOrder(order);
    }
  }
  for (const [k, v] of best) order.set(k, v);
  for (const band of [lanes.before, lanes.after]) if (band) orderBand(band.id, lanes, order, adjacency, constraints, model);
}

function sortByMedian(lane, ref, order, adjacency, constraints, model) {
  const refPos = new Map(order.get(ref).map((id, i) => [id, i]));
  const ids = order.get(lane);
  const key = new Map();
  ids.forEach((id, i) => {
    const m = medianOf([...adjacency.get(id)].filter(w => refPos.has(w)).map(w => refPos.get(w)));
    key.set(id, m === null ? i : m);
  });
  const sorted = ids.map((id, i) => ({ id, i })).sort((a, b) => key.get(a.id) - key.get(b.id) || a.i - b.i).map(x => x.id);
  order.set(lane, enforce(sorted, constraints.get(lane), model));
}

/**
 * Swaps neighbours in each flow lane while that lowers the crossings. Swapping two adjacent nodes
 * u and v only changes the crossings between u's wires and v's wires (to the lanes on either side)
 * and the direction of the edges between u and v, so the change is counted from those alone instead
 * of recounting the lane: the same decisions as recounting, in O(deg u × deg v) per swap.
 */
function transpose(lanes, order, adjacency, constraints, model) {
  const flow = lanes.flow.map(l => l.id);
  const chainKey = groupChains(model);
  const directed = new Map();   // "u\0v" → number of edges from u to v (each runs upwards: 0.5)
  for (const e of model.edges) {
    if (e.from === e.to) continue;
    const k = e.from + "\0" + e.to;
    directed.set(k, (directed.get(k) ?? 0) + 1);
  }
  flow.forEach((lane, k) => {
    const c = constraints.get(lane);
    const sides = [flow[k - 1], flow[k + 1]].filter(x => x !== undefined).map(x => new Map(order.get(x).map((id, i) => [id, i])));
    // Neighbours of each node in each side lane, by position (side lanes do not move in this pass).
    const near = id => sides.map(pos => [...adjacency.get(id)].filter(w => pos.has(w)).map(w => pos.get(w)));
    const nearOf = new Map(order.get(lane).map(id => [id, near(id)]));
    let improved = true, guard = 0;
    while (improved && guard++ < 4) {
      improved = false;
      const ids = order.get(lane);
      // A lane whose constraints already split a group (or break a constraint) is left as it is:
      // no swap can make it whole, and any swap would be judged against a broken order.
      if (!satisfies(ids, c) || groupBlocks(ids, model).join() !== ids.join()) break;
      for (let i = 0; i < ids.length - 1; i++) {
        const u = ids[i], v = ids[i + 1];
        if (!canSwap(ids, i, c) || (chainKey(u) !== chainKey(v) && !staysGrouped(ids, i, model))) continue;
        let delta = 0;
        const nu = nearOf.get(u), nv = nearOf.get(v);
        for (let s = 0; s < sides.length; s++) for (const x of nu[s]) for (const y of nv[s]) {
          if (x > y) delta--;        // u above v: these two wires cross; after the swap they do not
          else if (x < y) delta++;   // and these do not cross now, but will
        }
        delta += 0.5 * ((directed.get(u + "\0" + v) ?? 0) - (directed.get(v + "\0" + u) ?? 0));
        if (delta < 0) { ids[i] = v; ids[i + 1] = u; improved = true; }
      }
    }
  });
}

/** Whether swapping ids[i] and ids[i + 1] keeps the lane's constraints (they hold before it). */
function canSwap(ids, i, c) {
  if (!c) return true;
  const u = ids[i], v = ids[i + 1];
  if (c.before.some(([a, b]) => a === u && b === v)) return false;
  if (c.first === u && i === 0) return false;
  if (c.last === v && i + 1 === ids.length - 1) return false;
  return true;
}

/** Whether the lane stays one block per group after swapping ids[i] and ids[i + 1]. */
function staysGrouped(ids, i, model) {
  const swapped = [...ids];
  [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
  return groupBlocks(swapped, model).join() === swapped.join();
}

/** A function giving each node's chain of groups as a key; nodes with the same key can swap freely. */
function groupChains(model) {
  const groups = new Map(model.groups.map(g => [g.id, g]));
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const memo = new Map();
  return id => {
    if (memo.has(id)) return memo.get(id);
    const out = [];
    let g = nodes.get(id)?.group;
    const guard = new Set();
    while (g != null && groups.has(g) && !guard.has(g)) { guard.add(g); out.push(g); g = groups.get(g).parent; }
    const key = out.join("\0");
    memo.set(id, key);
    return key;
  };
}

function orderBand(bandId, lanes, order, adjacency, constraints, model) {
  const rank = new Map(lanes.flow.map((l, i) => [l.id, i]));
  const pos = positionsOf(order);
  const laneOfNode = lanes.laneOfNode;
  const ids = order.get(bandId);
  const key = new Map();
  ids.forEach((id, i) => {
    const xs = [...adjacency.get(id)].filter(w => rank.has(laneOfNode.get(w)))
      .map(w => rank.get(laneOfNode.get(w)) + pos.get(w) / 1000);
    const m = medianOf(xs);
    key.set(id, m === null ? Infinity : m);
  });
  const sorted = ids.map((id, i) => ({ id, i })).sort((a, b) => (key.get(a.id) - key.get(b.id)) || a.i - b.i).map(x => x.id);
  order.set(bandId, enforce(sorted, constraints.get(bandId), model));
}

/** Crossings between `lane` and its neighbouring flow lanes, counted locally. */
function laneCrossings(lane, lanes, order, adjacency, pos) {
  const ids = lanes.flow.map(l => l.id);
  const k = ids.indexOf(lane);
  if (k < 0) return 0;
  let n = 0;
  if (k > 0) n += crossingsBetween(ids[k - 1], ids[k], order, adjacency, pos);
  if (k < ids.length - 1) n += crossingsBetween(ids[k], ids[k + 1], order, adjacency, pos);
  return n;
}

function totalCrossings(lanes, order, adjacency, model) {
  const pos = positionsOf(order);
  const ids = lanes.flow.map(l => l.id);
  let n = 0;
  for (let k = 0; k < ids.length - 1; k++) n += crossingsBetween(ids[k], ids[k + 1], order, adjacency, pos);
  for (const l of lanes.flow) n += sameLanePenalty(order.get(l.id), model);
  return n;
}

function crossingsBetween(a, b, order, adjacency, pos) {
  const inB = new Set(order.get(b));
  const segs = [];
  for (const u of order.get(a)) for (const v of adjacency.get(u)) if (inB.has(v)) segs.push([pos.get(u), pos.get(v)]);
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [p, q] = segs[i], [r, s] = segs[j];
    if ((p - r) * (q - s) < 0) n++;
  }
  return n;
}

/** Inside a lane, an edge should run downwards (origin before destination). */
function sameLanePenalty(ids, model) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  let n = 0;
  for (const e of model.edges) if (pos.has(e.from) && pos.has(e.to) && pos.get(e.from) > pos.get(e.to)) n++;
  return n * 0.5;
}

// ---------------------------------------------------------------------------------------------
// Balance: every flow lane gets as many row slots as the longest one. Shorter lanes place their
// nodes (keeping their order) in the slots nearest the median slot of their neighbours, so wires
// run straight.

function balance(lanes, order, adjacency) {
  const flowIds = lanes.flow.map(l => l.id);
  const rows = Math.max(1, ...flowIds.map(id => order.get(id).length));
  const slot = new Map();
  for (const id of flowIds) order.get(id).forEach((n, i) => slot.set(n, i));
  // Rows depend on the board alone, never on the previous drawing: the same board always gives
  // the same rows, also after a rename, an undo or a redraw. Stability comes from the sketch
  // (the order never changes by itself) and from medians, which only move near an edit.

  for (let pass = 0; pass < 4; pass++) {
    const seq = pass % 2 === 0 ? flowIds : [...flowIds].reverse();
    for (const laneId of seq) {
      const ids = order.get(laneId);
      if (ids.length === rows || ids.length === 0) continue;
      const targets = ids.map(id => medianOf([...adjacency.get(id)].filter(w => slot.has(w) && lanesOf(lanes, w) !== laneId).map(w => slot.get(w))));
      const result = placeInSlots(ids.length, rows, (k, r) => {
        const t = targets[k];
        return (t === null ? 0 : Math.abs(r - t)) + r * 1e-4;
      });
      ids.forEach((id, k) => slot.set(id, result[k]));
    }
  }
  // Bands: each node takes its index (bands lay out in their own row).
  for (const band of [lanes.before, lanes.after]) if (band) order.get(band.id).forEach((n, i) => slot.set(n, i));
  return { slot, rows };
}

function lanesOf(lanes, id) {
  return lanes.laneOfNode.get(id);
}

/** Strictly increasing slots for n items in R rows minimizing Σ cost(k, r). O(n·R). */
function placeInSlots(n, R, cost) {
  const INF = Number.POSITIVE_INFINITY;
  const best = Array.from({ length: n }, () => new Array(R).fill(INF));
  const from = Array.from({ length: n }, () => new Array(R).fill(-1));
  for (let r = 0; r <= R - n; r++) best[0][r] = cost(0, r);
  for (let k = 1; k < n; k++) {
    let runMin = INF, runArg = -1;
    for (let r = k; r <= R - n + k; r++) {
      const prev = best[k - 1][r - 1];
      if (prev < runMin) { runMin = prev; runArg = r - 1; }
      best[k][r] = runMin + cost(k, r);
      from[k][r] = runArg;
    }
  }
  let r = -1, m = INF;
  for (let x = n - 1; x < R; x++) if (best[n - 1][x] < m) { m = best[n - 1][x]; r = x; }
  const out = new Array(n);
  for (let k = n - 1; k >= 0; k--) { out[k] = r; r = from[k][r]; }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** forward, same (lane) or backward, by the rank of the lanes: before band, flow lanes, after band. */
function classifyEdges(model, laneOfNode, rank) {
  const out = new Map();
  for (const e of model.edges) {
    if (e.from === e.to) { out.set(e.id, "self"); continue; }
    const a = rank.get(laneOfNode.get(e.from)), b = rank.get(laneOfNode.get(e.to));
    out.set(e.id, a < b ? "forward" : a === b ? "same" : "backward");
  }
  return out;
}

function groupSpans(model, order, slot, nodes) {
  const spans = [];
  for (const g of model.groups) {
    const members = model.nodes.filter(n => inGroup(n, g.id, model)).map(n => n.id);
    if (!members.length) continue;
    const byLane = new Map();
    for (const id of members) {
      for (const [lane, ids] of order) if (ids.includes(id)) {
        if (!byLane.has(lane)) byLane.set(lane, []);
        byLane.get(lane).push(slot.get(id));
      }
    }
    for (const [lane, ss] of byLane) spans.push({ group: g.id, title: g.title ?? "", lane, from: Math.min(...ss), to: Math.max(...ss), depth: depthOf(g, model) });
  }
  return spans;
}

function inGroup(node, groupId, model) {
  const groups = new Map(model.groups.map(g => [g.id, g]));
  let g = node.group;
  const guard = new Set();
  while (g != null && !guard.has(g)) {
    if (g === groupId) return true;
    guard.add(g);
    g = groups.get(g)?.parent;
  }
  return false;
}

function depthOf(group, model) {
  const groups = new Map(model.groups.map(g => [g.id, g]));
  let d = 0, g = group.parent;
  while (g != null && groups.has(g) && d < 10) { d++; g = groups.get(g).parent; }
  return d;
}

function positionsOf(order) {
  const pos = new Map();
  for (const ids of order.values()) ids.forEach((id, i) => pos.set(id, i));
  return pos;
}

function cloneOrder(order) {
  return new Map([...order].map(([k, v]) => [k, [...v]]));
}

function medianOf(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
}

return { layout, bestInsertion, inversions };
})();

__modules.route = (() => {
// Wire routing: orthogonal wires that only run through free corridors, so no wire ever crosses a
// node. Pure: it works on numbers, never on the DOM.
//
// Everything is computed in flow coordinates: `u` runs along the flow (the direction lanes follow
// each other) and `v` across it (where the bands sit: "before" at small v, "after" at large v).
// The renderer converts boxes into flow coordinates and the resulting points back.
//
// Corridors: gutters g0..gN run across the flow between lanes (g0 and gN are the margins); four
// channels run along it: ct between the "before" band and the lanes, cb between the lanes and the
// "after" band, ca outside the "before" band and cz outside the "after" band (for wires between
// two nodes of the same band).
//
// Wires that leave (or reach) the selected node by the same side, through the same corridors, and
// reach the same side at the other end travel as a bundle: one trunk that branches at the end.
// Loops (wires that return to the side they left) never bundle: each one gets its own track.
// Each bundle gets its own track in every corridor and its own port on every side; the order of
// tracks and ports is chosen by exhaustive search over permutations (small lists) to minimize
// crossings and parallel runs closer than the minimum separation.

const ROUTE = Object.freeze({
  gutterPad: 15,   // closest a track gets to a node, along u
  channelPad: 16,  // closest a track gets to a node, along v
  trackStep: 11,   // distance between tracks in a gutter
  channelStep: 9,  // distance between tracks in a channel
  portPad: 10,     // closest a port gets to a corner, on the long side of a node
  portStep: 10,    // distance between ports on a side
  minSeparation: 6,
  arrow: 8,
  radius: 7,
  // Most work one route() may spend searching orders, in pairs of segments compared (about 50 ms
  // per million on a 2026 laptop). The busiest node of the examples and of a 35-node home map
  // spends under 3 million; a hub with dozens of wires would spend hundreds of millions. Past the
  // budget the search stops and keeps the best order found. Counted, not timed, so every machine
  // draws the same.
  budget: 6_000_000,
});

const PERMS = [[[]], [[0]]];
for (let n = 2; n <= 6; n++) {
  PERMS[n] = [];
  for (const p of PERMS[n - 1]) for (let i = 0; i <= p.length; i++) PERMS[n].push([...p.slice(0, i), n - 1, ...p.slice(i)]);
}

/**
 * Which corridors a wire takes and by which sides it leaves and enters (L R T B in flow terms:
 * L = start of the flow, R = end, T = towards the "before" band, B = towards the "after" band).
 * `pos(id)` gives abstract or measured centres {u, v}; `place(id)` gives {kind, col}.
 */
function topology(from, to, place, pos, channels) {
  const A = place(from), C = place(to), a = pos(from), c = pos(to);
  const channel = (v1, v2) => {
    const up = Math.abs(v1 - channels.ct) + Math.abs(v2 - channels.ct);
    const down = Math.abs(v1 - channels.cb) + Math.abs(v2 - channels.cb);
    return up <= down ? "ct" : "cb";
  };
  if (A.kind === "col" && C.kind === "col") {
    const i = A.col, j = C.col;
    if (j === i + 1) return { s: "R", e: "L", cor: ["g" + (i + 1)] };
    if (j === i - 1) return { s: "L", e: "R", cor: ["g" + i] };
    if (j === i) return { s: "R", e: "R", cor: ["g" + (i + 1)] };
    const ch = channel(a.v, c.v);
    if (j > i) return { s: "R", e: "L", cor: ["g" + (i + 1), ch, "g" + j] };
    return { s: "L", e: "R", cor: ["g" + i, ch, "g" + (j + 1)] };
  }
  if (A.kind === "col") {
    const towardsStart = c.u < a.u;
    return { s: towardsStart ? "L" : "R", e: C.kind === "top" ? "B" : "T", cor: ["g" + (towardsStart ? A.col : A.col + 1), C.kind === "top" ? "ct" : "cb"] };
  }
  if (C.kind === "col") return { s: A.kind === "top" ? "B" : "T", e: "L", cor: [A.kind === "top" ? "ct" : "cb", "g" + C.col] };
  if (A.kind === C.kind) {
    const side = A.kind === "top" ? "T" : "B";
    return { s: side, e: side, cor: [A.kind === "top" ? "ca" : "cz"] };
  }
  return { s: A.kind === "top" ? "B" : "T", e: C.kind === "top" ? "B" : "T", cor: [A.kind === "top" ? "ct" : "cb", "g0", C.kind === "top" ? "ct" : "cb"] };
}

/** Groups the wires touching `selected` into bundles (same direction, sides and corridors). */
function bundles(selected, edges, place, pos, channels) {
  const wires = [];
  for (const e of edges) {
    if (e.from === e.to || (e.from !== selected && e.to !== selected)) continue;
    const tp = topology(e.from, e.to, place, pos, channels);
    const k = e.from === selected ? "out" : "in";
    wires.push({
      id: e.id, ids: e.ids ?? [e.id], from: e.from, to: e.to, k, ...tp,
      far: k === "out" ? e.to : e.from,
      sideS: k === "out" ? tp.s : tp.e,
      sideF: k === "out" ? tp.e : tp.s,
      corS: k === "out" ? tp.cor : [...tp.cor].reverse(),
    });
  }
  const list = [], index = new Map();
  wires.forEach((w, i) => {
    // A wire that comes back to the side it left (same lane, or two nodes of the same band) is a
    // loop. Loops to different nodes nest like parentheses, and two nested loops on one track
    // always cross; each loop gets its own track and port, so the search can nest them.
    const loop = w.sideS === w.sideF && w.corS.length === 1;
    const key = `${w.k}|${w.sideS}|${w.corS.join(",")}|${w.sideF}${loop ? `|${w.far}` : ""}`;
    if (!index.has(key)) { index.set(key, list.length); list.push({ k: w.k, corS: w.corS, sideS: w.sideS, members: [] }); }
    w.h = index.get(key);
    list[w.h].members.push(i);
  });
  return { wires, bundles: list };
}

/**
 * How many tracks every corridor and how many ports every node side need, over every possible
 * selection. Sizing corridors for the worst case means selecting a node never moves anything.
 */
function demand(nodeIds, edges, place, pos, channels) {
  const tracks = new Map();
  const ports = new Map();
  const bump = (map, key, n) => map.set(key, Math.max(map.get(key) ?? 0, n));
  for (const id of nodeIds) {
    const { wires, bundles: bs } = bundles(id, edges, place, pos, channels);
    const perCorridor = new Map();
    const perSide = new Map();
    bs.forEach(b => {
      for (const c of b.corS) perCorridor.set(c, (perCorridor.get(c) ?? 0) + 1);
      perSide.set(`${id}:${b.sideS}`, (perSide.get(`${id}:${b.sideS}`) ?? 0) + 1);
    });
    for (const w of wires) perSide.set(`${w.far}:${w.sideF}`, (perSide.get(`${w.far}:${w.sideF}`) ?? 0) + 1);
    for (const [c, n] of perCorridor) bump(tracks, c, n);
    for (const [s, n] of perSide) bump(ports, s, n);
  }
  return { tracks, ports };
}

/** Width a corridor needs for `n` tracks. */
function corridorSize(n, kind) {
  const pad = kind === "g" ? ROUTE.gutterPad : ROUTE.channelPad;
  const step = kind === "g" ? ROUTE.trackStep : ROUTE.channelStep;
  return n <= 0 ? 0 : 2 * pad + (n - 1) * step + 2;
}

/** Length a node side needs for `n` ports. */
function sideSize(n) {
  return n <= 1 ? 0 : 2 * ROUTE.portPad + (n - 1) * ROUTE.portStep;
}

/**
 * Routes the wires of `selected`.
 * @param g.boxes Map id → {l, r, t, b} in flow coordinates (l/r along u, t/b along v)
 * @param g.corridors {g0..gN, ct, cb, ca, cz} → {a, b} extents in flow coordinates
 * @param g.place id → {kind: "top"|"col"|"bot", col}
 * @returns { wires: [{id, from, to, k, h, points}], crossings }
 */
function route(selected, edges, g) {
  const centre = id => { const r = g.boxes.get(id); return { u: (r.l + r.r) / 2, v: (r.t + r.b) / 2 }; };
  const channels = { ct: mid(g.corridors.ct), cb: mid(g.corridors.cb) };
  const { wires, bundles: hs } = bundles(selected, edges, g.place, centre, channels);
  if (!wires.length) return { wires: [], crossings: 0 };

  const lists = new Map();
  const put = (k, v) => { if (!lists.has(k)) lists.set(k, []); lists.get(k).push(v); };
  hs.forEach((h, j) => {
    put("P" + selected + ":" + h.sideS, { h: j });
    h.corS.forEach(p => put("C" + p, { h: j }));
  });
  wires.forEach((w, i) => put("P" + w.far + ":" + w.sideF, { i }));

  // Starting order: ports by where their wire turns next; tracks by where their bundle ends.
  const corridorMid = p => mid(g.corridors[p]);
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const target = (h, axis) => mean(hs[h].members.map(i => centre(wires[i].far)[axis]));
  const axisOf = side => (side === "L" || side === "R" ? "v" : "u");
  const key = item => {
    if (item.h !== undefined) {
      const h = hs[item.h];
      return h.corS[1] ? corridorMid(h.corS[1]) : target(item.h, axisOf(h.sideS));
    }
    const w = wires[item.i], cor = [...w.corS].reverse();
    return cor[1] ? corridorMid(cor[1]) : centre(selected)[axisOf(w.sideF)];
  };
  for (const [k, l] of lists) {
    if (k[0] === "P") l.sort((x, y) => key(x) - key(y));
    else { const axis = k[1] === "g" ? "v" : "u"; l.sort((x, y) => target(x.h, axis) - target(y.h, axis)); }
  }

  const slotOf = (k, pred) => { const l = lists.get(k); return [l.findIndex(pred), l.length]; };
  const port = (id, side, pos, n) => {
    const r = g.boxes.get(id);
    if (side === "L" || side === "R") return { u: side === "L" ? r.l : r.r, v: spread(r.t, r.b, n, pos, ROUTE.portPad, ROUTE.portStep) };
    return { u: spread(r.l, r.r, n, pos, 16, 18), v: side === "T" ? r.t : r.b };
  };
  const track = (p, h) => {
    const [pos, n] = slotOf("C" + p, v => v.h === h);
    const c = g.corridors[p];
    return p[0] === "g" ? spread(c.a, c.b, n, pos, ROUTE.gutterPad, ROUTE.trackStep) : spread(c.a, c.b, n, pos, ROUTE.channelPad, ROUTE.channelStep);
  };
  const points = i => {
    const w = wires[i];
    const [ps, ns] = slotOf("P" + selected + ":" + w.sideS, v => v.h === w.h);
    const [pf, nf] = slotOf("P" + w.far + ":" + w.sideF, v => v.i === i);
    const A = port(selected, w.sideS, ps, ns), F = port(w.far, w.sideF, pf, nf);
    const pts = [A];
    let p = A;
    for (const c of w.corS) {
      p = c[0] === "g" ? { u: track(c, w.h), v: p.v } : { u: p.u, v: track(c, w.h) };
      pts.push(p);
    }
    pts.push(w.sideF === "L" || w.sideF === "R" ? { u: p.u, v: F.v } : { u: F.u, v: p.v });
    pts.push(F);
    const clean = simplify(pts);
    return w.k === "out" ? clean : clean.reverse();
  };

  // score() runs thousands of times while a search moves one or two lists between calls, so only a
  // few wires change shape. Each wire keeps its segments and length, each pair its clashes, and only
  // the pairs that involve a wire whose points changed are measured again. Same result, far less work.
  const W = wires.length;
  let work = 0;
  const over = () => work > ROUTE.budget;
  const shape = new Array(W).fill(null), segsOf = new Array(W), lengthOf = new Float64Array(W);
  const pair = new Float64Array(W * W);
  const score = () => {
    work += 17 * W;   // re-pointing a wire costs about as much as 17 pairs of segments compared
    const moved = [];
    for (let i = 0; i < W; i++) {
      const pts = points(i);
      const k = pts.map(p => p.u + "," + p.v).join(" ");
      if (k === shape[i]) continue;
      shape[i] = k;
      const s = segments(pts);
      segsOf[i] = s;
      let len = 0;
      for (const [p, q] of s) len += Math.abs(p.u - q.u) + Math.abs(p.v - q.v);
      lengthOf[i] = len;
      moved.push(i);
    }
    if (moved.length) {
      const isMoved = new Uint8Array(W);
      for (const i of moved) isMoved[i] = 1;
      for (let a = 0; a < W; a++) for (let b = a + 1; b < W; b++) {
        if (!isMoved[a] && !isMoved[b]) continue;
        work += segsOf[a].length * segsOf[b].length;
        let c = 0;
        if (wires[a].h !== wires[b].h) for (const s1 of segsOf[a]) for (const s2 of segsOf[b]) c += clash(s1, s2);
        pair[a * W + b] = c;
      }
    }
    let total = 0, length = 0;
    for (let a = 0; a < W; a++) {
      length += lengthOf[a];
      for (let b = a + 1; b < W; b++) total += pair[a * W + b];
    }
    return total + length * 1e-5;
  };

  const tryPortsThenTracks = (kp, kc) => {
    const P = lists.get(kp), C = lists.get(kc);
    const baseP = [...P];
    let keepP = [...P], keepC = [...C];
    for (const perm of PERMS[baseP.length]) {
      if (over()) break;
      perm.forEach((o, q) => { P[q] = baseP[o]; });
      for (let pass = 0, moved = true; moved && pass < 3 && !over(); pass++) {
        moved = false;
        for (let i = 0; i < C.length && !over(); i++) {
          const item = C[i];
          let at = i, s0 = score();
          C.splice(i, 1);
          for (let j = 0; j <= C.length; j++) {
            C.splice(j, 0, item);
            const s = score();
            if (s < s0 - 1e-9) { s0 = s; at = j; }
            C.splice(j, 1);
          }
          C.splice(at, 0, item);
          if (at !== i) moved = true;
        }
      }
      const s = score();
      if (s < best - 1e-9) { best = s; keepP = [...P]; keepC = [...C]; if (best < 1) break; }
    }
    P.splice(0, P.length, ...keepP);
    C.splice(0, C.length, ...keepC);
  };

  const fact = n => (n <= 1 ? 1 : n * fact(n - 1));
  const live = [...lists.keys()].filter(k => lists.get(k).length > 1 && lists.get(k).length <= 6);
  let best = score();
  const tryGroup = group => {
    const bases = group.map(k => [...lists.get(k)]);
    let keep = bases.map(b => [...b]), improved = false;
    const rec = j => {
      if (j === group.length) {
        const s = score();
        if (s < best - 1e-9) { best = s; keep = group.map(k => [...lists.get(k)]); improved = true; }
        return;
      }
      for (const perm of PERMS[bases[j].length]) {
        if (over()) break;
        const l = lists.get(group[j]);
        perm.forEach((o, q) => { l[q] = bases[j][o]; });
        rec(j + 1);
      }
    };
    rec(0);
    group.forEach((k, j) => { lists.get(k).splice(0, lists.get(k).length, ...keep[j]); });
    return improved;
  };
  const cost = keys => keys.reduce((a, k) => a * fact(lists.get(k).length), 1);
  const pairwise = keys => {
    const groups = keys.map(k => [k]);
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      if (fact(lists.get(keys[a]).length) * fact(lists.get(keys[b]).length) <= 1500) groups.push([keys[a], keys[b]]);
    }
    for (let round = 0; round < 6 && best >= 1 && !over(); round++) {
      let any = false;
      for (const grp of groups) any = tryGroup(grp) || any;
      if (!any) break;
    }
  };
  if (best >= 1) {
    if (cost(live) <= 6000) tryGroup(live);
    else {
      // Too many orders to try at once. Lists that share no bundle cannot trade places, so each
      // connected set is searched on its own: loops on one side of a node no longer use up the
      // budget of the wires on another side.
      for (const set of connected(live, k => lists.get(k).map(item => (item.h !== undefined ? item.h : wires[item.i].h)))) {
        if (best < 1) break;
        if (cost(set) <= 6000) tryGroup(set);
        else pairwise(set);
      }
    }
  }
  // Still crossings: the ports of a side and the tracks of the corridor next to it decide
  // together. Try every order of the ports and, for each, move every track to its best place.
  if (best >= 1) {
    for (const kp of [...lists.keys()].filter(k => k.startsWith("P" + selected + ":") && lists.get(k).length > 1 && lists.get(k).length <= 6)) {
      const hsOnSide = new Set(lists.get(kp).map(v => v.h));
      const corridors = [...lists.keys()].filter(k => k[0] === "C" && lists.get(k).length > 1 && lists.get(k).some(v => hsOnSide.has(v.h)));
      for (const kc of corridors) if (best >= 1 && !over()) tryPortsThenTracks(kp, kc);
    }
  }
  return {
    wires: wires.map((w, i) => ({ id: w.id, ids: w.ids, from: w.from, to: w.to, k: w.k, h: w.h, points: points(i) })),
    crossings: Math.floor(best),
    lists: g.debug ? [...lists].map(([k, l]) => `${k}:${l.length}`) : undefined,
  };
}

/** Groups `keys` into sets linked by a shared member (`membersOf(key)` lists a key's members). */
function connected(keys, membersOf) {
  const root = new Map(keys.map(k => [k, k]));
  const find = k => { while (root.get(k) !== k) k = root.get(k); return k; };
  const owner = new Map();
  for (const k of keys) for (const m of membersOf(k)) {
    if (owner.has(m)) root.set(find(k), find(owner.get(m)));
    else owner.set(m, k);
  }
  const sets = new Map();
  for (const k of keys) {
    const r = find(k);
    if (!sets.has(r)) sets.set(r, []);
    sets.get(r).push(k);
  }
  return [...sets.values()];
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers (shared with the renderer and the audit)

/** n positions centred in [a, b], at most `step` apart and at least `pad` from either end. */
function spread(a, b, n, i, pad, step) {
  if (n === 1) return (a + b) / 2;
  const room = Math.max(0, (b - pad) - (a + pad));
  const s = Math.min(step, room / (n - 1));
  return (a + b) / 2 + (i - (n - 1) / 2) * s;
}

function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.u - p.u) < 0.5 && Math.abs(q.v - p.v) < 0.5) continue;
    out.push({ ...p });
  }
  // Snap neighbours that are almost aligned, so every segment is exactly horizontal or vertical
  // (a sub-pixel difference would otherwise leave a tiny diagonal).
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (Math.abs(a.v - b.v) < 0.5) b.v = a.v;
    else if (Math.abs(a.u - b.u) < 0.5) b.u = a.u;
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((a.u === b.u && b.u === c.u) || (a.v === b.v && b.v === c.v)) out.splice(i, 1);
  }
  return out;
}

function segments(pts) {
  const s = [];
  for (let j = 0; j < pts.length - 1; j++) s.push([pts[j], pts[j + 1]]);
  return s;
}

/** 1 for a crossing, 4 for parallel runs closer than the minimum separation that overlap. */
function clash(s1, s2) {
  const flat = s => Math.abs(s[0].v - s[1].v) < 0.5;
  const [a1, a2] = s1, [b1, b2] = s2;
  const inside = (x, p, q) => x > Math.min(p, q) + 0.5 && x < Math.max(p, q) - 0.5;
  if (flat(s1) && flat(s2)) {
    if (Math.abs(a1.v - b1.v) >= ROUTE.minSeparation) return 0;
    return overlap(a1.u, a2.u, b1.u, b2.u) > 1 ? 4 : 0;
  }
  if (!flat(s1) && !flat(s2)) {
    if (Math.abs(a1.u - b1.u) >= ROUTE.minSeparation) return 0;
    return overlap(a1.v, a2.v, b1.v, b2.v) > 1 ? 4 : 0;
  }
  const [h, v] = flat(s1) ? [s1, s2] : [s2, s1];
  return inside(v[0].u, h[0].u, h[1].u) && inside(h[0].v, v[0].v, v[1].v) ? 1 : 0;
}

function overlap(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function mid(c) {
  return (c.a + c.b) / 2;
}

return { ROUTE, topology, bundles, demand, corridorSize, sideSize, route, spread, simplify, segments, clash };
})();

__modules.styles = (() => {
// The component's stylesheet. Every colour and size is a custom property of the .atlas wrapper,
// read from an `--atlas-*` variable of the page when it exists, so a host page themes it without
// reaching inside the shadow root. Dark values apply with prefers-color-scheme or theme="dark".
//
// The variables live on .atlas, not on :host: a rule for :host applies to the host element itself,
// where the page's own variables are, so `--paper` there would collide with a page that also has
// `--paper` and sets `--atlas-paper: var(--paper)` (a cycle that leaves both empty). On .atlas
// they only shadow what is inside, and the same rules work without a shadow root.

const STYLES = `
:host {
  display: block;
  container-type: inline-size;
}
.atlas {
  --paper: var(--atlas-paper, #f1f4f7);
  --sheet: var(--atlas-sheet, #ffffff);
  --ink: var(--atlas-ink, #132033);
  --ink-2: var(--atlas-ink-2, #55657c);
  --rule: var(--atlas-rule, #cdd6e1);
  --grid: var(--atlas-grid, #e1e7ee);
  --out: var(--atlas-out, #a94e19);
  --in: var(--atlas-in, #2a64a8);
  --shadow: var(--atlas-shadow, rgba(20, 32, 51, .28));
  --radius: var(--atlas-radius, 6px);
  --mono: var(--atlas-font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  --node-min: var(--atlas-node-min, 150px);
  color: var(--ink);
  font: inherit;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) .atlas, :not([theme="light"]) > .atlas {
    --paper: var(--atlas-paper, #0c141e); --sheet: var(--atlas-sheet, #132030); --ink: var(--atlas-ink, #e3eaf2);
    --ink-2: var(--atlas-ink-2, #98a9bd); --rule: var(--atlas-rule, #2a3a4e); --grid: var(--atlas-grid, #152232);
    --out: var(--atlas-out, #e88d52); --in: var(--atlas-in, #6ea8ec); --shadow: var(--atlas-shadow, rgba(0, 0, 0, .55));
  }
}
:host([theme="dark"]) .atlas, [theme="dark"] > .atlas {
  --paper: var(--atlas-paper, #0c141e); --sheet: var(--atlas-sheet, #132030); --ink: var(--atlas-ink, #e3eaf2);
  --ink-2: var(--atlas-ink-2, #98a9bd); --rule: var(--atlas-rule, #2a3a4e); --grid: var(--atlas-grid, #152232);
  --out: var(--atlas-out, #e88d52); --in: var(--atlas-in, #6ea8ec); --shadow: var(--atlas-shadow, rgba(0, 0, 0, .55));
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--in); outline-offset: 2px; }

/* Two stacking contexts: nothing of the board (its lanes and wires have z-indexes) paints over the
   detail panel when the panel is a drawer that overlaps it, and nothing of Atlas over the page. */
.atlas { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); align-items: start; isolation: isolate; }
.atlas[data-panel="side"] { grid-template-columns: minmax(0, 1fr) var(--atlas-panel-width, 300px); }
.atlas[data-panel="none"] .panel { display: none; }

.board {
  position: relative; display: grid; min-width: 0;
  border: 1px solid var(--rule); border-radius: var(--radius);
  background-color: var(--paper);
  background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  padding: 16px;
  /* Fills its box, and never gets narrower than its content can go (gutters and channels at
     their size, every lane at --node-min): below that, the wrapper scrolls sideways. */
  width: auto;
  min-width: min-content;
}
/* The board is geometry: lanes, corridors and wires are measured left to right, so it stays left to
   right on a right-to-left page (each text follows its own direction, see txt() in atlas.js). */
.board-wrap { min-width: 0; overflow-x: auto; isolation: isolate; direction: ltr; }

/* Bands and lanes */
.lane-title {
  margin: 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-2);
  display: flex; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere;
}
.lane-title::after { content: ""; flex: 1; height: 1px; background: var(--rule); }
.lane-title:empty { display: none; }
ol.nodes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; min-width: 0; }
ol.nodes > li { min-width: 0; display: grid; }
ol.nodes > li > .panel { margin-top: 10px; }
.band { display: grid; gap: 10px; min-width: 0; position: relative; z-index: 1; }
.band.after .lane-title { order: 2; }
.flow { display: grid; min-width: 0; position: relative; z-index: 1; }
.lane { display: grid; min-width: 0; }
.group-box {
  position: relative; border: 1px dashed var(--rule); border-radius: calc(var(--radius) + 2px);
  margin: -6px; pointer-events: none; z-index: 0;
}
.group-box > span {
  position: absolute; top: -9px; left: 10px; max-width: calc(100% - 20px); padding: 0 6px; background: var(--paper);
  font: 500 11px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere;
}

/* Nodes */
.node {
  position: relative; display: block; width: 100%; min-width: 0; text-align: start;
  background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px;
  padding: 9px 12px 10px; cursor: pointer;
  transition: opacity .2s, border-color .2s, box-shadow .2s;
}
.node .t { display: block; font-weight: 600; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.node .s { display: block; font: 11.5px/1.35 var(--mono); color: var(--ink-2); margin-top: 2px; overflow-wrap: anywhere; }
.node:hover { border-color: var(--ink-2); }
/* Nodes outside the selection step back without losing their text: paper instead of sheet, a faint
   border and the secondary ink, which keeps 4.5:1 on the paper (WCAG 1.4.3). Opacity would not. */
.board.has-selection .node:not(.on, .near-in, .near-out) { background: var(--paper); border-color: var(--grid); }
.board.has-selection .node:not(.on, .near-in, .near-out) .t { color: var(--ink-2); font-weight: 500; }
.node.on { border-color: var(--out); box-shadow: 0 0 0 1.5px var(--out); }
.node.near-out { border-color: var(--out); }
.node.near-in { border-color: var(--in); }

/* Wires: above the nodes; routing keeps them in the corridors, so they never cover one. */
svg.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
.casing { fill: none; stroke: var(--paper); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.wire { fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.wire.out { stroke: var(--out); } .wire.in { stroke: var(--in); }
.wire.backward { stroke-dasharray: 6 4; }
.arrow.out, .dot.out { fill: var(--out); } .arrow.in, .dot.in { fill: var(--in); }
.dot { stroke: var(--sheet); stroke-width: 1.5; }
@media (prefers-reduced-motion: no-preference) {
  .wire.draw, .casing.draw {
    stroke-dasharray: var(--len) var(--len); stroke-dashoffset: var(--len);
    animation: atlas-trace var(--t, .5s) linear var(--d, 0s) forwards;
  }
  .wire.backward.draw { animation-name: atlas-trace-dashed; }
  .arrow.draw { opacity: 0; animation: atlas-appear .14s ease-out var(--d, 0s) forwards; }
  .dot.draw { opacity: 0; animation: atlas-appear .12s ease-out var(--d, 0s) forwards; }
}
@keyframes atlas-trace { to { stroke-dashoffset: 0; } }
@keyframes atlas-trace-dashed { 0% { stroke-dashoffset: var(--len); } 99% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; stroke-dasharray: 6 4; } }
@keyframes atlas-appear { to { opacity: 1; } }

/* Panel */
.panel {
  background: var(--sheet); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 18px 18px 20px; display: grid; gap: 12px; min-width: 0;
}
.atlas[data-panel="side"] .panel { position: sticky; top: 16px; }
.atlas[data-panel="below"] .panel { position: sticky; bottom: 12px; max-height: 42vh; overflow: auto; box-shadow: 0 12px 32px -8px var(--shadow); }
.panel .p-lane { margin: 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-2); }
.panel h3 { margin: 0; font-size: 1.4rem; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
.panel .p-sub { margin: 0; font: 12.5px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
.panel li { overflow-wrap: anywhere; }
.panel ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; list-style: disc; } /* inline, the panel sits in a lane's list */
.rel { display: grid; gap: 6px; }
.rel h4 { margin: 4px 0 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; display: flex; align-items: center; gap: 8px; }
.rel h4::before { content: ""; width: 16px; height: 2px; }
.rel[data-dir="in"] h4 { color: var(--in); } .rel[data-dir="in"] h4::before { background: var(--in); }
.rel[data-dir="out"] h4 { color: var(--out); } .rel[data-dir="out"] h4::before { background: var(--out); }
.rel ul { list-style: none; padding: 0; }
.rel button { display: grid; gap: 1px; width: 100%; min-width: 0; text-align: start; background: transparent; border: 1px solid var(--rule); border-radius: 4px; padding: 7px 10px; cursor: pointer; }
.rel button:hover { border-color: var(--ink-2); }
.rel .rt { font-weight: 600; font-size: 13.5px; }
.rel .rd { font-size: 12px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.rel .rw { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Stacked: lanes one after another, no wires, the detail opens under the node. Every grid of the
   flow layout sets its tracks and positions inline; here they all go back to one column, and the
   parts that only exist for wires (gutters, channels) leave the grid, or their explicit positions
   would open implicit columns. */
.atlas[data-mode="stack"] .board { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .board > * { grid-column: auto !important; grid-row: auto !important; }
.atlas[data-mode="stack"] .gutter, .atlas[data-mode="stack"] .channel { display: none; }
.atlas[data-mode="stack"] .band { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .band > * { grid-column: auto !important; grid-row: auto !important; order: 0 !important; }
.atlas[data-mode="stack"] .band.after .lane-title { order: -1 !important; }
.atlas[data-mode="stack"] ol.nodes { margin: 0 !important; }
.atlas[data-mode="stack"] .lane ol.nodes { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .node { min-height: 0 !important; min-width: 0 !important; }
.atlas[data-mode="stack"] .flow { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; gap: 26px; }
.atlas[data-mode="stack"] .lane { grid-column: auto !important; grid-row: auto !important; grid-template-rows: none !important; grid-template-columns: none !important; gap: 10px; }
.atlas[data-mode="stack"] .lane > * { grid-row: auto !important; grid-column: auto !important; }
.atlas[data-mode="stack"] ol.nodes > li { grid-row: auto !important; grid-column: auto !important; }
.atlas[data-mode="stack"] .band ol.nodes { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; grid-template-rows: none !important; grid-auto-flow: row dense; }
/* In a band of two columns the detail takes a whole row; dense placement keeps the neighbour of the
   selected node beside it, so the detail opens under the pair. */
.atlas[data-mode="stack"] ol.nodes > .panel { grid-column: 1 / -1 !important; }
.atlas[data-mode="stack"] svg.wires { display: none; }
.atlas[data-mode="stack"] .board { gap: 26px !important; width: auto; min-width: 0; }
.atlas[data-mode="stack"] .group-box { display: none; }
.atlas[data-mode="stack"] .lane-gap { display: none; }
`;

return { STYLES };
})();

__modules.atlas = (() => {
// Atlas: renders a board document as a live map and edits it through a small API.
//
//   const map = new Atlas(element, { document, selected: "a" });
//   map.addNode({ id: "b", title: "B", lane: "in" });     // placed in the best gap, animated
//   map.connect("a", "b", { label: "feeds" });
//   map.undo();
//   map.addEventListener("select", e => console.log(e.detail.id));
//
// Pipeline on every change: model → layout (pure) → corridor demand (pure) → DOM → measure →
// route the selected node's wires (pure) → paint. Text always goes in with textContent, never as
// HTML, and no CSS value comes from the data.

const M = __modules.model;
const { layout: computeLayout, bestInsertion, inversions } = __modules.layout;
const { route, demand, corridorSize, sideSize, ROUTE } = __modules.route;
const { STYLES } = __modules.styles;

const NS = "http://www.w3.org/2000/svg";
const SPEED = 1150;          // px per second: every wire traces at the same speed
const BUNDLE_STAGGER = 0.09; // seconds between bundles
const MIN_GUTTER = 56;
const MIN_CHANNEL = 30;
const MIN_OUTER = 26;
const STACK_BELOW = 720;   // px of container under which lanes stack
const BAND_NODE_MIN = 96;  // px: narrowest a node of a band gets
const PANEL_GAP = 20;      // px between the board and a side panel (.atlas gap)
const STAGES = { remove: 200, move: 450, add: 250, stagger: 30, staggerCap: 120 };
const STATUS = /^[a-z0-9_-]{1,32}$/;
const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const DEFAULT_LABELS = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  unassigned: "Unassigned",
  selfLoop: "Feeds back into itself",
  board: "Map",       // accessible name of the board when the board has no meta.title
  detail: "Detail",   // accessible name of the detail panel
};

class Atlas extends EventTarget {
  /**
   * @param host element to render into (a shadow root is attached unless `options.shadow` is false)
   * @param options.document board (object or JSON text)
   * @param options.selected id of the node selected at start (default: meta.selected)
   * @param options.panel "auto" | false — show the detail panel
   * @param options.labels texts of the interface (incoming, outgoing, unassigned, selfLoop)
   * @param options.renderNode (node, button, live) => void — custom node content
   * @param options.animate trace wires when selecting (default true)
   * @param options.shadow render into a shadow root (default true)
   * Options and labels set to undefined keep their defaults.
   */
  constructor(host, options = {}) {
    super();
    this.host = host;
    this.options = { panel: "auto", animate: true, shadow: true, historyLimit: 200, ...clean(options) };
    this.labels = { ...DEFAULT_LABELS, ...clean(options.labels ?? {}) };
    this.root = this.options.shadow ? (host.shadowRoot ?? host.attachShadow({ mode: "open" })) : host;
    this._els = new Map();        // node id → button
    this._items = new Map();      // node id → li
    this._live = new Map();       // node id → { subtitle, status }
    this._idOf = new WeakMap();   // button → node id (survives renames)
    this._history = [];
    this._future = [];
    this._rev = 0;
    this._selected = null;
    this._layout = null;
    this._animations = [];
    this._frame = 0;
    this._mount();
    this._model = M.normalize({ nodes: [] });
    if (options.document !== undefined) this.load(options.document, { selected: options.selected });
  }

  // -------------------------------------------------------------------------------------------
  // Reading

  /** The board as it should be saved (canonical, with the current order as its sketch). */
  toJSON() { return M.serialize(this._model); }
  export() { return this.toJSON(); }
  get rev() { return this._rev; }
  get selected() { return this._selected; }
  /** Warnings of the board (validate) and of its placement (a group split by constraints). */
  get warnings() { return [...(this._warnings ?? []), ...(this._layout?.warnings ?? [])]; }
  node(id) { const n = this._model.nodes.find(x => x.id === id); return n ? M.clone(n) : null; }
  edges(id) {
    return this._model.edges.filter(e => e.from === id || e.to === id).map(e => M.clone(e));
  }
  /** Nodes whose title, subtitle or details contain `text` (case-insensitive). */
  find(text) {
    const q = String(text).toLocaleLowerCase();
    return this._model.nodes.filter(n => [n.title, n.subtitle, ...(n.details ?? [])].some(s => typeof s === "string" && s.toLocaleLowerCase().includes(q))).map(n => n.id);
  }
  /** Nodes that contradict their lane: most of their edges run backwards. Advice, never applied. */
  suggestions() {
    const out = [];
    const L = this._layout;
    if (!L) return out;
    for (const n of this._model.nodes) {
      const es = this._model.edges.filter(e => (e.from === n.id || e.to === n.id) && e.from !== e.to);
      if (es.length < 2) continue;
      const back = es.filter(e => L.edgeClass.get(e.id) === "backward").length;
      if (back * 2 > es.length) out.push({ node: n.id, code: "lane", message: `most edges of "${n.id}" run against the flow; check its lane` });
    }
    if (L.flow.some(l => l.id === M.UNASSIGNED)) out.push({ code: "unassigned", message: "some nodes have no lane" });
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Loading and editing. Every edit is one undoable step and fires a "change" event.

  /** Replaces the board. A board not yet ordered by Atlas is tidied once (fewest crossings). */
  load(input, { optimize, selected } = {}) {
    const { model, warnings } = M.load(input);
    const tidy = optimize ?? model.meta.ordered !== true;
    let m = model;
    if (tidy) {
      const L = computeLayout(m, { optimize: true });
      m = withOrder(m, L);
    }
    m.meta.ordered = true;
    this._model = m;
    this._warnings = warnings;
    this._history = [];
    this._future = [];
    this._live.clear();
    this._rev++;
    this._render({ animate: false });
    const first = selected === undefined ? (m.meta.selected ?? null) : selected;
    this.select(first && m.nodes.some(n => n.id === first) ? first : null, { focus: false, animate: this.options.animate });
    this._emit("change", { rev: this._rev, diff: null, warnings: this.warnings });
    return this;
  }

  /** Applies raw operations (see model.js OPS) as one step. */
  apply(ops) {
    const before = this._model;
    const { model, warnings } = M.apply(before, ops);
    this._commit(before, model, warnings);
    return this._rev;
  }

  /** Groups several edits into one undoable step: map.batch(m => { m.addNode(...); m.connect(...) }). */
  batch(fn) {
    const before = this._model;
    const proxy = new Batch(this, before);
    fn(proxy);
    if (proxy.model !== before) this._commit(before, proxy.model, proxy.warnings);
    return this._rev;
  }

  /** Adds a node. Without an explicit index it goes to the gap with fewest crossings. */
  addNode(node, { index, edges = [] } = {}) {
    return this.batch(b => b.addNode(node, { index, edges }));
  }
  updateNode(id, changes) { return this.apply({ op: "updateNode", id, changes }); }
  moveNode(id, { lane, index } = {}) { return this.apply({ op: "moveNode", id, lane, index }); }
  removeNode(id) { return this.apply({ op: "removeNode", id }); }
  renameNode(from, to) {
    // The element stays the same node on screen: it glides (if anything), never fades out and in.
    const swapKey = (map, a, b) => { if (map.has(a)) { map.set(b, map.get(a)); map.delete(a); } };
    const rekey = (a, b) => {
      swapKey(this._els, a, b);
      swapKey(this._items, a, b);
      swapKey(this._live, a, b);
      this._idOf.set(this._els.get(b), b);
    };
    const moved = this._els.has(from) && !this._els.has(to);
    const selected = this._selected === from;
    if (moved) rekey(from, to);
    if (selected) this._selected = to;
    let rev;
    try {
      rev = this.apply({ op: "renameNode", from, to });
    } catch (e) {
      if (moved) rekey(to, from);   // the edit was refused: the screen keeps the old id
      if (selected) this._selected = from;
      throw e;
    }
    if (selected) this._emit("select", { id: to });
    return rev;
  }
  connect(from, to, { id, label, details, type } = {}) {
    return this.apply({ op: "addEdge", edge: clean({ id, from, to, label, details, type }) });
  }
  updateEdge(id, changes) { return this.apply({ op: "updateEdge", id, changes }); }
  disconnect(idOrPair) {
    const id = typeof idOrPair === "string" ? idOrPair
      : this._model.edges.find(e => e.from === idOrPair?.from && e.to === idOrPair?.to)?.id;
    if (id === undefined) {
      throw new M.AtlasError([{ path: "", code: "invalid", message: `no edge from "${idOrPair?.from}" to "${idOrPair?.to}"` }]);
    }
    return this.apply({ op: "removeEdge", id });
  }
  addLane(lane, { index } = {}) { return this.apply({ op: "addLane", lane, index }); }
  updateLane(id, changes) { return this.apply({ op: "updateLane", id, changes }); }
  moveLane(id, index) { return this.apply({ op: "moveLane", id, index }); }
  removeLane(id, { moveTo } = {}) { return this.apply({ op: "removeLane", id, moveTo }); }
  addGroup(group) { return this.apply({ op: "addGroup", group }); }
  updateGroup(id, changes) { return this.apply({ op: "updateGroup", id, changes }); }
  removeGroup(id) { return this.apply({ op: "removeGroup", id }); }
  addConstraint(constraint) { return this.apply({ op: "addConstraint", constraint }); }
  removeConstraint(index) { return this.apply({ op: "removeConstraint", index }); }
  /** Optionally moves a node, then marks it pinned: reorderAll() leaves it where it is. */
  pin(id, { lane, index } = {}) {
    return this.batch(b => {
      if (lane !== undefined || index !== undefined) b.apply({ op: "moveNode", id, lane, index });
      b.apply({ op: "updateNode", id, changes: { pinned: true } });
    });
  }
  unpin(id) { return this.apply({ op: "updateNode", id, changes: { pinned: null } }); }
  setMeta(changes) { return this.apply({ op: "setMeta", changes }); }

  /**
   * Reorders every lane for the fewest crossings. With { dryRun: true } it only reports how many
   * pairs of nodes would swap. Pinned nodes keep their place.
   */
  reorderAll({ dryRun = false } = {}) {
    const now = this._layout ?? computeLayout(this._model);
    let m = withOrder(this._model, computeLayout(this._model, { optimize: true }), true);
    // Groups and constraints apply again when the result is drawn. A lane where that would move a
    // pinned node keeps its current order: pinned nodes never move.
    const drawn = computeLayout(m);
    const pinned = new Set(this._model.nodes.filter(n => n.pinned).map(n => n.id));
    const kept = [...now.order].filter(([lane, ids]) => ids.some((id, i) => pinned.has(id) && drawn.order.get(lane)?.[i] !== id)).map(([lane]) => lane);
    if (kept.length) m = withOrder(this._model, { ...drawn, order: new Map([...drawn.order].map(([lane, ids]) => [lane, kept.includes(lane) ? now.order.get(lane) : ids])) });
    // Counted on the order that results, after pinned nodes went back to their places.
    const swaps = inversions(now, computeLayout(m));
    if (dryRun || swaps === 0) return { swaps };
    this._commit(this._model, m, this._warnings, { long: true });
    return { swaps };
  }

  undo() {
    const prev = this._history.pop();
    if (!prev) return false;
    this._future.push(this._model);
    this._swap(prev);
    return true;
  }
  redo() {
    const next = this._future.pop();
    if (!next) return false;
    this._history.push(this._model);
    this._swap(next);
    return true;
  }
  /** Forgets every undo and redo step (for example once the board is saved). */
  clearHistory() { this._history = []; this._future = []; }
  get canUndo() { return this._history.length > 0; }
  get canRedo() { return this._future.length > 0; }

  /** Live content (for example from a home automation system): never moves anything. */
  setState(id, { subtitle, status } = {}) {
    if (!this._els.has(id)) return;
    const s = { ...(this._live.get(id) ?? {}) };
    if (subtitle !== undefined) s.subtitle = subtitle === null ? undefined : String(subtitle);
    if (status !== undefined) s.status = status !== null && STATUS.test(String(status)) ? String(status) : undefined;
    this._live.set(id, s);
    this._fillNode(this._model.nodes.find(n => n.id === id), this._els.get(id));
  }

  /** Selects a node (or null), shows its wires and its detail. */
  select(id, { focus = true, animate = this.options.animate } = {}) {
    if (id !== null && !this._els.has(id)) id = null;
    const prev = this._selected;
    this._selected = id;
    this._highlight();
    this._fillPanel();
    this._placePanel();
    this._paint(animate);
    if (id !== null) this._setTabStop(id, focus);
    if (prev !== id) this._emit("select", { id });
    this._announce(id === null ? "" : this._summary(id));
  }

  /** Finishes any running transition at once (its end state) and redraws the wires. */
  settle() {
    const running = this._animations;
    this._animations = [];
    running.forEach(a => a.finish());
    for (const g of this._board.querySelectorAll(":scope > .node[aria-hidden]")) g.remove();
    this._paint(false);
  }

  /** Frees the map: observers, frames and animations stop and the content is removed. Final: a
   *  destroyed instance draws nothing more; create a new one to show a board again. */
  destroy() {
    this._destroyed = true;
    this._ro?.disconnect();
    cancelAnimationFrame(this._frame);
    const running = this._animations;
    this._animations = [];          // a transition's end callback sees it is no longer current
    running.forEach(a => a.cancel());
    this.root.replaceChildren();
  }
  get destroyed() { return this._destroyed === true; }

  // -------------------------------------------------------------------------------------------
  // Internals: commit, history

  _commit(before, after, warnings, { long = false } = {}) {
    // An edit that changes nothing (same title, empty list of operations) makes no undo step.
    if (after === before || JSON.stringify(M.serialize(after)) === JSON.stringify(M.serialize(before))) return;
    this._history.push(before);
    while (this._history.length > this.options.historyLimit) this._history.shift();
    this._future = [];
    this._model = after;
    this._warnings = warnings ?? [];
    this._rev++;
    const d = M.diff(before, after);
    this._render({ animate: true, diff: d, long });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
  }

  _swap(model) {
    const before = this._model;
    this._model = model;
    this._warnings = M.validate(model).warnings;
    this._rev++;
    const d = M.diff(before, model);
    this._render({ animate: true, diff: d });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.host.dispatchEvent(new CustomEvent(`atlas-${type}`, { detail, bubbles: true, composed: true }));
  }

  // -------------------------------------------------------------------------------------------
  // DOM: skeleton

  _mount() {
    const style = document.createElement("style");
    style.textContent = STYLES;
    this._wrap = el("div", "atlas");
    this._boardWrap = el("div", "board-wrap");
    this._board = el("div", "board");
    this._board.setAttribute("part", "board");
    this._board.setAttribute("role", "region");
    this._svg = document.createElementNS(NS, "svg");
    this._svg.setAttribute("class", "wires");
    this._svg.setAttribute("aria-hidden", "true");
    this._panel = el("aside", "panel");
    this._panel.setAttribute("part", "panel");
    this._status = el("div", "status");
    this._status.setAttribute("role", "status");
    this._status.setAttribute("aria-atomic", "true");
    this._boardWrap.append(this._board);
    this._wrap.append(this._boardWrap, this._panel, this._status);
    this.root.replaceChildren(style, this._wrap);
    this._board.addEventListener("keydown", e => this._onKey(e));
    this._ro = new ResizeObserver(() => this._schedule());
    this._ro.observe(this._board);
    this._ro.observe(this.host);
  }

  _schedule() {
    if (this._destroyed) return;
    cancelAnimationFrame(this._frame);
    this._frame = requestAnimationFrame(() => {
      this._applyMode();
      this._placePanel();
      if (!this._running()) this._paint(false);
    });
  }

  _running() {
    return this._animations.some(a => a.playState === "running" || a.playState === "pending");
  }

  // -------------------------------------------------------------------------------------------
  // DOM: render the layout

  _render({ animate = false, diff = null, long = false } = {}) {
    if (this._destroyed) return;
    this._board.setAttribute("aria-label", this._model.meta.title || this.labels.board);
    this._panel.setAttribute("aria-label", this.labels.detail);
    // The selection follows the board: a node that is gone (removed, renamed by undo, another board
    // loaded) is no longer selected, and listeners hear it.
    const lost = this._selected !== null && !this._model.nodes.some(n => n.id === this._selected);
    if (lost) this._selected = null;
    const active = this._active();
    const hadFocus = active !== null && this._board.contains(active);
    const motion = animate && !reducedMotion();
    this._animations.forEach(a => a.finish());
    this._animations = [];
    const first = motion ? this._rects() : null;

    const L = computeLayout(this._model);
    this._layout = L;
    const geo = this._abstractGeometry(L);
    const need = demand(this._model.nodes.map(n => n.id), this._model.edges, geo.place, geo.pos, { ct: 0, cb: 1 });
    this._need = need;
    this._build(L, need);
    this._minWidth = this._intrinsicWidth();
    this._applyMode();
    this._highlight();
    this._fillPanel();
    this._placePanel();
    // Focus was on a node that is gone: keep it in the map, on the node that holds the tab stop.
    if (hadFocus && !this._board.contains(this._active())) {
      this._ensureTabStop();
      [...this._els.values()].find(b => b.tabIndex === 0)?.focus({ preventScroll: true });
    }
    if (lost) { this._emit("select", { id: null }); this._announce(""); }

    if (motion && first) this._transition(first, diff, long);
    else this._paint(false);
  }

  /** The focused element inside the map's root (shadow root or host). */
  _active() {
    const a = this.root instanceof ShadowRoot ? this.root.activeElement : document.activeElement;
    return a ?? null;
  }

  /** Abstract positions (before measuring) used to size corridors: u = lane, v = slot. */
  _abstractGeometry(L) {
    const col = new Map(L.flow.map((l, i) => [l.id, i]));
    const N = L.flow.length;
    const bandIndex = new Map();
    for (const band of [L.before, L.after]) if (band) L.order.get(band.id).forEach((id, i, a) => bandIndex.set(id, (i + 0.5) / a.length * N));
    const place = id => {
      const lane = L.laneOf.get(id);
      if (L.before && lane === L.before.id) return { kind: "top" };
      if (L.after && lane === L.after.id) return { kind: "bot" };
      return { kind: "col", col: col.get(lane) };
    };
    const pos = id => {
      const p = place(id);
      if (p.kind === "top") return { u: bandIndex.get(id) - 0.5, v: -0.5 };
      if (p.kind === "bot") return { u: bandIndex.get(id) - 0.5, v: 1.5 };
      return { u: p.col, v: (L.slots.get(id) + 0.5) / L.rows };
    };
    return { place, pos };
  }

  _build(L, need) {
    const dir = L.direction;
    const vertical = dir === "down" || dir === "up";
    const reversed = dir === "left" || dir === "up";
    const N = L.flow.length;
    this._wrap.dataset.direction = dir;
    const board = this._board;
    const keep = new Set(this._model.nodes.map(n => n.id));
    for (const [id, li] of this._items) if (!keep.has(id)) { li.remove(); this._items.delete(id); this._els.delete(id); this._live.delete(id); }

    const size = (c, min) => Math.max(min, corridorSize(need.tracks.get(c) ?? 0, c[0] === "g" ? "g" : "c"));
    const gutters = Array.from({ length: N + 1 }, (_, k) => size("g" + k, k === 0 || k === N ? MIN_OUTER : MIN_GUTTER));
    const ch = { ct: size("ct", MIN_CHANNEL), cb: size("cb", MIN_CHANNEL), ca: size("ca", 12), cz: size("cz", 12) };
    for (let k = 0; k <= N; k++) board.style.setProperty(`--g${k}`, `${gutters[k]}px`);
    for (const [k, v] of Object.entries(ch)) board.style.setProperty(`--${k}`, `${v}px`);

    // Board: before band, channel, flow, channel, after band, stacked across the flow.
    const parts = [];
    const bandEl = (band, kind) => {
      const sec = el("section", `band ${kind}`);
      sec.dataset.lane = band.id;
      const title = txt("h3", "lane-title", band.title ?? "");
      const spacer = el("div", `channel ch-${kind === "before" ? "ca" : "cz"}`);
      const list = el("ol", "nodes");
      const ids = L.order.get(band.id);
      if (vertical) {
        list.style.gridTemplateRows = `repeat(${Math.max(1, ids.length)}, auto)`;
        sec.style.gridTemplateColumns = kind === "before" ? `var(--ca) minmax(140px, 220px)` : `minmax(140px, 220px) var(--cz)`;
        sec.style.gridTemplateRows = "auto 1fr";
        title.style.gridColumn = "1 / -1";
        spacer.style.gridColumn = kind === "before" ? "1" : "2";
        list.style.gridColumn = kind === "before" ? "2" : "1";
        spacer.style.gridRow = list.style.gridRow = "2";
        list.style.marginBlock = `var(--g${reversed ? N : 0}) var(--g${reversed ? 0 : N})`;
      } else {
        list.style.gridTemplateColumns = `repeat(${Math.max(1, ids.length)}, minmax(${BAND_NODE_MIN}px, 1fr))`;
        sec.style.gridTemplateRows = kind === "before" ? "auto var(--ca) auto" : "auto var(--cz) auto";
        list.style.marginInline = `var(--g${reversed ? N : 0}) var(--g${reversed ? 0 : N})`;
      }
      ids.forEach((id, i) => {
        const li = this._item(id);
        li.style.gridRow = vertical ? `${i + 1}` : "";
        li.style.gridColumn = vertical ? "" : `${i + 1}`;
        list.append(li);
      });
      if (kind === "before") sec.append(title, spacer, list);
      else sec.append(list, spacer, title);
      return sec;
    };
    if (L.before) parts.push(bandEl(L.before, "before"));
    parts.push(cls(el("div", "channel ch-ct"), "lane-gap"));

    const flow = el("div", "flow");
    const rows = L.rows;
    if (vertical) {
      const tracks = [];
      for (let k = 0; k < N; k++) tracks.push(`var(--g${k})`, "auto");
      tracks.push(`var(--g${N})`);
      flow.style.gridTemplateRows = (reversed ? reverseTracks(tracks) : tracks).join(" ");
      flow.style.gridTemplateColumns = `minmax(64px, max-content) repeat(${rows}, minmax(var(--node-min-cross, 120px), 1fr))`;
      flow.style.columnGap = "10px";
    } else {
      const tracks = [];
      for (let k = 0; k < N; k++) tracks.push(`var(--g${k})`, "minmax(var(--node-min), 1fr)");
      tracks.push(`var(--g${N})`);
      flow.style.gridTemplateColumns = (reversed ? reverseTracks(tracks) : tracks).join(" ");
      flow.style.gridTemplateRows = `auto repeat(${rows}, auto)`;
      flow.style.rowGap = "10px";
    }
    const gutterEls = [];
    for (let k = 0; k <= N; k++) {
      const g = el("div", "gutter");
      g.dataset.k = String(k);
      const track = reversed ? 2 * (N - k) + 1 : 2 * k + 1;
      if (vertical) { g.style.gridRow = `${track}`; g.style.gridColumn = "1 / -1"; }
      else { g.style.gridColumn = `${track}`; g.style.gridRow = "1 / -1"; }
      gutterEls.push(g);
      flow.append(g);
    }
    this._gutters = gutterEls;
    this._lanes = [];
    L.flow.forEach((lane, k) => {
      const sec = el("section", "lane");
      sec.dataset.lane = lane.id;
      const track = reversed ? 2 * (N - 1 - k) + 2 : 2 * k + 2;
      const title = txt("h3", "lane-title", lane.id === M.UNASSIGNED ? this.labels.unassigned : (lane.title ?? ""));
      const list = el("ol", "nodes");
      if (vertical) {
        sec.style.gridRow = `${track}`;
        sec.style.gridColumn = "1 / -1";
        sec.style.gridTemplateColumns = "subgrid";
        title.style.gridColumn = "1";
        title.style.alignSelf = "center";
        list.style.gridColumn = "2 / -1";
        list.style.gridTemplateColumns = "subgrid";
      } else {
        sec.style.gridColumn = `${track}`;
        sec.style.gridRow = "1 / -1";
        sec.style.gridTemplateRows = "subgrid";
        title.style.gridRow = "1";
        list.style.gridRow = "2 / -1";
        list.style.gridTemplateRows = "subgrid";
      }
      for (const id of L.order.get(lane.id)) {
        const li = this._item(id);
        const slot = L.slots.get(id) + 1;
        li.style.gridRow = vertical ? "" : `${slot}`;
        li.style.gridColumn = vertical ? `${slot}` : "";
        list.append(li);
      }
      // Group boxes, drawn behind the nodes of their slot span.
      for (const span of L.groups.filter(s => s.lane === lane.id)) {
        const box = el("div", "group-box");
        const label = txt("span", "", span.title);
        box.append(label);
        if (vertical) { box.style.gridColumn = `${span.from + 1} / ${span.to + 2}`; box.style.gridRow = "1"; }
        else { box.style.gridRow = `${span.from + 1} / ${span.to + 2}`; box.style.gridColumn = "1"; }
        list.prepend(box);
      }
      sec.append(title, list);
      this._lanes.push(sec);
      flow.append(sec);
    });
    parts.push(flow);
    parts.push(cls(el("div", "channel ch-cb"), "lane-gap"));
    if (L.after) parts.push(bandEl(L.after, "after"));

    if (vertical) {
      // min-content minimums: an auto track would let Chrome squeeze the parts (min-width: 0) below
      // what their own tracks need, and the board would end narrower than its content.
      board.style.gridTemplateColumns = parts.map(p => p.classList.contains("ch-ct") ? "var(--ct)" : p.classList.contains("ch-cb") ? "var(--cb)" : p.classList.contains("flow") ? "minmax(min-content, 1fr)" : "minmax(min-content, auto)").join(" ");
      board.style.gridTemplateRows = "";
    } else {
      board.style.gridTemplateRows = parts.map(p => p.classList.contains("ch-ct") ? "var(--ct)" : p.classList.contains("ch-cb") ? "var(--cb)" : "auto").join(" ");
      board.style.gridTemplateColumns = "minmax(min-content, 1fr)";
    }
    board.replaceChildren(this._svg, ...parts);

    // Ports need room: a node is at least as long as its busiest side requires.
    for (const n of this._model.nodes) {
      const b = this._els.get(n.id);
      const sides = vertical ? ["T", "B"] : ["L", "R"];
      const len = Math.max(...sides.map(s => sideSize(need.ports.get(`${n.id}:${s}`) ?? 0)));
      b.style.minHeight = !vertical && len ? `${len}px` : "";
      b.style.minWidth = vertical && len ? `${len}px` : "";
      this._fillNode(n, b);
    }
    this._ensureTabStop();
  }

  _item(id) {
    let li = this._items.get(id);
    if (!li) {
      li = el("li");
      const b = el("button", "node");
      b.type = "button";
      b.tabIndex = -1;
      this._idOf.set(b, id);
      b.addEventListener("click", () => this.select(this._idOf.get(b)));
      li.append(b);
      this._items.set(id, li);
      this._els.set(id, b);
    }
    return li;
  }

  _fillNode(n, b) {
    if (!n || !b) return;
    const live = this._live.get(n.id) ?? {};
    const type = typeof n.type === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(n.type) ? n.type : null;
    b.setAttribute("part", ["node", type && `node-${type}`, live.status && `status-${live.status}`].filter(Boolean).join(" "));
    if (live.status) b.dataset.status = live.status; else delete b.dataset.status;
    if (this.options.renderNode) { this.options.renderNode(M.clone(n), b, { ...live }); return; }
    const t = txt("span", "t", n.title ?? n.id);
    const sub = live.subtitle ?? n.subtitle;
    const parts = [t];
    if (sub) parts.push(txt("span", "s", sub));
    b.replaceChildren(...parts);
  }

  // -------------------------------------------------------------------------------------------
  // Modes: flow (wires) or stack (one lane after another); the panel at the side or below.

  _applyMode() {
    const L = this._layout;
    if (!L) return;
    const width = this.host.getBoundingClientRect().width || this._wrap.getBoundingClientRect().width;
    // A hidden host measures 0: measure again once it shows, and estimate until then.
    if (!this._minWidth) this._minWidth = this._intrinsicWidth();
    const vertical = L.direction === "down" || L.direction === "up";
    const lanes = vertical ? Math.max(1, L.rows) : Math.max(1, L.flow.length);
    const needed = this._minWidth || lanes * (vertical ? 130 : 150) + (lanes + 1) * MIN_GUTTER + 40;
    const side = (parseFloat(getComputedStyle(this._wrap).getPropertyValue("--atlas-panel-width")) || 300) + PANEL_GAP;
    // Wires need the lanes side by side. When they do not fit, the board scrolls sideways inside
    // its box; only a really narrow container stacks the lanes.
    const mode = width >= Math.min(needed, STACK_BELOW) ? "flow" : "stack";
    const panel = this.options.panel === false ? "none" : mode === "stack" ? "inline" : width >= needed + side ? "side" : "below";
    if (this._wrap.dataset.mode !== mode) this._wrap.dataset.mode = mode;
    if (this._wrap.dataset.panel !== panel) this._wrap.dataset.panel = panel;
  }

  /** Narrowest the board can be laid out side by side, measured once per build: it depends on the
   *  corridors and the lanes, not on the container. */
  _intrinsicWidth() {
    const wrap = this._wrap, board = this._board, mode = wrap.dataset.mode;
    wrap.dataset.mode = "flow";
    board.style.width = "min-content";
    const w = Math.ceil(board.getBoundingClientRect().width);
    board.style.width = "";
    if (mode === undefined) delete wrap.dataset.mode; else wrap.dataset.mode = mode;
    return w;
  }

  _placePanel() {
    const inline = this._wrap.dataset.panel === "inline";
    // Inline, the detail goes inside the selected node's <li>: an <ol> holds only <li>s.
    if (inline && this._selected && this._items.has(this._selected)) this._items.get(this._selected).append(this._panel);
    else if (!inline && this._panel.parentNode !== this._wrap) this._wrap.insertBefore(this._panel, this._status);
    this._panel.hidden = this._selected === null || this._wrap.dataset.panel === "none";
  }

  _flowMode() {
    return this._wrap.dataset.mode === "flow";
  }

  // -------------------------------------------------------------------------------------------
  // Selection, highlight and detail panel

  _highlight() {
    const id = this._selected;
    const outs = new Set(), ins = new Set();
    if (id !== null) for (const e of this._model.edges) {
      if (e.from === id && e.to !== id) outs.add(e.to);
      if (e.to === id && e.from !== id) ins.add(e.from);
    }
    for (const [nid, b] of this._els) {
      b.classList.toggle("on", nid === id);
      b.classList.toggle("near-out", outs.has(nid));
      b.classList.toggle("near-in", ins.has(nid));
      b.setAttribute("aria-pressed", nid === id ? "true" : "false");
    }
    this._board.classList.toggle("has-selection", id !== null);
  }

  _fillPanel() {
    const id = this._selected;
    if (id === null) { this._panel.replaceChildren(); return; }
    const n = this._model.nodes.find(x => x.id === id);
    const L = this._layout;
    const laneId = L.laneOf.get(id);
    const lane = [L.before, ...L.flow, L.after].find(l => l && l.id === laneId);
    const kids = [];
    const p = txt("p", "p-lane", laneId === M.UNASSIGNED ? this.labels.unassigned : (lane?.title ?? ""));
    const h = txt("h3", "", n.title ?? n.id);
    kids.push(p, h);
    const sub = this._live.get(id)?.subtitle ?? n.subtitle;
    if (sub) kids.push(txt("p", "p-sub", sub));
    if (Array.isArray(n.details) && n.details.length) {
      const ul = el("ul");
      for (const d of n.details) ul.append(txt("li", "", d));
      kids.push(ul);
    }
    const rel = (dir, edges, other) => {
      if (!edges.length) return;
      const box = el("div", "rel");
      box.dataset.dir = dir;
      const t = el("h4");
      t.textContent = dir === "in" ? this.labels.incoming : this.labels.outgoing;
      const ul = el("ul");
      for (const e of edges) {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        const target = this._model.nodes.find(x => x.id === other(e));
        b.append(txt("span", "rt", target?.title ?? other(e)));
        if (e.label) b.append(txt("span", "rw", e.label));
        if (e.details) b.append(txt("span", "rd", e.details));
        b.addEventListener("click", () => this.select(other(e)));
        li.append(b);
        ul.append(li);
      }
      box.append(t, ul);
      kids.push(box);
    };
    const edges = this._model.edges;
    rel("in", edges.filter(e => e.to === id && e.from !== id), e => e.from);
    rel("out", edges.filter(e => e.from === id && e.to !== id), e => e.to);
    if (edges.some(e => e.from === id && e.to === id)) {
      const s = el("p", "p-sub");
      s.textContent = this.labels.selfLoop;
      kids.push(s);
    }
    this._panel.replaceChildren(...kids);
  }

  _summary(id) {
    const n = this._model.nodes.find(x => x.id === id);
    const ins = this._model.edges.filter(e => e.to === id && e.from !== id).length;
    const outs = this._model.edges.filter(e => e.from === id && e.to !== id).length;
    return `${n?.title ?? id}: ${ins} ${this.labels.incoming.toLowerCase()}, ${outs} ${this.labels.outgoing.toLowerCase()}`;
  }

  _announce(text) {
    this._status.textContent = text;
  }

  // -------------------------------------------------------------------------------------------
  // Measuring and painting the wires

  /** Measures the board and converts every box into flow coordinates. */
  _measure() {
    const L = this._layout;
    const B = this._board.getBoundingClientRect();
    const W = B.width, H = B.height;
    const dir = L.direction;
    const rel = r => ({ x1: r.left - B.left, x2: r.right - B.left, y1: r.top - B.top, y2: r.bottom - B.top });
    const toFlow = {
      right: r => ({ l: r.x1, r: r.x2, t: r.y1, b: r.y2 }),
      left: r => ({ l: W - r.x2, r: W - r.x1, t: r.y1, b: r.y2 }),
      down: r => ({ l: r.y1, r: r.y2, t: r.x1, b: r.x2 }),
      up: r => ({ l: H - r.y2, r: H - r.y1, t: r.x1, b: r.x2 }),
    }[dir];
    const fromFlow = {
      right: p => ({ x: p.u, y: p.v }),
      left: p => ({ x: W - p.u, y: p.v }),
      down: p => ({ x: p.v, y: p.u }),
      up: p => ({ x: p.v, y: H - p.u }),
    }[dir];
    const box = e => toFlow(rel(e.getBoundingClientRect()));
    const boxes = new Map();
    for (const [id, b] of this._els) if (b.isConnected) boxes.set(id, box(b));
    const corridors = {};
    for (const g of this._gutters) { const r = box(g); corridors["g" + g.dataset.k] = { a: r.l, b: r.r }; }
    const ch = name => { const e = this._board.querySelector(`.ch-${name}`); return e ? box(e) : null; };
    const ct = ch("ct"), cb = ch("cb"), ca = ch("ca"), cz = ch("cz");
    corridors.ct = { a: ct.t, b: ct.b };
    corridors.cb = { a: cb.t, b: cb.b };
    corridors.ca = ca ? { a: ca.t, b: ca.b } : { a: 0, b: 0 };
    corridors.cz = cz ? { a: cz.t, b: cz.b } : { a: 0, b: 0 };
    const col = new Map(L.flow.map((l, i) => [l.id, i]));
    const place = id => {
      const lane = L.laneOf.get(id);
      if (L.before && lane === L.before.id) return { kind: "top" };
      if (L.after && lane === L.after.id) return { kind: "bot" };
      return { kind: "col", col: col.get(lane) };
    };
    return { W, H, boxes, corridors, place, fromFlow };
  }

  _paint(animate) {
    if (this._destroyed) return;
    this._svg.replaceChildren();
    this._wires = [];
    if (!this._layout || this._selected === null || !this._flowMode()) return;
    const g = this._measure();
    this._svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    const edges = this._model.edges.filter(e => e.from !== e.to);
    const merged = mergeParallel(edges);
    const { wires } = route(this._selected, merged, g);
    const L = this._layout;
    const halos = svgEl("g"), lines = svgEl("g"), marks = svgEl("g");
    this._svg.append(halos, lines, marks);
    const motion = animate && !reducedMotion();

    const pts = wires.map(w => w.points.map(g.fromFlow));
    const lengths = pts.map(manhattan);
    const order = [...new Set(wires.map(w => w.h))];
    const top = h => Math.min(...wires.map((w, i) => (w.h === h ? Math.min(...pts[i].map(p => p.y)) : Infinity)));
    order.sort((a, b) => {
      const ka = wires.find(w => w.h === a).k, kb = wires.find(w => w.h === b).k;
      return (ka === kb ? 0 : ka === "in" ? -1 : 1) || top(a) - top(b);
    });
    const turn = new Map(order.map((h, j) => [h, j * BUNDLE_STAGGER]));

    wires.forEach((w, i) => {
      const p = pts[i];
      const back = w.ids.some(id => L.edgeClass.get(id) === "backward");
      const d = pathOf(p);
      const halo = svgEl("path", { d, class: "casing" + (motion ? " draw" : "") });
      const line = svgEl("path", { d, class: `wire ${w.k}${back ? " backward" : ""}${motion ? " draw" : ""}` });
      halos.append(halo);
      lines.append(line);
      const len = line.getTotalLength();
      const dur = Math.max(0.2, len / SPEED);
      const longest = Math.max(...wires.map((o, j) => (o.h === w.h ? lengths[j] : 0)));
      const start = turn.get(w.h) + (w.k === "in" ? (longest - lengths[i]) / SPEED : 0);
      const tip = p[p.length - 1], prev = lastDistinct(p);
      const ux = (tip.x - prev.x) / (Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1);
      const uy = (tip.y - prev.y) / (Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1);
      const bx = tip.x - ux * ROUTE.arrow, by = tip.y - uy * ROUTE.arrow;
      const arrow = svgEl("path", {
        class: `arrow ${w.k}${motion ? " draw" : ""}`,
        d: `M${f(tip.x)},${f(tip.y)} L${f(bx - uy * 4.2)},${f(by + ux * 4.2)} L${f(bx + uy * 4.2)},${f(by - ux * 4.2)}Z`,
      });
      const dot = svgEl("circle", { class: `dot ${w.k}${motion ? " draw" : ""}`, cx: f(p[0].x), cy: f(p[0].y), r: 3.2 });
      marks.append(dot, arrow);
      for (const e of [halo, line]) {
        e.style.setProperty("--len", f(len));
        e.style.setProperty("--t", `${dur.toFixed(3)}s`);
        e.style.setProperty("--d", `${start.toFixed(3)}s`);
      }
      dot.style.setProperty("--d", `${start.toFixed(3)}s`);
      arrow.style.setProperty("--d", `${(start + dur - 0.04).toFixed(3)}s`);
      this._wires.push({ ...w, screen: p });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Transitions: remove → move → add, then the wires trace again.

  _rects() {
    const out = new Map();
    for (const [id, b] of this._els) if (b.isConnected) out.set(id, b.getBoundingClientRect());
    return out;
  }

  _transition(first, diff, long) {
    this._svg.replaceChildren();
    const removed = diff ? diff.nodes.removed : [];
    // A renamed node keeps its element, so it is not "new" on screen.
    const added = new Set((diff ? diff.nodes.added : []).filter(id => !first.has(id)));
    const B = this._board.getBoundingClientRect();
    const anims = [];
    const moveDur = long ? 900 : STAGES.move;
    let t = 0;

    // Ghosts of removed nodes fade out where they were.
    if (removed.length) {
      for (const id of removed) {
        const r = first.get(id);
        if (!r) continue;
        const ghost = el("div", "node");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, { position: "absolute", left: `${r.left - B.left}px`, top: `${r.top - B.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: 3, margin: 0 });
        this._board.append(ghost);
        const a = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: STAGES.remove, easing: "ease-in", fill: "forwards" });
        a.finished.then(() => ghost.remove(), () => ghost.remove());
        anims.push(a);
      }
      t = STAGES.remove;
    }

    // Nodes that stay glide from where they were (FLIP).
    let moved = 0;
    for (const [id, b] of this._els) {
      if (added.has(id) || !first.has(id)) continue;
      const a = first.get(id), z = b.getBoundingClientRect();
      const dx = a.left - z.left, dy = a.top - z.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const delay = t + Math.min(moved * STAGES.stagger, STAGES.staggerCap);
      moved++;
      anims.push(b.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: moveDur, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" }));
    }
    if (moved) t += moveDur + Math.min(moved * STAGES.stagger, STAGES.staggerCap);

    // New nodes come in last.
    for (const id of added) {
      const b = this._els.get(id);
      if (!b) continue;
      anims.push(b.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
        { duration: STAGES.add, delay: t, easing: "ease-out", fill: "backwards" }));
    }
    if (added.size) t += STAGES.add;

    this._animations = anims;
    const done = () => { if (this._animations === anims) { this._animations = []; this._paint(this.options.animate); } };
    if (!anims.length) { this._paint(this.options.animate); return; }
    Promise.allSettled(anims.map(a => a.finished)).then(done);
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard: one tab stop; arrows move by the layout, Enter selects, Escape clears.

  _ensureTabStop() {
    const current = [...this._els.values()].find(b => b.tabIndex === 0);
    if (current && current.isConnected) return;
    const first = this._selected ?? this._ordered()[0];
    if (first !== undefined && this._els.has(first)) this._els.get(first).tabIndex = 0;
  }

  _setTabStop(id, focus) {
    for (const b of this._els.values()) b.tabIndex = -1;
    const b = this._els.get(id);
    b.tabIndex = 0;
    if (!focus) return;
    if (this.root.activeElement !== b) b.focus({ preventScroll: true });
    this._reveal(b);
  }

  /** Scrolls a node into view, sideways inside the board too, and above the detail drawer when the
   *  panel below the board covers the foot of the screen. */
  _reveal(b) {
    const drawer = this._wrap.dataset.panel === "below" && !this._panel.hidden;
    // The drawer is sticky 12px above the bottom; keep the node another 12px clear of it.
    b.style.scrollMarginBottom = drawer ? `${Math.ceil(this._panel.getBoundingClientRect().height) + 24}px` : "";
    b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: this.options.animate && !reducedMotion() ? "smooth" : "auto" });
  }

  _ordered() {
    const L = this._layout;
    if (!L) return [];
    const lanes = [L.before, ...L.flow, L.after].filter(Boolean);
    return lanes.flatMap(l => L.order.get(l.id));
  }

  _onKey(e) {
    const b = e.target.closest?.(".node");
    if (!b) return;
    const id = this._idOf.get(b);
    if (id === undefined) return;
    const L = this._layout;
    const lanes = [L.before, ...L.flow, L.after].filter(Boolean).map(l => L.order.get(l.id));
    const li = lanes.findIndex(ids => ids.includes(id));
    let next = null;
    const key = e.key;
    if (e.altKey && (key === "ArrowRight" || key === "ArrowDown")) next = this._model.edges.find(x => x.from === id && x.to !== id)?.to ?? null;
    else if (e.altKey && (key === "ArrowLeft" || key === "ArrowUp")) next = this._model.edges.find(x => x.to === id && x.from !== id)?.from ?? null;
    else if (key in ARROWS) next = this._nearest(id, ARROWS[key]);
    else if (key === "Home") next = lanes[li][0];
    else if (key === "End") next = lanes[li][lanes[li].length - 1];
    else if (key === "Escape") { this.select(null); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    if (next) { this._setTabStop(next, true); }
  }

  /** The node on screen nearest to `id` in direction [dx, dy], preferring the same row or column. */
  _nearest(id, [dx, dy]) {
    const a = this._els.get(id).getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const [other, b] of this._els) {
      if (other === id || !b.isConnected) continue;
      const r = b.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = x * dx + y * dy, aside = Math.abs(x * dy - y * dx);
      if (along < 1 || aside > along) continue;   // only within 45° of the arrow
      const s = along + 2 * aside;
      if (s < score) { score = s; best = other; }
    }
    return best;
  }
}

// -----------------------------------------------------------------------------------------------
// A batch collects edits on a working copy and commits them as one step.

class Batch {
  constructor(atlas, model) { this.atlas = atlas; this.model = model; this.warnings = []; }
  apply(ops) {
    const r = M.apply(this.model, ops);
    this.model = r.model;
    this.warnings = r.warnings;
    return this;
  }
  addNode(node, { index, edges = [] } = {}) {
    this.apply([{ op: "addNode", node }, ...edges.map(e => ({ op: "addEdge", edge: e }))]);
    // Positions are relative to the node's lane, which may be automatic: anchor on a neighbour.
    const L = computeLayout(this.model);
    const peers = L.order.get(L.laneOf.get(node.id)).filter(id => id !== node.id);
    // The best gap, or the allowed gap nearest the given index: never one that moves existing nodes.
    index = bestInsertion(this.model, node.id, index);
    if (!peers.length) return this;
    return this.apply(index < peers.length
      ? { op: "moveNode", id: node.id, before: peers[index] }
      : { op: "moveNode", id: node.id, after: peers[peers.length - 1] });
  }
  connect(from, to, opts = {}) { return this.apply({ op: "addEdge", edge: clean({ from, to, ...opts }) }); }
  removeNode(id) { return this.apply({ op: "removeNode", id }); }
  updateNode(id, changes) { return this.apply({ op: "updateNode", id, changes }); }
  moveNode(id, opts = {}) { return this.apply({ op: "moveNode", id, ...opts }); }
  disconnect(id) { return this.apply({ op: "removeEdge", id }); }
  updateEdge(id, changes) { return this.apply({ op: "updateEdge", id, changes }); }
  addLane(lane, { index } = {}) { return this.apply({ op: "addLane", lane, index }); }
  updateLane(id, changes) { return this.apply({ op: "updateLane", id, changes }); }
  addGroup(group) { return this.apply({ op: "addGroup", group }); }
  updateGroup(id, changes) { return this.apply({ op: "updateGroup", id, changes }); }
  addConstraint(constraint) { return this.apply({ op: "addConstraint", constraint }); }
  setMeta(changes) { return this.apply({ op: "setMeta", changes }); }
}

// -----------------------------------------------------------------------------------------------
// Helpers

/** A model whose node order follows a layout's lane order (the new sketch). */
function withOrder(model, L, keepPinned = false) {
  const m = M.clone(model);
  const pos = new Map();
  let k = 0;
  for (const lane of [L.before, ...L.flow, L.after].filter(Boolean)) for (const id of L.order.get(lane.id)) pos.set(id, k++);
  const original = new Map(m.nodes.map((n, i) => [n.id, i]));
  if (keepPinned) {
    // Pinned nodes keep their index inside their lane.
    const byLane = new Map();
    for (const n of model.nodes) {
      const lane = L.laneOf.get(n.id);
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(n.id);
    }
    for (const [lane, before] of byLane) {
      const after = L.order.get(lane).filter(id => !model.nodes.find(n => n.id === id)?.pinned);
      const merged = [];
      let j = 0;
      for (const id of before) merged.push(model.nodes.find(n => n.id === id)?.pinned ? id : after[j++]);
      const base = Math.min(...before.map(id => pos.get(id)));
      merged.forEach((id, i) => pos.set(id, base + i));
    }
  }
  m.nodes.sort((a, b) => (pos.get(a.id) ?? original.get(a.id)) - (pos.get(b.id) ?? original.get(b.id)));
  return m;
}

/** Parallel edges (same from and to) travel as one wire. */
function mergeParallel(edges) {
  const out = new Map();
  for (const e of edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (!out.has(key)) out.set(key, { id: e.id, from: e.from, to: e.to, ids: [] });
    out.get(key).ids.push(e.id);
  }
  return [...out.values()];
}

function pathOf(points) {
  const p = points.map(q => ({ ...q }));
  const n = p.length;
  const u = p[n - 1], v = lastDistinct(p);
  const len = Math.hypot(u.x - v.x, u.y - v.y) || 1;
  const cut = Math.min(ROUTE.arrow - 1, len - 1);
  p[n - 1] = { x: u.x - (u.x - v.x) / len * cut, y: u.y - (u.y - v.y) / len * cut };
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
    if (!l0 || !l1) continue;
    const r = Math.min(ROUTE.radius, l0 / 2, l1 / 2);
    const x0 = b.x - (b.x - a.x) / l0 * r, y0 = b.y - (b.y - a.y) / l0 * r;
    const x1 = b.x + (c.x - b.x) / l1 * r, y1 = b.y + (c.y - b.y) / l1 * r;
    d += ` L${f(x0)},${f(y0)} Q${f(b.x)},${f(b.y)} ${f(x1)},${f(y1)}`;
  }
  return d + ` L${f(p[n - 1].x)},${f(p[n - 1].y)}`;
}

function lastDistinct(p) {
  const tip = p[p.length - 1];
  for (let i = p.length - 2; i >= 0; i--) if (Math.hypot(tip.x - p[i].x, tip.y - p[i].y) > 0.5) return p[i];
  return p[0];
}

function manhattan(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
  return L;
}

function reverseTracks(tracks) {
  return [...tracks].reverse();
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** An element holding the board's own text: its direction follows the text, so an Arabic or Hebrew
 *  title reads and aligns right to left while the board's geometry stays left to right. */
function txt(tag, className, text) {
  const e = el(tag, className);
  e.dir = "auto";
  e.textContent = text;
  return e;
}

function cls(e, name) {
  e.classList.add(name);
  return e;
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function f(n) {
  return Number(n).toFixed(1);
}



return { Atlas, model: M };
})();

__modules.element = (() => {
// <atlas-map>: the declarative way to use Atlas.
//
//   <atlas-map src="board.json"></atlas-map>
//   <atlas-map><script type="application/json">{ "nodes": [...] }<\/script></atlas-map>
//   (the slash is escaped so that the built files can be pasted inside an HTML script element)
//
// The instance is at element.atlas; events bubble out as atlas-change, atlas-select, atlas-error.
// element.ready settles when the current board is on screen (or failed) and element.error keeps the
// last failure, so code that runs after the board loaded still learns how it went.

const { Atlas } = __modules.atlas;

// Outside a browser (Node, for validate/layout/route) there is no HTMLElement; the class still loads.
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class AtlasMap extends Base {
  static get observedAttributes() { return ["src", "selected"]; }

  constructor() {
    super();
    /** The last failure to load ({ errors }), or null once a board is on screen. */
    this.error = null;
    this._seq = 0;
    this._pending();
  }

  /** Settles with the instance when the current board is on screen; rejects with { errors }. */
  get ready() { return this._ready; }

  connectedCallback() {
    if (this.atlas && !this.atlas.destroyed) return;
    this.atlas = new Atlas(this, { selected: this.getAttribute("selected") ?? undefined, panel: this.getAttribute("panel") === "false" ? false : "auto" });
    const start = () => {
      const inline = this.querySelector(':scope > script[type="application/json"]');
      if (inline) this._load(inline.textContent, ++this._seq);
      else if (this.getAttribute("src")) this._fetch(this.getAttribute("src"));
    };
    // A classic script in <head> defines the element before the parser has read its children: wait
    // for them, or an inline board would be missed. Otherwise wait a microtask, so that code right
    // after the import can add its listeners before the first events.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else queueMicrotask(start);
  }

  attributeChangedCallback(name, old, value) {
    if (!this.atlas || old === value) return;
    if (name === "src" && value) this._fetch(value);
    if (name === "selected") this.atlas.select(value, { focus: false });
  }

  disconnectedCallback() {
    // Kept alive while moved around the document; call element.atlas.destroy() to free it.
  }

  async _fetch(src) {
    // Only the latest request counts: an older response that arrives later is dropped.
    const seq = ++this._seq;
    this._abort?.abort();
    const abort = this._abort = new AbortController();
    this._pending();
    let text;
    try {
      const url = new URL(src, document.baseURI);
      if (url.origin !== location.origin && !this.hasAttribute("cross-origin")) throw new Error(`refusing cross-origin board ${url}`);
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      text = await res.text();
    } catch (e) {
      if (seq !== this._seq) return;
      return this._fail([{ path: "src", code: "fetch", message: String(e.message ?? e) }]);
    }
    if (seq === this._seq) this._load(text, seq);
  }

  _load(text, seq) {
    if (seq !== this._seq) return;
    try {
      this.atlas.load(text, { selected: this.getAttribute("selected") ?? undefined });
    } catch (e) {
      return this._fail(e.errors ?? [{ path: "", code: "load", message: String(e.message ?? e) }]);
    }
    this.error = null;
    this._settle.resolve(this.atlas);
  }

  _fail(errors) {
    this.error = { errors };
    this._settle.reject(this.error);
    this.dispatchEvent(new CustomEvent("atlas-error", { detail: this.error, bubbles: true, composed: true }));
  }

  /** A new promise for the board on its way, unless the current one is still unsettled. */
  _pending() {
    if (this._settle && !this._settle.done) return;
    const settle = { done: false };
    this._ready = new Promise((resolve, reject) => {
      settle.resolve = v => { settle.done = true; resolve(v); };
      settle.reject = e => { settle.done = true; reject(e); };
    });
    this._ready.catch(() => {});   // a page that never asks for `ready` gets no unhandled rejection
    this._settle = settle;
  }
}

function define(name = "atlas-map") {
  if (!customElements.get(name)) customElements.define(name, class extends AtlasMap {});
}

return { AtlasMap, define };
})();

__modules.index = (() => {
// Atlas: a dependency-free engine for relational maps.
const { Atlas } = __modules.atlas;
const { AtlasMap, define } = __modules.element;
const { FORMAT, LIMITS, AtlasError, parse, normalize, validate, load, apply, serialize, diff } = __modules.model;
const { layout, bestInsertion, inversions } = __modules.layout;
const { route, demand, ROUTE } = __modules.route;

const { define: defineElement } = __modules.element;
if (typeof customElements !== "undefined") defineElement();

return { Atlas, AtlasMap, define, FORMAT, LIMITS, AtlasError, parse, normalize, validate, load, apply, serialize, diff, layout, bestInsertion, inversions, route, demand, ROUTE };
})();

export const { Atlas, AtlasMap, define, FORMAT, LIMITS, AtlasError, parse, normalize, validate, load, apply, serialize, diff, layout, bestInsertion, inversions, route, demand, ROUTE } = __modules.index;
export const VERSION = "0.2.0";
