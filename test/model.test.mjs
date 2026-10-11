import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, validate, load, parse, apply, serialize, diff, AtlasError, LIMITS } from "../src/model.js";

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
