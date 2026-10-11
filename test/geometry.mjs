// A synthetic geometry in flow coordinates, sized the way the renderer sizes it: corridors from the
// worst-case demand (corridorSize), node sides from their ports (sideSize). It lets the routing be
// checked in Node, without a browser. `vertical` gives the proportions of the down/up directions,
// where a node is narrow along the flow and wide across it.
import { layout } from "../src/layout.js";
import { demand, corridorSize, sideSize } from "../src/route.js";

const MIN_GUTTER = 56, MIN_CHANNEL = 30, MIN_OUTER = 26, BAND = 56, GAP = 14;

export function geometry(model, { vertical = false } = {}) {
  const L = layout(model);
  const N = L.flow.length;
  const col = new Map(L.flow.map((l, i) => [l.id, i]));
  const place = id => {
    const lane = L.laneOf.get(id);
    if (L.before && lane === L.before.id) return { kind: "top" };
    if (L.after && lane === L.after.id) return { kind: "bot" };
    return { kind: "col", col: col.get(lane) };
  };
  // The same abstract positions the renderer uses to size corridors.
  const bandIndex = new Map();
  for (const band of [L.before, L.after]) if (band) L.order.get(band.id).forEach((id, i, a) => bandIndex.set(id, (i + 0.5) / a.length * N));
  const abstract = id => {
    const p = place(id);
    if (p.kind === "top") return { u: bandIndex.get(id) - 0.5, v: -0.5 };
    if (p.kind === "bot") return { u: bandIndex.get(id) - 0.5, v: 1.5 };
    return { u: p.col, v: (L.slots.get(id) + 0.5) / Math.max(1, L.rows) };
  };
  const ids = model.nodes.map(n => n.id);
  const edges = model.edges.filter(e => e.from !== e.to);
  const need = demand(ids, edges, place, abstract, { ct: 0, cb: 1 });
  const size = (c, min) => Math.max(min, corridorSize(need.tracks.get(c) ?? 0, c[0] === "g" ? "g" : "c"));
  const ports = (id, s) => sideSize(need.ports.get(`${id}:${s}`) ?? 0);

  const nodeU = vertical ? 56 : 200;          // extent along the flow
  const nodeV = vertical ? 170 : 56;          // extent across it
  const rowV = Math.max(nodeV, ...ids.map(id => Math.max(ports(id, "L"), ports(id, "R")))) + GAP;

  const gut = Array.from({ length: N + 1 }, (_, k) => size("g" + k, k === 0 || k === N ? MIN_OUTER : MIN_GUTTER));
  const corridors = {};
  let u = 0;
  const colU = [];
  for (let k = 0; k <= N; k++) {
    corridors["g" + k] = { a: u, b: u + gut[k] };
    u += gut[k];
    if (k < N) { colU.push(u); u += nodeU; }
  }
  const W = u;
  let v = 0;
  const span = (name, len) => { corridors[name] = { a: v, b: v + len }; v += len; };
  span("ca", size("ca", 12));
  const topV = v; v += BAND;
  span("ct", size("ct", MIN_CHANNEL));
  const flowV = v; v += Math.max(1, L.rows) * rowV - GAP;
  span("cb", size("cb", MIN_CHANNEL));
  const botV = v; v += BAND;
  span("cz", size("cz", 12));

  const boxes = new Map();
  L.flow.forEach((lane, k) => L.order.get(lane.id).forEach(id => {
    const v0 = flowV + L.slots.get(id) * rowV;
    boxes.set(id, { l: colU[k], r: colU[k] + nodeU, t: v0, b: v0 + nodeV - GAP });
  }));
  for (const [band, v0] of [[L.before, topV], [L.after, botV]]) {
    if (!band) continue;
    const list = L.order.get(band.id), inner = W - gut[0] - gut[N], w = inner / list.length;
    list.forEach((id, i) => boxes.set(id, { l: gut[0] + i * w + 5, r: gut[0] + (i + 1) * w - 5, t: v0, b: v0 + BAND }));
  }
  return { boxes, corridors, place, edges, layout: L };
}
