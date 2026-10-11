// Fingerprints of the pure placement and routing of a set of boards: what layout() places and what
// route() draws for every selection, on the synthetic geometry of test/geometry.mjs. Stored once
// from a release (v0.3.2.json) and compared by compat.test.mjs, so that a change meant to move
// nothing provably moves nothing.
//
//   node test/compat/fingerprint.mjs <checkout of a release> > test/compat/v0.3.2.json
//
// The boards are stored with their fingerprints: a later change of how they are generated cannot
// change what is compared.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function boards(repo) {
  const out = [];
  const ex = resolve(repo, "examples");
  for (const d of readdirSync(ex).sort()) if (existsSync(resolve(ex, d, "board.json"))) out.push({ name: d, board: JSON.parse(readFileSync(resolve(ex, d, "board.json"), "utf8")) });
  for (const f of ["groups.json", "pinned-groups.json"]) out.push({ name: `fixtures/${f}`, board: JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8")) });
  // Seeded random boards: lanes or none, bands, groups, constraints, cycles.
  let s = 20261011;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let t = 0; t < 60; t++) {
    const lanes = t % 3 === 0 ? [] : Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, i) => ({ id: `L${i}`, title: `Lane ${i}` }));
    if (t % 4 === 1) lanes.push({ id: "top", title: "Top", kind: "before" });
    const groups = t % 5 === 2 ? [{ id: "g", title: "Group" }, { id: "h", title: "Inner", parent: "g" }] : [];
    const n = 5 + Math.floor(rnd() * 18);
    const nodes = Array.from({ length: n }, (_, i) => {
      const node = { id: `n${i}`, title: `Node ${i}` };
      const flow = lanes.filter(l => l.kind !== "before");
      if (lanes.length && (flow.length || rnd() < 0.3)) node.lane = rnd() < 0.15 && lanes.some(l => l.kind === "before") ? "top" : flow[Math.floor(rnd() * flow.length)]?.id;
      if (groups.length && rnd() < 0.3) node.group = rnd() < 0.5 ? "g" : "h";
      return node;
    });
    const edges = [];
    for (let k = 0; k < n * (0.8 + rnd()); k++) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); if (a !== b) edges.push({ from: `n${a}`, to: `n${b}` }); }
    const meta = { direction: ["right", "left", "down", "up"][t % 4] };
    out.push({ name: `random-${t}`, board: { meta, lanes, groups, nodes, edges } });
  }
  return out;
}

export async function fingerprints(repo, list) {
  const src = p => pathToFileURL(resolve(repo, p)).href;
  const { load } = await import(src("src/model.js"));
  const { layout } = await import(src("src/layout.js"));
  const { route } = await import(src("src/route.js"));
  const { geometry } = await import(src("test/geometry.mjs"));
  const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
  const map = m => [...m].map(([k, v]) => [k, v instanceof Map ? [...v] : v]);
  return list.map(({ name, board }) => {
    const { model } = load(board);
    const L = layout(model);
    const placed = { direction: L.direction, mode: L.mode, flow: L.flow.map(l => l.id), laneOf: map(L.laneOf), order: map(L.order), slots: map(L.slots), rows: L.rows, edgeClass: map(L.edgeClass), groups: L.groups, warnings: L.warnings };
    const routes = {};
    for (const vertical of [false, true]) {
      const g = geometry(model, { vertical });
      routes[vertical ? "vertical" : "horizontal"] = hash(model.nodes.map(n => route(n.id, g.edges, g).wires.map(w => [w.from, w.to, w.k, w.h, w.points])));
    }
    return { name, layout: hash(placed), routes };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repo = process.argv[2];
  if (!repo || process.argv.length > 3) { console.error("usage: node test/compat/fingerprint.mjs <checkout of a release>"); process.exit(2); }
  const list = boards(repo);
  const prints = await fingerprints(repo, list);
  console.log(JSON.stringify({ release: JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")).version, boards: list.map((b, i) => ({ ...b, ...prints[i] })) }));
}
