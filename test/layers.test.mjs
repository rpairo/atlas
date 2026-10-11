// Saved layers on boards without flow lanes: edits keep the drawing wherever the edges allow, a
// board saved by Atlas loads exactly as it was, and a board without saved layers is laid out as
// before (0.3.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, apply, validate } from "../src/model.js";
import { layout, withLayers } from "../src/layout.js";

// What Atlas does: save the computed layers after loading and after every edit.
const open = board => { const m = load(board).model; return withLayers(m, layout(m)); };
const edit = (m, ops) => { const r = apply(m, ops).model; return withLayers(r, layout(r)); };
const layers = m => layout(m).layers;
const P = (...ids) => ids.map(id => ({ id }));
const E = (...pairs) => pairs.map(([from, to]) => ({ from, to }));

/** Pairs of nodes present before and after whose order of layers (<, =, >) changed. */
function reshuffles(a, b) {
  const ids = [...a.keys()].filter(id => b.has(id));
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = Math.sign(a.get(ids[i]) - a.get(ids[j])), y = Math.sign(b.get(ids[i]) - b.get(ids[j]));
    if (x !== y) n++;
  }
  return n;
}

test("a new source in front opens a column instead of moving one chain (fails without saved layers)", () => {
  const board = { nodes: P("a", "b", "c", "d"), edges: E(["a", "b"], ["c", "d"]) };
  const ops = [{ op: "addNode", node: { id: "x" } }, { op: "addEdge", edge: { from: "x", to: "a" } }];
  const m = open(board);
  assert.equal(reshuffles(layers(m), layers(edit(m, ops))), 0);
  const bare = load(board).model;   // what 0.3.2 did: a moves to column 1, c stays in column 0
  assert.ok(reshuffles(layout(bare).layers, layout(apply(bare, ops).model).layers) > 0);
});

test("removing an edge moves nothing (fails without saved layers)", () => {
  const board = { nodes: P("a", "b", "c"), edges: [...E(["a", "b"], ["b", "c"]), { id: "ac", from: "a", to: "c" }].map((e, i) => ({ id: e.id ?? `e${i}`, ...e })) };
  const m = open(board);
  const after = edit(m, [{ op: "removeEdge", id: "e1" }]);   // b → c
  assert.deepEqual([...layers(after)], [...layers(m)]);
  const bare = load(board).model;
  assert.notDeepEqual([...layout(apply(bare, [{ op: "removeEdge", id: "e1" }]).model).layers], [...layout(bare).layers]);
});

// Seeded random boards without lanes: cyclic ones (any edge) and mostly forward ones.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randomBoard(rnd, forward) {
  const n = 6 + Math.floor(rnd() * 25), nodes = P(...Array.from({ length: n }, (_, i) => "n" + i)), edges = [];
  const m = Math.floor(n * (0.8 + rnd()));
  for (let k = 0; k < m; k++) {
    let a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    if (forward && rnd() < 0.92 && a > b) [a, b] = [b, a];
    edges.push({ id: `e${k}`, from: "n" + a, to: "n" + b });
  }
  return { nodes, edges };
}
/** Whether an edge lies on a cycle: its target reaches its source. */
function onCycle(m, e) {
  const out = new Map();
  for (const x of m.edges) if (x.id !== e.id) { if (!out.has(x.from)) out.set(x.from, []); out.get(x.from).push(x.to); }
  const seen = new Set([e.to]), todo = [e.to];
  while (todo.length) { const v = todo.pop(); if (v === e.from) return true; for (const w of out.get(v) ?? []) if (!seen.has(w)) { seen.add(w); todo.push(w); } }
  return false;
}

test("edits that cannot need it never reshuffle: removing an edge off every cycle, adding a node with one edge", () => {
  const rnd = rng(42);
  let checked = 0;
  for (let t = 0; t < 300; t++) {
    const m = open(randomBoard(rnd, t % 2 === 0));
    const before = layers(m);
    const e = m.edges[Math.floor(rnd() * m.edges.length)];
    if (e && !onCycle(m, e)) { assert.equal(reshuffles(before, layers(edit(m, [{ op: "removeEdge", id: e.id }]))), 0, `removing ${e.from}->${e.to}`); checked++; }
    const o = m.nodes[Math.floor(rnd() * m.nodes.length)].id;
    const edge = rnd() < 0.5 ? { from: o, to: "x" } : { from: "x", to: o };
    assert.equal(reshuffles(before, layers(edit(m, [{ op: "addNode", node: { id: "x" } }, { op: "addEdge", edge }]))), 0, `adding x with ${edge.from}->${edge.to}`);
  }
  assert.ok(checked > 100);
});

test("long random edit sessions reshuffle far less often than without saved layers", () => {
  const rnd = rng(7);
  let saved = 0, bare = 0, edits = 0;
  for (let t = 0; t < 60; t++) {
    const board = randomBoard(rnd, t % 2 === 0);
    let m = open(board), b = load(board).model;
    for (let k = 0; k < 25; k++) {
      const ids = m.nodes.map(n => n.id);
      const pick = () => ids[Math.floor(rnd() * ids.length)];
      const r = rnd();
      let ops;
      if (r < 0.35) ops = [{ op: "addNode", node: { id: `x${k}` } }, { op: "addEdge", edge: rnd() < 0.5 ? { from: pick(), to: `x${k}` } : { from: `x${k}`, to: pick() } }];
      else if (r < 0.7) { const [a, c] = [pick(), pick()]; if (a === c) continue; ops = [{ op: "addEdge", edge: { from: a, to: c } }]; }
      else { if (!m.edges.length) continue; ops = [{ op: "removeEdge", id: m.edges[Math.floor(rnd() * m.edges.length)].id }]; }
      const before = layers(m), beforeBare = layout(b).layers;
      m = edit(m, ops);
      b = apply(b, ops).model;
      if (reshuffles(before, layers(m))) saved++;
      if (reshuffles(beforeBare, layout(b).layers)) bare++;
      edits++;
    }
  }
  assert.ok(edits > 1000);
  assert.ok(saved < bare * 0.6, `with saved layers ${saved} of ${edits} edits reshuffled, without ${bare}`);
});

test("a board saved by Atlas loads with exactly its layers, after any edit", () => {
  const rnd = rng(3);
  for (let t = 0; t < 150; t++) {
    let m = open(randomBoard(rnd, t % 3 === 0));
    for (let k = 0; k < 8; k++) {
      const L = layers(m);
      // Saving writes the same layers back (a fixed point), and they are the drawn ones.
      assert.equal(withLayers(m, layout(m)), m);
      assert.deepEqual([...L].sort(), m.nodes.map(n => [n.id, n.layer]).sort());
      const a = m.nodes[Math.floor(rnd() * m.nodes.length)].id, c = m.nodes[Math.floor(rnd() * m.nodes.length)].id;
      if (a !== c) m = edit(m, [{ op: "addEdge", edge: { from: a, to: c } }]);
    }
  }
});

// The layering of 0.3.2, frozen: a board without saved layers must be laid out exactly like this.
function layers032(ids, edges) {
  const set = new Set(ids), rank = new Map(ids.map((id, i) => [id, i])), out = new Map(ids.map(id => [id, []]));
  for (const e of edges) if (set.has(e.from) && set.has(e.to) && e.from !== e.to && !out.get(e.from).includes(e.to)) out.get(e.from).push(e.to);
  for (const ws of out.values()) ws.sort((a, b) => rank.get(a) - rank.get(b));
  const state = new Map(), reversed = new Set();
  const visit = v => { state.set(v, 1); for (const w of out.get(v)) { if (state.get(w) === 1) reversed.add(`${v}\u0000${w}`); else if (!state.has(w)) visit(w); } state.set(v, 2); };
  for (const id of ids) if (!state.has(id)) visit(id);
  const preds = new Map(ids.map(id => [id, []]));
  for (const [v, ws] of out) for (const w of ws) { if (reversed.has(`${v}\u0000${w}`)) preds.get(v).push(w); else preds.get(w).push(v); }
  const layer = new Map();
  const depth = v => { if (layer.has(v)) return layer.get(v); layer.set(v, 0); let d = 0; for (const p of preds.get(v)) d = Math.max(d, depth(p) + 1); layer.set(v, d); return d; };
  for (const id of ids) depth(id);
  return layer;
}

test("a board without saved layers is laid out exactly as by 0.3.2", () => {
  const rnd = rng(11);
  for (let t = 0; t < 400; t++) {
    const m = load(randomBoard(rnd, t % 2 === 0)).model;
    assert.deepEqual([...layout(m).layers].sort(), [...layers032(m.nodes.map(n => n.id), m.edges)].sort());
  }
});

test("only an edge that closes a cycle is drawn backwards, the same one every time", () => {
  const m = open({ nodes: [{ id: "a", layer: 0 }, { id: "b", layer: 1 }, { id: "c", layer: 2 }], edges: E(["a", "b"], ["b", "c"], ["c", "a"]) });
  const L = layout(m);
  assert.deepEqual([...L.layers], [["a", 0], ["b", 1], ["c", 2]]);
  assert.equal(L.edgeClass.get("c->a"), "backward");
  assert.equal(L.edgeClass.get("a->b"), "forward");
  // Saved layers that contradict an edge off every cycle are repaired, never refused.
  const bad = load({ nodes: [{ id: "a", layer: 3 }, { id: "b", layer: 1 }, { id: "c", layer: 0 }], edges: E(["a", "b"]) }).model;
  const once = [...layout(bad).layers], twice = [...layout(bad).layers];
  assert.deepEqual(once, twice);
  assert.ok(new Map(once).get("a") < new Map(once).get("b"));
  assert.equal(layout(bad).edgeClass.get("a->b"), "forward");
});

test("layer from a board's own data is kept: a warning, never an error, never removed", () => {
  const base = load({ nodes: [{ id: "a" }] }).model;
  for (const layer of [1.5, "data", true, { x: 1 }]) {
    const r = validate({ ...base, nodes: [{ id: "a", layer }] });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some(w => w.path === "nodes[0].layer" && w.code === "ignored"), `layer ${JSON.stringify(layer)}`);
    // On a board without lanes it is not overwritten, and the node is placed as if it had none.
    const m = open({ nodes: [{ id: "a", layer }, { id: "b" }], edges: E(["a", "b"]) });
    assert.deepEqual(m.nodes[0].layer, layer);
    assert.deepEqual([...layers(m)].sort(), [["a", 0], ["b", 1]]);
  }
  for (const layer of [0, 5, -3]) assert.equal(validate({ ...base, nodes: [{ id: "a", layer }] }).warnings.length, 0);
  // Boards with flow lanes and nodes in bands keep whatever they had.
  const laned = open({ lanes: [{ id: "L" }], nodes: [{ id: "a", lane: "L", layer: 4 }, { id: "b", lane: "L", layer: "x" }] });
  assert.deepEqual(laned.nodes.map(n => n.layer), [4, "x"]);
  const banded = open({ lanes: [{ id: "top", kind: "before" }], nodes: [{ id: "a", lane: "top", layer: 2 }, { id: "b" }] });
  assert.equal(banded.nodes.find(n => n.id === "a").layer, 2);
  assert.equal(banded.nodes.find(n => n.id === "b").layer, 0);
});

test("saved layers on 300 nodes and 1,000 edges are placed quickly", () => {
  const rnd = rng(5), nodes = P(...Array.from({ length: 299 }, (_, i) => "n" + i)), edges = [];
  for (let k = 0; k < 1000; k++) { const a = Math.floor(rnd() * 299), b = Math.floor(rnd() * 299); if (a !== b) edges.push({ from: "n" + a, to: "n" + b }); }
  const m = open({ nodes, edges });
  const t0 = performance.now();
  const after = edit(m, [{ op: "addNode", node: { id: "x" } }, { op: "addEdge", edge: { from: "x", to: "n0" } }, { op: "addEdge", edge: { from: "n298", to: "x" } }]);
  assert.equal(layers(after).size, 300);
  assert.ok(performance.now() - t0 < 1000, `${(performance.now() - t0).toFixed(0)} ms`);
});
