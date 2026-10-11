// Times route() for every node of a board on a synthetic geometry sized like the renderer's (no
// browser needed) and counts clashes (crossings, and parallel runs closer than the minimum).
//   node test/bench-route.mjs [board.json] [--vertical]
import { readFileSync } from "node:fs";
import { load } from "../src/model.js";
import { route } from "../src/route.js";
import { geometry } from "./geometry.mjs";

const args = process.argv.slice(2);
const vertical = args.includes("--vertical");
const file = args.find(a => !a.startsWith("--")) ?? "examples/incident-response/board.json";
const { model } = load(JSON.parse(readFileSync(file, "utf8")));
const g = geometry(model, { vertical });
let worst = { ms: 0 }, total = 0, clashes = 0;
const bad = [];
for (const n of model.nodes) {
  const t0 = performance.now();
  const r = route(n.id, g.edges, g);
  const ms = performance.now() - t0;
  total += ms;
  clashes += r.crossings;
  if (r.crossings) bad.push(`${n.id}:${r.crossings}`);
  if (ms > worst.ms) worst = { id: n.id, ms: +ms.toFixed(1), wires: r.wires.length };
}
console.log(`${file}${vertical ? " (vertical)" : ""}: ${model.nodes.length} nodes, total ${total.toFixed(0)} ms, worst`, worst, "clashes", clashes, bad.join(" "));
