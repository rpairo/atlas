// A synthetic geometry in flow coordinates, sized the way the renderer sizes it: corridors from the
// worst-case demand (corridorSize), node sides from their ports (sideSize). It lets the routing be
// checked in Node, without a browser. `vertical` gives the proportions of the down/up directions,
// where a node is narrow along the flow and wide across it.
import { layout } from "../src/layout.js";
import { demand, corridorWidths, placeOf, sideSize } from "../src/route.js";

const BAND = 56, GAP = 14;

export function geometry(model, { vertical = false } = {}) {
  const L = layout(model);
  const N = L.flow.length;
  const place = placeOf(L);
  const ids = model.nodes.map(n => n.id);
  const edges = model.edges.filter(e => e.from !== e.to);
  const need = demand(model, L), w = corridorWidths(need, N);
  const ports = (id, s) => sideSize(need.ports.get(`${id}:${s}`) ?? 0);

  const nodeU = vertical ? 56 : 200;          // extent along the flow
  const nodeV = vertical ? 170 : 56;          // extent across it
  const rowV = Math.max(nodeV, ...ids.map(id => Math.max(ports(id, "L"), ports(id, "R")))) + GAP;

  const gut = w.g;
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
  span("ca", w.ca);
  const topV = v; v += BAND;
  span("ct", w.ct);
  const flowV = v; v += Math.max(1, L.rows) * rowV - GAP;
  span("cb", w.cb);
  const botV = v; v += BAND;
  span("cz", w.cz);

  const boxes = new Map();
  L.flow.forEach((lane, k) => L.order.get(lane.id).forEach(id => {
    // A node fills its row, as in the renderer (grid items stretch): a row made taller by the ports
    // of its busiest node gives every node in it that height, and those ports their room.
    const v0 = flowV + L.slots.get(id) * rowV;
    boxes.set(id, { l: colU[k], r: colU[k] + nodeU, t: v0, b: v0 + rowV - GAP });
  }));
  for (const [band, v0] of [[L.before, topV], [L.after, botV]]) {
    if (!band) continue;
    // A band node is never narrower than 40 units (on a narrow vertical board the band is wider than
    // the flow, as in the renderer, where band nodes keep their minimum width).
    const list = L.order.get(band.id), inner = W - gut[0] - gut[N], w = Math.max(40, inner / list.length);
    list.forEach((id, i) => boxes.set(id, { l: gut[0] + i * w + 5, r: gut[0] + (i + 1) * w - 5, t: v0, b: v0 + BAND }));
  }
  return { boxes, corridors, place, edges, layout: L };
}
