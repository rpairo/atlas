// Property tests on seeded random boards. A failure prints the seed; rerun with SEED=<n>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, apply, serialize, normalize, validate, AtlasError } from "../src/model.js";
import { layout } from "../src/layout.js";
import { route } from "../src/route.js";

const RUNS = Number(process.env.RUNS ?? 150);
const FIRST = Number(process.env.SEED ?? 1);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function randomBoard(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const auto = r() < 0.3;
  const lanes = auto ? [] : Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ id: `l${i}`, title: `Lane ${i}` }));
  if (!auto && r() < 0.5) lanes.unshift({ id: "top", kind: "before" });
  if (!auto && r() < 0.5) lanes.push({ id: "bottom", kind: "after" });
  const groups = r() < 0.3 ? [{ id: "g1" }, { id: "g2", parent: "g1" }] : [];
  const n = 1 + Math.floor(r() * 25);
  const nodes = Array.from({ length: n }, (_, i) => {
    const node = { id: `n${i}`, title: `Node ${i}` };
    if (!auto && r() < 0.95) node.lane = pick(lanes).id;
    if (groups.length && r() < 0.3) node.group = pick(groups).id;
    return node;
  });
  const edges = [];
  const m = Math.floor(r() * n * 2);
  for (let k = 0; k < m; k++) edges.push({ from: pick(nodes).id, to: pick(nodes).id, label: r() < 0.5 ? `e${k}` : undefined });
  const direction = pick(["right", "down", "left", "up"]);
  return { format: "atlas/1", meta: { direction }, lanes, groups, nodes, edges };
}

/** A synthetic geometry in flow coordinates, built from the layout like the renderer does. */
function geometry(L) {
  const N = L.flow.length, COL = 160, GUT = 90, ROW = 64, TOP = 220;
  const boxes = new Map();
  L.flow.forEach((lane, k) => L.order.get(lane.id).forEach(id => {
    const u0 = GUT + k * (COL + GUT), v0 = TOP + L.slots.get(id) * ROW;
    boxes.set(id, { l: u0, r: u0 + COL, t: v0, b: v0 + 48 });
  }));
  const W = GUT + N * (COL + GUT), H = TOP + Math.max(1, L.rows) * ROW + 60;
  const bands = [[L.before, 90], [L.after, H + 90]];
  for (const [band, v0] of bands) if (band) {
    const ids = L.order.get(band.id), w = (W - 2 * GUT) / Math.max(1, ids.length);
    ids.forEach((id, i) => boxes.set(id, { l: GUT + i * w + 5, r: GUT + (i + 1) * w - 5, t: v0, b: v0 + 48 }));
  }
  const corridors = { ca: { a: 20, b: 88 }, ct: { a: 140, b: TOP - 4 }, cb: { a: H - 60 + 4, b: H + 88 }, cz: { a: H + 140, b: H + 210 } };
  for (let k = 0; k <= N; k++) corridors["g" + k] = { a: k === 0 ? 0 : GUT + (k - 1) * (COL + GUT) + COL, b: GUT + k * (COL + GUT) };
  const col = new Map(L.flow.map((l, i) => [l.id, i]));
  const place = id => {
    const lane = L.laneOf.get(id);
    if (L.before && lane === L.before.id) return { kind: "top" };
    if (L.after && lane === L.after.id) return { kind: "bot" };
    return { kind: "col", col: col.get(lane) };
  };
  return { boxes, corridors, place };
}

test(`layout invariants on ${RUNS} random boards`, () => {
  for (let seed = FIRST; seed < FIRST + RUNS; seed++) {
    const doc = randomBoard(seed);
    const { model } = load(doc);
    const a = layout(model);
    // every node placed exactly once
    const placed = [...a.order.values()].flat();
    assert.equal(placed.length, model.nodes.length, `seed ${seed}`);
    assert.equal(new Set(placed).size, placed.length, `seed ${seed}`);
    // slots strictly increase inside each flow lane and fit the rows
    for (const lane of a.flow) {
      const s = a.order.get(lane.id).map(id => a.slots.get(id));
      for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], `seed ${seed} lane ${lane.id}`);
      assert.ok(s.every(x => x >= 0 && x < Math.max(1, a.rows)), `seed ${seed}`);
    }
    // every group (with its subgroups) is contiguous inside a lane
    const parent = new Map(model.groups.map(g => [g.id, g.parent ?? null]));
    const within = (node, gid) => { for (let g = node.group ?? null; g !== null; g = parent.get(g) ?? null) if (g === gid) return true; return false; };
    for (const [lane, ids] of a.order) for (const g of model.groups) {
      const at = ids.map((id, i) => (within(model.nodes.find(n => n.id === id), g.id) ? i : -1)).filter(i => i >= 0);
      if (at.length && at[at.length - 1] - at[0] + 1 !== at.length) assert.fail(`seed ${seed}: group ${g.id} split in ${lane}`);
    }
    // edge order never changes anything; optimizing is deterministic
    const shuffled = { ...model, edges: [...model.edges].reverse() };
    const b = layout(shuffled);
    assert.deepEqual([...a.order], [...b.order], `seed ${seed}`);
    assert.deepEqual([...a.slots], [...b.slots], `seed ${seed}`);
    assert.deepEqual([...layout(model, { optimize: true }).order], [...layout(model, { optimize: true }).order], `seed ${seed}`);
  }
});

test(`routing invariants on ${RUNS} random boards`, () => {
  for (let seed = FIRST; seed < FIRST + RUNS; seed++) {
    const { model } = load(randomBoard(seed));
    const L = layout(model);
    const g = geometry(L);
    const edges = model.edges.filter(e => e.from !== e.to);
    for (const n of model.nodes) {
      const { wires } = route(n.id, edges, g);
      for (const w of wires) {
        const p = w.points;
        assert.ok(p.length >= 2, `seed ${seed} ${n.id}`);
        for (let i = 1; i < p.length; i++) {
          const flat = Math.abs(p[i].v - p[i - 1].v) < 0.01, upright = Math.abs(p[i].u - p[i - 1].u) < 0.01;
          assert.ok(flat || upright, `seed ${seed} ${w.from}>${w.to}: diagonal segment`);
        }
        // ends on the borders of its two nodes
        const onBorder = (pt, id) => {
          const r = g.boxes.get(id);
          const inU = pt.u >= r.l - 0.01 && pt.u <= r.r + 0.01, inV = pt.v >= r.t - 0.01 && pt.v <= r.b + 0.01;
          const edge = Math.abs(pt.u - r.l) < 0.01 || Math.abs(pt.u - r.r) < 0.01 || Math.abs(pt.v - r.t) < 0.01 || Math.abs(pt.v - r.b) < 0.01;
          return inU && inV && edge;
        };
        assert.ok(onBorder(p[0], w.from), `seed ${seed} ${w.from}>${w.to}: start`);
        assert.ok(onBorder(p[p.length - 1], w.to), `seed ${seed} ${w.from}>${w.to}: end`);
        // never through a node
        for (let i = 1; i < p.length; i++) {
          const a = p[i - 1], b = p[i], len = Math.hypot(b.u - a.u, b.v - a.v);
          for (let s = 0; s <= len; s += 2) {
            const u = a.u + (b.u - a.u) * s / (len || 1), v = a.v + (b.v - a.v) * s / (len || 1);
            for (const [id, r] of g.boxes) if (u > r.l + 1 && u < r.r - 1 && v > r.t + 1 && v < r.b - 1) {
              assert.fail(`seed ${seed} ${w.from}>${w.to} crosses ${id}`);
            }
          }
        }
      }
    }
  }
});

test(`random edit sequences never break a board (${RUNS} runs)`, () => {
  for (let seed = FIRST; seed < FIRST + RUNS; seed++) {
    const r = rng(seed * 7919);
    let { model } = load(randomBoard(seed));
    for (let step = 0; step < 12; step++) {
      const ids = model.nodes.map(n => n.id);
      const lanes = model.lanes.map(l => l.id);
      const pick = a => a[Math.floor(r() * a.length)];
      const ops = [
        () => ({ op: "addNode", node: { id: `x${seed}_${step}`, lane: lanes.length ? pick(lanes) : undefined } }),
        () => ids.length && { op: "removeNode", id: pick(ids) },
        () => ids.length > 1 && { op: "addEdge", edge: { from: pick(ids), to: pick(ids) } },
        () => model.edges.length && { op: "removeEdge", id: pick(model.edges).id },
        () => ids.length && { op: "renameNode", from: pick(ids), to: `r${seed}_${step}` },
        () => ids.length && lanes.length && { op: "moveNode", id: pick(ids), lane: pick(lanes), index: Math.floor(r() * 5) },
        () => ids.length && { op: "updateNode", id: pick(ids), changes: { title: `t${step}` } },
      ];
      const op = pick(ops)();
      if (!op) continue;
      try {
        model = apply(model, op).model;
      } catch (e) {
        assert.ok(e instanceof AtlasError, `seed ${seed}: ${e}`);
      }
      assert.equal(validate(model).ok, true, `seed ${seed} step ${step}`);
      const again = load(serialize(model)).model;
      assert.deepEqual(again.nodes, model.nodes, `seed ${seed}: round trip`);
      assert.deepEqual(again.edges, model.edges, `seed ${seed}: round trip`);
    }
  }
});

test("hostile input is rejected or neutralized", () => {
  const evil = '{"nodes":[{"id":"a","title":"</script><img src=x onerror=alert(1)>"},{"id":"constructor"}],"__proto__":{"x":1}}';
  const m = normalize(JSON.parse(evil, (k, v) => (k === "__proto__" ? undefined : v)));
  const r = validate(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === "id"));
  assert.throws(() => load({ nodes: [{ id: '"]' }] }), AtlasError);
});
