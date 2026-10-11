import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, validate, load, parse, apply, serialize, diff, AtlasError, LIMITS } from "../src/model.js";
import { layout } from "../src/layout.js";

const example = JSON.parse(readFileSync(new URL("../examples/incident-response/board.json", import.meta.url)));

const tiny = () => ({
  format: "atlas/1",
  lanes: [{ id: "in", title: "In" }, { id: "out", title: "Out" }],
  nodes: [{ id: "a", lane: "in" }, { id: "b", lane: "in" }, { id: "c", lane: "out" }],
  edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
});

const codes = r => r.errors.map(e => e.code).sort();

test("the example board is valid and exercises the whole format", () => {
  const { model, warnings } = load(example);
  assert.deepEqual(warnings, []);
  assert.ok(model.nodes.length >= 30 && model.edges.length >= 60, "big enough to stress placement and routing");
  assert.ok(model.edges.every(e => typeof e.label === "string" && e.label), "every edge is labelled");
  assert.ok(model.nodes.every(n => n.title && n.subtitle && n.details?.length), "every node has title, subtitle and details");
  for (const kind of ["before", "after"]) assert.equal(model.lanes.filter(l => l.kind === kind).length, 1, kind);
  for (const lane of model.lanes) assert.ok(model.nodes.some(n => n.lane === lane.id), `${lane.id} has nodes`);
  assert.equal(model.meta.ordered, true);
  assert.deepEqual(serialize(model), JSON.parse(JSON.stringify(serialize(load(serialize(model)).model))), "round trip");
});

test("edges without id get a stable derived one", () => {
  const m = normalize({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "b" }] });
  assert.deepEqual(m.edges.map(e => e.id), ["a->b", "a->b#1"]);
  const r = validate(m);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map(w => w.code), ["parallel"]);
});

test("ids share one namespace and reject prototype names", () => {
  const m = normalize({ lanes: [{ id: "x" }], nodes: [{ id: "x" }, { id: "__proto__" }, { id: "bad id" }] });
  assert.deepEqual(codes(validate(m)), ["duplicate", "id", "id"]);
});

test("parse drops keys that could reach a prototype", () => {
  const v = parse('{"nodes":[{"id":"a","__proto__":{"polluted":true}}]}');
  assert.equal(v.nodes[0].polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test("references to missing things are errors, self loops a warning", () => {
  const m = normalize({ nodes: [{ id: "a", lane: "nope", group: "g" }], edges: [{ from: "a", to: "z" }, { from: "a", to: "a" }] });
  const r = validate(m);
  assert.deepEqual(codes(r), ["missing", "missing", "missing"]);
  assert.ok(r.warnings.some(w => w.code === "self"));
});

test("constraints that cannot all hold are rejected by name", () => {
  const doc = tiny();
  doc.constraints = [{ type: "before", a: "a", b: "b" }, { type: "before", a: "b", b: "a" }];
  assert.ok(codes(validate(normalize(doc))).includes("cycle"));
  doc.constraints = [{ type: "first", node: "a" }, { type: "first", node: "b" }];
  assert.ok(codes(validate(normalize(doc))).includes("conflict"));
  doc.constraints = [{ type: "first", node: "b" }, { type: "before", a: "a", b: "b" }];
  assert.ok(codes(validate(normalize(doc))).includes("conflict"));
});

test("limits are enforced", () => {
  const nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({ id: `n${i}` }));
  assert.ok(codes(validate(normalize({ nodes }))).includes("too-many"));
  assert.throws(() => parse("x".repeat(LIMITS.bytes + 1)), AtlasError);
  const long = { nodes: [{ id: "a", title: "x".repeat(LIMITS.text + 1) }] };
  assert.ok(codes(validate(normalize(long))).includes("too-long"));
});

test("unknown format versions are rejected, unknown fields survive a round trip", () => {
  assert.ok(codes(validate(normalize({ format: "atlas/2" }))).includes("version"));
  const doc = { ...tiny(), custom: { keep: 1 } };
  const out = serialize(load(doc).model);
  assert.deepEqual(out.custom, { keep: 1 });
  assert.deepEqual(load(out).model.nodes, load(doc).model.nodes);
});

test("operations apply atomically and never leave a broken board", () => {
  const { model } = load(tiny());
  const bad = [{ op: "addNode", node: { id: "d", lane: "in" } }, { op: "addEdge", edge: { from: "d", to: "zzz" } }];
  assert.throws(() => apply(model, bad), AtlasError);
  assert.equal(model.nodes.length, 3);
});

test("addNode respects the lane position; removeNode cascades", () => {
  let { model } = load(tiny());
  ({ model } = apply(model, { op: "addNode", node: { id: "d", lane: "in" }, index: 1 }));
  assert.deepEqual(model.nodes.filter(n => n.lane === "in").map(n => n.id), ["a", "d", "b"]);
  ({ model } = apply(model, { op: "removeNode", id: "a" }));
  assert.deepEqual(model.edges.map(e => e.id), ["b->c"]);
});

test("renameNode rewrites every reference and keeps the place", () => {
  let { model } = load({ ...tiny(), constraints: [{ type: "first", node: "a" }] });
  ({ model } = apply(model, { op: "renameNode", from: "a", to: "alpha" }));
  assert.deepEqual(model.nodes.map(n => n.id), ["alpha", "b", "c"]);
  assert.deepEqual(model.edges.map(e => [e.id, e.from]), [["alpha->c", "alpha"], ["b->c", "b"]]);
  assert.equal(model.constraints[0].node, "alpha");
});

test("removeLane without a destination leaves its nodes without a lane, never null", () => {
  const { model } = load(tiny());
  for (const moveTo of [undefined, null]) {
    const { model: m } = apply(model, { op: "removeLane", id: "in", moveTo });
    for (const id of ["a", "b"]) assert.equal("lane" in m.nodes.find(n => n.id === id), false, `moveTo ${moveTo}`);
  }
});

test("removeLane can move its nodes", () => {
  let { model } = load(tiny());
  ({ model } = apply(model, { op: "removeLane", id: "in", moveTo: "out" }));
  assert.deepEqual(model.nodes.map(n => n.lane), ["out", "out", "out"]);
});

test("diff reports what changed by id", () => {
  const a = load(tiny()).model;
  const b = apply(a, [{ op: "addNode", node: { id: "d", lane: "out" } }, { op: "updateNode", id: "a", changes: { title: "A" } }]).model;
  const d = diff(a, b);
  assert.deepEqual(d.nodes, { added: ["d"], removed: [], changed: ["a"] });
});

test("a board must be an object, and its lists lists", () => {
  for (const text of ["null", "42", "[1]", '"board"']) {
    assert.throws(() => load(text), e => e instanceof AtlasError && e.errors[0].code === "type", text);
  }
  assert.throws(() => load({ nodes: { a: {} } }), e => e instanceof AtlasError && e.errors.some(x => x.path === "nodes" && x.code === "type"));
  assert.throws(() => load({ meta: [], edges: "a->b" }), e => e instanceof AtlasError && e.errors.length === 2);
});

test("titles, types and pinned are checked like any other field", () => {
  const long = "x".repeat(LIMITS.text + 1);
  assert.deepEqual(codes(validate(normalize({ meta: { title: long }, nodes: [{ id: "a" }] }))), ["too-long"]);
  assert.deepEqual(codes(validate(normalize({ nodes: [{ id: "a", pinned: "yes" }] }))), ["type"]);
  assert.deepEqual(codes(validate(normalize({ nodes: [{ id: "a", type: 3 }] }))), ["type"]);
  assert.equal(validate(normalize({ nodes: [{ id: "a", type: "any text at all", pinned: true }] })).ok, true);
});

test("renameNode also renames the selected node of meta", () => {
  const { model } = load({ meta: { selected: "a" }, nodes: [{ id: "a" }, { id: "b" }] });
  assert.equal(apply(model, { op: "renameNode", from: "a", to: "z" }).model.meta.selected, "z");
  assert.equal(apply(model, { op: "renameNode", from: "b", to: "y" }).model.meta.selected, "a");
});

// ---------------------------------------------------------------------------------------------
// The format agrees with the JSON Schema: what loads is saved valid, what the schema refuses fails.

test("a field set to null is left out: it loads and is saved without null", () => {
  const { model } = load({
    meta: { title: null, selected: null },
    lanes: [{ id: "L", title: null }], groups: [{ id: "G", parent: null }],
    nodes: [{ id: "a", lane: null, group: null, title: null, subtitle: null }, { id: "b" }],
    edges: [{ from: "a", to: "b", label: null, type: null }],
  });
  assert.ok(!JSON.stringify(serialize(model)).includes("null"));
  assert.equal(model.nodes[0].lane, undefined);
});

test("wrong types the schema refuses are errors, not saved back", () => {
  const base = () => ({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] });
  const cases = [
    [b => { b.nodes[0].details = [null]; }, "type"],
    [b => { b.edges[0].type = 5; }, "type"],
    [b => { b.edges[0].type = "x".repeat(2001); }, "too-long"],
    [b => { b.meta = { selected: 5 }; }, "id"],
    [b => { b.meta = { ordered: "yes" }; }, "type"],
    [b => { b.meta = { lang: 7 }; }, "type"],
  ];
  for (const [mutate, code] of cases) {
    const b = base(); mutate(b);
    assert.throws(() => load(b), e => e.name === "AtlasError" && e.errors.some(x => x.code === code), JSON.stringify(b));
  }
});

test("lengths are counted in characters, as JSON Schema counts them", () => {
  assert.doesNotThrow(() => load({ nodes: [{ id: "a", title: "😀".repeat(2000) }] }));
  assert.throws(() => load({ nodes: [{ id: "a", title: "😀".repeat(2001) }] }), e => e.errors.some(x => x.code === "too-long"));
});

test("a derived edge id never takes one that another edge has explicitly", () => {
  const { model } = load({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ id: "a->b", from: "a", to: "c" }, { from: "a", to: "b" }] });
  assert.deepEqual(model.edges.map(e => e.id), ["a->b", "a->b#1"]);
});

test("an edge type named like an Object member is still reported as undeclared", () => {
  const { warnings } = load({ edgeTypes: { flow: {} }, nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", type: "toString" }] });
  assert.ok(warnings.some(w => w.code === "unknown-type"));
});

test("defaults come back when an edit leaves a field undefined or null", () => {
  const { model } = load({ lanes: [{ id: "L" }], nodes: [{ id: "a", lane: "L" }] });
  let m = apply(model, { op: "addLane", lane: { id: "M", kind: undefined } }).model;
  assert.equal(m.lanes[1].kind, "flow");
  m = apply(m, { op: "updateLane", id: "L", changes: { kind: null } }).model;
  assert.equal(m.lanes[0].kind, "flow");
  m = apply(m, { op: "setMeta", changes: { direction: null } }).model;
  assert.equal(m.meta.direction, "right");
});

test("a long chain of 'before' constraints is refused with AtlasError, not a stack overflow", () => {
  const n = 6000;
  const board = { nodes: Array.from({ length: n }, (_, i) => ({ id: "n" + i })), constraints: Array.from({ length: n - 1 }, (_, i) => ({ type: "before", a: "n" + i, b: "n" + (i + 1) })) };
  assert.throws(() => load(board), e => e.name === "AtlasError");
});

test("meta.selected follows the node: removing it forgets it, naming a missing one warns", () => {
  const { model } = load({ meta: { selected: "a" }, nodes: [{ id: "a" }, { id: "b" }] });
  assert.equal(apply(model, { op: "removeNode", id: "a" }).model.meta.selected, undefined);
  const { warnings } = load({ meta: { selected: "ghost" }, nodes: [{ id: "a" }] });
  assert.ok(warnings.some(w => w.path === "meta.selected" && w.code === "missing"));
});

test("removing a top-level group leaves its subgroups without a parent, not with null", () => {
  const { model } = load({ lanes: [{ id: "L" }], groups: [{ id: "G" }, { id: "H", parent: "G" }], nodes: [{ id: "a", lane: "L", group: "H" }] });
  const m = apply(model, { op: "removeGroup", id: "G" }).model;
  assert.ok(!("parent" in m.groups[0]));
});

// ---------------------------------------------------------------------------------------------
// Hostile input: whatever value sits in whatever field, load() and apply() either work or throw
// AtlasError; never a TypeError from inside.

const WEIRD = [null, true, 0, -1, 1e308, "", "x", [], [null], {}, { toString: 0 }, { toString: 0, valueOf: 0 }, ["a"], { id: "a" }];

const richBoard = () => ({
  format: "atlas/1",
  meta: { title: "t", selected: "a", direction: "right", lang: "en", ordered: true },
  lanes: [{ id: "L", title: "L" }, { id: "B", kind: "before", title: "B" }],
  groups: [{ id: "G", title: "G" }, { id: "H", parent: "G" }],
  nodes: [{ id: "a", lane: "L", group: "H", title: "A", subtitle: "s", details: ["d"], type: "x", pinned: true }, { id: "b", lane: "L" }, { id: "c", lane: "B" }],
  edges: [{ id: "e1", from: "a", to: "b", label: "l", details: "why", type: "t" }, { from: "b", to: "c" }],
  constraints: [{ type: "before", a: "a", b: "b" }, { type: "first", node: "a" }],
  edgeTypes: { t: {} }, nodeTypes: { x: {} },
});

function leafPaths(v, path = []) {
  if (v === null || typeof v !== "object") return [path];
  const out = [path];
  for (const k of Object.keys(v)) out.push(...leafPaths(v[k], [...path, k]));
  return out;
}

function setAt(obj, path, value) {
  if (!path.length) return value;
  const copy = structuredClone(obj);
  let o = copy;
  for (const k of path.slice(0, -1)) o = o[k];
  o[path[path.length - 1]] = value;
  return copy;
}

test("any value in any field of a board loads or is refused with AtlasError", () => {
  const base = richBoard();
  const bad = [];
  for (const path of leafPaths(base)) for (const value of WEIRD) {
    const board = setAt(base, path, value);
    try { load(board); } catch (e) { if (e.name !== "AtlasError") bad.push(`${path.join(".")} = ${JSON.stringify(value)}: ${e.name}: ${e.message}`); }
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test("any value in any field of an operation applies or is refused with AtlasError", () => {
  const { model } = load(richBoard());
  const before = JSON.stringify(model);
  const ops = [
    { op: "addNode", node: { id: "n", lane: "L", title: "N" }, index: 0 }, { op: "updateNode", id: "a", changes: { title: "T", details: ["x"] } },
    { op: "moveNode", id: "a", lane: "L", index: 1 }, { op: "removeNode", id: "b" }, { op: "renameNode", from: "a", to: "z" },
    { op: "addEdge", edge: { from: "a", to: "c", label: "l" } }, { op: "updateEdge", id: "e1", changes: { label: "m" } }, { op: "removeEdge", id: "e1" },
    { op: "addLane", lane: { id: "M", title: "M" }, index: 1 }, { op: "updateLane", id: "L", changes: { title: "T" } }, { op: "moveLane", id: "L", index: 1 },
    { op: "removeLane", id: "L", moveTo: null }, { op: "addGroup", group: { id: "K" } }, { op: "updateGroup", id: "G", changes: { title: "T" } },
    { op: "removeGroup", id: "G" }, { op: "addConstraint", constraint: { type: "last", node: "b" } }, { op: "removeConstraint", index: 0 },
    { op: "setMeta", changes: { title: "T" } },
  ];
  const bad = [];
  for (const op of ops) for (const path of leafPaths(op).filter(p => p.length && p[0] !== "op")) for (const value of WEIRD) {
    const o = setAt(op, path, value);
    try { apply(model, o); } catch (e) { if (e.name !== "AtlasError") bad.push(`${op.op} ${path.join(".")} = ${JSON.stringify(value)}: ${e.name}: ${e.message}`); }
  }
  assert.deepEqual(bad.slice(0, 5), []);
  assert.equal(JSON.stringify(model), before, "apply() never changes the model it was given");
});

test("a node cannot be both first and last of a lane", () => {
  const b = { lanes: [{ id: "L" }], nodes: [{ id: "a", lane: "L" }, { id: "b", lane: "L" }], constraints: [{ type: "first", node: "a" }, { type: "last", node: "a" }] };
  assert.throws(() => load(b), e => e.errors.some(x => x.code === "conflict"));
});

test("without flow lanes, constraints follow the computed layers", () => {
  // a → b puts them in different layers: two "first" constraints do not clash, and a "before"
  // between layers is reported by the placement, not refused as if they shared a lane.
  const b = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }], constraints: [{ type: "first", node: "a" }, { type: "first", node: "b" }, { type: "before", a: "a", b: "c" }] };
  const { model, warnings } = load(b);
  assert.deepEqual(warnings, []);
  const L = layout(model);
  assert.ok(L.warnings.some(w => w.code === "cross-lane"), JSON.stringify(L.warnings));
  const same = load({ nodes: [{ id: "a" }, { id: "b" }], constraints: [{ type: "first", node: "a" }, { type: "first", node: "b" }] }).model;
  assert.ok(layout(same).warnings.some(w => w.code === "conflict"));
});

test("null is not a board; numbers out of range and oversized objects are refused", () => {
  assert.throws(() => load(null), e => e.name === "AtlasError" && e.errors[0].code === "type");
  assert.doesNotThrow(() => load(undefined));
  assert.throws(() => load('{"nodes":[{"id":"a","weight":1e400}]}'), e => e.name === "AtlasError" && e.errors[0].code === "json");
  const huge = { nodes: [{ id: "a", title: "x".repeat(1999) }], filler: "y".repeat(LIMITS.bytes) };
  assert.throws(() => load(huge), e => e.name === "AtlasError" && e.errors[0].code === "too-large");
});

test("renaming never gives an edge the id another edge has", () => {
  const { model } = load({ nodes: [{ id: "a" }, { id: "b" }, { id: "x" }], edges: [{ from: "a", to: "b" }, { id: "c->b", from: "x", to: "b" }] });
  const m = apply(model, { op: "renameNode", from: "a", to: "c" }).model;
  assert.deepEqual(m.edges.map(e => e.id).sort(), ["c->b", "c->b#1"]);
});

test("an operation's payload is copied: changing it afterwards does not change the board", () => {
  const { model } = load({ nodes: [{ id: "a" }] });
  const details = ["one"];
  const m = apply(model, { op: "updateNode", id: "a", changes: { details } }).model;
  details.push("added later by the caller");
  assert.deepEqual(m.nodes[0].details, ["one"]);
});

test("saving twice gives the same text, also after a field falls back to its default", () => {
  let { model } = load({ meta: { title: "T" }, lanes: [{ id: "L", kind: "before" }], nodes: [{ id: "a", lane: "L" }] });
  model = apply(model, [{ op: "updateLane", id: "L", changes: { kind: null } }, { op: "setMeta", changes: { direction: null } }]).model;
  const once = JSON.stringify(serialize(model));
  assert.equal(JSON.stringify(serialize(load(once).model)), once);
});
