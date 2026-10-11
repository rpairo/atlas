import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, apply } from "../src/model.js";
import { layout, bestInsertion, inversions } from "../src/layout.js";

// A board shaped like a real map: a band before the flow, four flow lanes, a band after it.
const example = JSON.parse(readFileSync(new URL("../examples/incident-response/board.json", import.meta.url)));
const lanesOf = l => Object.fromEntries([...l.order].map(([k, v]) => [k, v]));

/** Rank of every node's lane in drawing order: before band, flow lanes, after band. */
function ranks(model, l) {
  const rank = new Map();
  [l.before, ...l.flow, l.after].filter(Boolean).forEach((lane, i) => { for (const id of l.order.get(lane.id)) rank.set(id, i); });
  return rank;
}

/** Crossings between consecutive flow lanes, counted from the order inside each lane. */
function crossings(model, l) {
  const pos = new Map(), col = new Map();
  l.flow.forEach((lane, k) => l.order.get(lane.id).forEach((id, i) => { pos.set(id, i); col.set(id, k); }));
  const spans = model.edges.filter(e => col.has(e.from) && col.has(e.to) && Math.abs(col.get(e.from) - col.get(e.to)) === 1)
    .map(e => (col.get(e.from) < col.get(e.to) ? [e.from, e.to] : [e.to, e.from]))
    .map(([a, b]) => ({ k: col.get(a), a: pos.get(a), b: pos.get(b) }));
  let n = 0;
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const p = spans[i], q = spans[j];
    if (p.k === q.k && (p.a - q.a) * (p.b - q.b) < 0) n++;
  }
  return n;
}

test("declared lanes decide the column; the sketch decides the order", () => {
  const { model } = load(example);
  const l = layout(model);
  assert.equal(l.mode, "lanes");
  assert.deepEqual(l.flow.map(x => x.id), model.lanes.filter(x => x.kind === "flow").map(x => x.id));
  assert.equal(l.before.id, model.lanes.find(x => x.kind === "before").id);
  assert.equal(l.after.id, model.lanes.find(x => x.kind === "after").id);
  const sketch = id => model.nodes.filter(n => n.lane === id).map(n => n.id);
  for (const lane of model.lanes) assert.deepEqual(l.order.get(lane.id), sketch(lane.id), lane.id);
});

test("edges are forward, same lane or backward by lane rank (bands included)", () => {
  const { model } = load(example);
  const l = layout(model);
  const rank = ranks(model, l);
  const expected = e => (rank.get(e.to) > rank.get(e.from) ? "forward" : rank.get(e.to) === rank.get(e.from) ? "same" : "backward");
  for (const e of model.edges) assert.equal(l.edgeClass.get(e.id), expected(e), `${e.from}>${e.to}`);
  const count = k => model.edges.filter(e => l.edgeClass.get(e.id) === k).length;
  assert.ok(count("backward") >= 3 && count("same") >= 10, "the example exercises every class");
});

test("balance: every flow lane spans the longest one and keeps its order", () => {
  const { model } = load(example);
  const l = layout(model);
  const longest = Math.max(...l.flow.map(lane => l.order.get(lane.id).length));
  assert.equal(l.rows, longest);
  for (const lane of l.flow) {
    const s = l.order.get(lane.id).map(id => l.slots.get(id));
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], `${lane.id} slots increase`);
    assert.ok(s.every(x => x >= 0 && x < l.rows));
  }
});

test("layout is deterministic and does not depend on edge order", () => {
  const { model } = load(example);
  const a = layout(model, { optimize: true });
  const shuffled = { ...model, edges: [...model.edges].reverse() };
  const b = layout(shuffled, { optimize: true });
  assert.deepEqual(lanesOf(a), lanesOf(b));
  assert.deepEqual([...a.slots], [...b.slots]);
});

test("optimizing never makes crossings worse than the sketch", () => {
  const { model } = load(example);
  // A scrambled sketch: every lane reversed.
  const scrambled = { ...model, nodes: [...model.nodes].reverse() };
  const kept = layout(scrambled), opt = layout(scrambled, { optimize: true });
  assert.ok(crossings(model, opt) <= crossings(model, kept), `${crossings(model, opt)} > ${crossings(model, kept)}`);
  assert.ok(inversions(kept, opt) > 0, "the scrambled sketch was reordered");
  // Same promise on the stored sketch.
  assert.ok(crossings(model, layout(model, { optimize: true })) <= crossings(model, layout(model)));
});

test("with no flow lanes, lanes come from the relations and cycles are broken", () => {
  const { model } = load({
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "d" }],
  });
  const l = layout(model);
  assert.equal(l.mode, "auto");
  const lane = id => l.flow.findIndex(f => l.order.get(f.id).includes(id));
  assert.ok(lane("a") < lane("b") && lane("b") < lane("c"));
  assert.equal(l.edgeClass.get("c->a"), "backward");
});

test("nodes without a lane go to a visible Unassigned lane when lanes exist", () => {
  const { model } = load({ lanes: [{ id: "x" }], nodes: [{ id: "a", lane: "x" }, { id: "b" }] });
  const l = layout(model);
  assert.deepEqual(l.flow.map(f => f.id), ["x", "unassigned"]);
});

test("groups stay together and constraints win over the sketch", () => {
  const { model } = load({
    lanes: [{ id: "x" }],
    groups: [{ id: "g" }],
    nodes: [{ id: "a", lane: "x", group: "g" }, { id: "b", lane: "x" }, { id: "c", lane: "x", group: "g" }, { id: "d", lane: "x" }],
    constraints: [{ type: "last", node: "b" }],
  });
  assert.deepEqual(layout(model).order.get("x"), ["a", "c", "d", "b"]);
});

test("a new node enters the gap with fewest crossings, the rest keeps its order", () => {
  const base = {
    lanes: [{ id: "l" }, { id: "r" }],
    nodes: [{ id: "a", lane: "l" }, { id: "b", lane: "l" }, { id: "c", lane: "l" }, { id: "x", lane: "r" }, { id: "y", lane: "r" }, { id: "z", lane: "r" }],
    edges: [{ from: "a", to: "x" }, { from: "b", to: "y" }, { from: "c", to: "z" }],
  };
  let { model } = load(base);
  ({ model } = apply(model, [{ op: "addNode", node: { id: "n", lane: "r" } }, { op: "addEdge", edge: { from: "c", to: "n" } }]));
  const index = bestInsertion(model, "n");
  ({ model } = apply(model, { op: "moveNode", id: "n", index }));
  const order = layout(model).order.get("r");
  assert.deepEqual(order.filter(id => id !== "n"), ["x", "y", "z"], "existing nodes never swap");
  assert.ok(order.indexOf("n") >= 2, "next to its neighbour");
});
