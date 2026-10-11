// Every selection of every example routes without a crossing and without two wires closer than the
// minimum separation, in both proportions (right/left and down/up), on a geometry sized like the
// renderer's. The browser audit (scripts/audit.sh) checks the same on real layouts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { load } from "../src/model.js";
import { route } from "../src/route.js";
import { geometry } from "./geometry.mjs";

const root = new URL("../examples/", import.meta.url);
const boards = readdirSync(root).filter(d => existsSync(new URL(`${d}/board.json`, root)));

for (const name of boards) for (const vertical of [false, true]) {
  test(`${name}${vertical ? " (vertical)" : ""}: no selection has clashing wires`, () => {
    const { model } = load(JSON.parse(readFileSync(new URL(`${name}/board.json`, root), "utf8")));
    const g = geometry(model, { vertical });
    const bad = model.nodes.map(n => [n.id, route(n.id, g.edges, g).crossings]).filter(([, c]) => c > 0);
    assert.deepEqual(bad, []);
  });
}

test("loops to nodes above and below share no track (they would always cross)", () => {
  // b loops to a (above) and c (below) inside its lane, and also feeds x and y in the next lane.
  const { model } = load({
    lanes: [{ id: "l" }, { id: "r" }],
    nodes: [{ id: "a", lane: "l" }, { id: "b", lane: "l" }, { id: "c", lane: "l" }, { id: "x", lane: "r" }, { id: "y", lane: "r" }],
    edges: [{ from: "b", to: "a" }, { from: "b", to: "c" }, { from: "b", to: "x" }, { from: "b", to: "y" }],
  });
  const g = geometry(model);
  const r = route("b", g.edges, g);
  assert.equal(r.crossings, 0);
  const loops = r.wires.filter(w => w.to === "a" || w.to === "c");
  assert.notEqual(loops[0].h, loops[1].h, "each loop is its own bundle");
});

test("a hub with dozens of wires routes in well under a second, not minutes (search budget)", () => {
  // One hub in a middle lane, linked both ways to the first and last node of every other lane: 36
  // wires whose crossings cannot all be avoided, so the search never stops early. Before the budget
  // this took about 47 s; it now spends at most ROUTE.budget and keeps the best order found.
  const lanes = 10, hubCol = 7;
  const L = Array.from({ length: lanes }, (_, i) => ({ id: "l" + i }));
  const N = [], E = [];
  for (let i = 0; i < lanes; i++) for (let k = 0; k < 6; k++) N.push({ id: `n${i}_${k}`, lane: "l" + i });
  N.push({ id: "hub", lane: "l" + hubCol });
  for (let i = 0; i < lanes; i++) if (i !== hubCol) {
    E.push({ from: "hub", to: `n${i}_0` }, { from: `n${i}_5`, to: "hub" }, { from: "hub", to: `n${i}_5` }, { from: `n${i}_0`, to: "hub" });
  }
  const { model } = load({ meta: { ordered: true }, lanes: L, nodes: N, edges: E });
  const g = geometry(model);
  const t0 = performance.now();
  const r = route("hub", g.edges, g);
  const ms = performance.now() - t0;
  assert.equal(r.wires.length, 36);
  assert.ok(ms < 5000, `route() took ${Math.round(ms)} ms`);
});
