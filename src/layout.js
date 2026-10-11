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

import { UNASSIGNED, laneOf } from "./model.js";

const AUTO = "atlas:auto-";
const SWEEPS = 8;

/**
 * @param model canonical board (see model.js)
 * @param options.optimize reorder every lane for fewest crossings (otherwise keep the sketch)
 */
export function layout(model, options = {}) {
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
  };
}

/**
 * Where a new node of `lane` should go: the gap with the fewest crossings against its neighbours,
 * respecting constraints; ties go to the gap nearest the median of its neighbours, then the end.
 * `model` must already contain the node and its edges; the returned index is its position among
 * the other nodes of the lane.
 */
export function bestInsertion(model, nodeId) {
  const lanes = resolveLanes(model);
  const laneId = lanes.laneOfNode.get(nodeId);
  const adjacency = buildAdjacency(model, lanes.laneOfNode);
  const constraints = compileConstraints(model, lanes.laneOfNode);
  const order = new Map();
  for (const l of lanes.all) order.set(l.id, []);
  for (const n of model.nodes) if (n.id !== nodeId) order.get(lanes.laneOfNode.get(n.id)).push(n.id);
  const others = order.get(laneId);
  const pos = positionsOf(order);
  const neighbours = [...(adjacency.get(nodeId) ?? [])].filter(w => lanes.laneOfNode.get(w) !== laneId && pos.has(w));
  const median = medianOf(neighbours.map(w => pos.get(w)));

  let best = null;
  for (let i = 0; i <= others.length; i++) {
    const candidate = [...others.slice(0, i), nodeId, ...others.slice(i)];
    if (!satisfies(candidate, constraints.get(laneId))) continue;
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
export function inversions(before, after) {
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

function transpose(lanes, order, adjacency, constraints, model) {
  for (const l of lanes.flow) {
    let improved = true, guard = 0;
    while (improved && guard++ < 4) {
      improved = false;
      const ids = order.get(l.id);
      for (let i = 0; i < ids.length - 1; i++) {
        const before = laneCrossings(l.id, lanes, order, adjacency, positionsOf(order)) + sameLanePenalty(ids, model);
        const swapped = [...ids];
        [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
        if (!satisfies(swapped, constraints.get(l.id)) || groupBlocks(swapped, model).join() !== swapped.join()) continue;
        order.set(l.id, swapped);
        const after = laneCrossings(l.id, lanes, order, adjacency, positionsOf(order)) + sameLanePenalty(swapped, model);
        if (after < before) { ids.splice(0, ids.length, ...swapped); improved = true; }
        order.set(l.id, ids);
      }
    }
  }
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
