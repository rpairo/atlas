// The package's pure functions: a board in, a board out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, apply, diff } from "../src/boards.js";

test("validate() never throws: not JSON, the wrong shape and a bad board are findings", () => {
  assert.deepEqual(validate("{nope").errors.map(e => e.code), ["json"]);
  assert.equal(validate([]).ok, false);
  const r = validate({ nodes: [{ id: "a", lane: "missing" }] });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, "nodes[0].lane");
  assert.deepEqual(validate({ nodes: [{ id: "a" }] }), { ok: true, errors: [], warnings: [] });
});

test("validate() reports placement warnings too, as map.warnings does", () => {
  const board = { lanes: [{ id: "L" }], groups: [{ id: "g" }],
    nodes: [{ id: "a", lane: "L", group: "g" }, { id: "b", lane: "L" }, { id: "c", lane: "L", group: "g" }],
    constraints: [{ type: "before", a: "a", b: "b" }, { type: "before", a: "b", b: "c" }] };
  assert.ok(validate(board).warnings.some(w => w.code === "group-split"));
});

test("apply() returns the board as Atlas saves it, and refuses a bad operation without changing it", () => {
  const board = { nodes: [{ id: "a" }, { id: "b" }] };
  const out = apply(board, [{ op: "addEdge", edge: { from: "a", to: "b" } }]);
  assert.equal(out.format, "atlas/1");
  assert.deepEqual(out.edges, [{ id: "a->b", from: "a", to: "b" }]);
  assert.deepEqual(out.nodes, [{ id: "a", layer: 0 }, { id: "b", layer: 1 }]);   // columns saved, as Atlas does
  assert.throws(() => apply(board, [{ op: "removeNode", id: "nope" }]), { name: "AtlasError" });
  assert.deepEqual(board, { nodes: [{ id: "a" }, { id: "b" }] });
  assert.deepEqual(apply(JSON.stringify(board), []).nodes.map(n => n.id), ["a", "b"]);   // text too
});

test("diff() compares boards by id", () => {
  const d = diff({ nodes: [{ id: "a" }, { id: "b" }] }, { nodes: [{ id: "a", title: "A" }, { id: "c" }] });
  assert.deepEqual(d.nodes, { added: ["c"], removed: ["b"], changed: ["a"] });
});
