// Wire routing: orthogonal wires that only run through free corridors, so no wire ever crosses a
// node. Pure: it works on numbers, never on the DOM.
//
// Everything is computed in flow coordinates: `u` runs along the flow (the direction lanes follow
// each other) and `v` across it (where the bands sit: "before" at small v, "after" at large v).
// The renderer converts boxes into flow coordinates and the resulting points back.
//
// Corridors: gutters g0..gN run across the flow between lanes (g0 and gN are the margins); four
// channels run along it: ct between the "before" band and the lanes, cb between the lanes and the
// "after" band, ca outside the "before" band and cz outside the "after" band (for wires between
// two nodes of the same band).
//
// Wires that leave (or reach) the selected node by the same side, through the same corridors, and
// reach the same side at the other end travel as a bundle: one trunk that branches at the end.
// Loops (wires that return to the side they left) never bundle: each one gets its own track.
// Each bundle gets its own track in every corridor and its own port on every side; the order of
// tracks and ports is chosen by exhaustive search over permutations (small lists) to minimize
// crossings and parallel runs closer than the minimum separation.

export const ROUTE = Object.freeze({
  gutterPad: 15,   // closest a track gets to a node, along u
  channelPad: 16,  // closest a track gets to a node, along v
  trackStep: 11,   // distance between tracks in a gutter
  channelStep: 9,  // distance between tracks in a channel
  portPad: 10,     // closest a port gets to a corner, on the long side of a node
  portStep: 10,    // distance between ports on a side
  minSeparation: 6,
  arrow: 8,
  radius: 7,
  // Most work one route() may spend searching orders, in pairs of segments compared (about 50 ms
  // per million on a 2026 laptop). The busiest node of the examples and of a 35-node home map
  // spends under 3 million; a hub with dozens of wires would spend hundreds of millions. Past the
  // budget the search stops and keeps the best order found. Counted, not timed, so every machine
  // draws the same.
  budget: 6_000_000,
});

const PERMS = [[[]], [[0]]];
for (let n = 2; n <= 6; n++) {
  PERMS[n] = [];
  for (const p of PERMS[n - 1]) for (let i = 0; i <= p.length; i++) PERMS[n].push([...p.slice(0, i), n - 1, ...p.slice(i)]);
}

/**
 * Which corridors a wire takes and by which sides it leaves and enters (L R T B in flow terms:
 * L = start of the flow, R = end, T = towards the "before" band, B = towards the "after" band).
 * `pos(id)` gives abstract or measured centres {u, v}; `place(id)` gives {kind, col}.
 */
export function topology(from, to, place, pos, channels) {
  const A = place(from), C = place(to), a = pos(from), c = pos(to);
  const channel = (v1, v2) => {
    const up = Math.abs(v1 - channels.ct) + Math.abs(v2 - channels.ct);
    const down = Math.abs(v1 - channels.cb) + Math.abs(v2 - channels.cb);
    return up <= down ? "ct" : "cb";
  };
  if (A.kind === "col" && C.kind === "col") {
    const i = A.col, j = C.col;
    if (j === i + 1) return { s: "R", e: "L", cor: ["g" + (i + 1)] };
    if (j === i - 1) return { s: "L", e: "R", cor: ["g" + i] };
    if (j === i) return { s: "R", e: "R", cor: ["g" + (i + 1)] };
    const ch = channel(a.v, c.v);
    if (j > i) return { s: "R", e: "L", cor: ["g" + (i + 1), ch, "g" + j] };
    return { s: "L", e: "R", cor: ["g" + i, ch, "g" + (j + 1)] };
  }
  if (A.kind === "col") {
    const towardsStart = c.u < a.u;
    return { s: towardsStart ? "L" : "R", e: C.kind === "top" ? "B" : "T", cor: ["g" + (towardsStart ? A.col : A.col + 1), C.kind === "top" ? "ct" : "cb"] };
  }
  if (C.kind === "col") return { s: A.kind === "top" ? "B" : "T", e: "L", cor: [A.kind === "top" ? "ct" : "cb", "g" + C.col] };
  if (A.kind === C.kind) {
    const side = A.kind === "top" ? "T" : "B";
    return { s: side, e: side, cor: [A.kind === "top" ? "ca" : "cz"] };
  }
  return { s: A.kind === "top" ? "B" : "T", e: C.kind === "top" ? "B" : "T", cor: [A.kind === "top" ? "ct" : "cb", "g0", C.kind === "top" ? "ct" : "cb"] };
}

/** Groups the wires touching `selected` into bundles (same direction, sides and corridors). */
export function bundles(selected, edges, place, pos, channels) {
  const wires = [];
  for (const e of edges) {
    if (e.from === e.to || (e.from !== selected && e.to !== selected)) continue;
    const tp = topology(e.from, e.to, place, pos, channels);
    const k = e.from === selected ? "out" : "in";
    wires.push({
      id: e.id, ids: e.ids ?? [e.id], from: e.from, to: e.to, k, ...tp,
      far: k === "out" ? e.to : e.from,
      sideS: k === "out" ? tp.s : tp.e,
      sideF: k === "out" ? tp.e : tp.s,
      corS: k === "out" ? tp.cor : [...tp.cor].reverse(),
    });
  }
  const list = [], index = new Map();
  wires.forEach((w, i) => {
    // A wire that comes back to the side it left (same lane, or two nodes of the same band) is a
    // loop. Loops to different nodes nest like parentheses, and two nested loops on one track
    // always cross; each loop gets its own track and port, so the search can nest them.
    const loop = w.sideS === w.sideF && w.corS.length === 1;
    const key = `${w.k}|${w.sideS}|${w.corS.join(",")}|${w.sideF}${loop ? `|${w.far}` : ""}`;
    if (!index.has(key)) { index.set(key, list.length); list.push({ k: w.k, corS: w.corS, sideS: w.sideS, members: [] }); }
    w.h = index.get(key);
    list[w.h].members.push(i);
  });
  return { wires, bundles: list };
}

/**
 * How many tracks every corridor and how many ports every node side need, over every possible
 * selection. Sizing corridors for the worst case means selecting a node never moves anything.
 */
export function demand(nodeIds, edges, place, pos, channels) {
  const tracks = new Map();
  const ports = new Map();
  const bump = (map, key, n) => map.set(key, Math.max(map.get(key) ?? 0, n));
  for (const id of nodeIds) {
    const { wires, bundles: bs } = bundles(id, edges, place, pos, channels);
    const perCorridor = new Map();
    const perSide = new Map();
    bs.forEach(b => {
      for (const c of b.corS) perCorridor.set(c, (perCorridor.get(c) ?? 0) + 1);
      perSide.set(`${id}:${b.sideS}`, (perSide.get(`${id}:${b.sideS}`) ?? 0) + 1);
    });
    for (const w of wires) perSide.set(`${w.far}:${w.sideF}`, (perSide.get(`${w.far}:${w.sideF}`) ?? 0) + 1);
    for (const [c, n] of perCorridor) bump(tracks, c, n);
    for (const [s, n] of perSide) bump(ports, s, n);
  }
  return { tracks, ports };
}

/** Width a corridor needs for `n` tracks. */
export function corridorSize(n, kind) {
  const pad = kind === "g" ? ROUTE.gutterPad : ROUTE.channelPad;
  const step = kind === "g" ? ROUTE.trackStep : ROUTE.channelStep;
  return n <= 0 ? 0 : 2 * pad + (n - 1) * step + 2;
}

/** Length a node side needs for `n` ports. */
export function sideSize(n) {
  return n <= 1 ? 0 : 2 * ROUTE.portPad + (n - 1) * ROUTE.portStep;
}

/**
 * Routes the wires of `selected`.
 * @param g.boxes Map id → {l, r, t, b} in flow coordinates (l/r along u, t/b along v)
 * @param g.corridors {g0..gN, ct, cb, ca, cz} → {a, b} extents in flow coordinates
 * @param g.place id → {kind: "top"|"col"|"bot", col}
 * @returns { wires: [{id, from, to, k, h, points}], crossings }
 */
export function route(selected, edges, g) {
  const centre = id => { const r = g.boxes.get(id); return { u: (r.l + r.r) / 2, v: (r.t + r.b) / 2 }; };
  const channels = { ct: mid(g.corridors.ct), cb: mid(g.corridors.cb) };
  const { wires, bundles: hs } = bundles(selected, edges, g.place, centre, channels);
  if (!wires.length) return { wires: [], crossings: 0 };

  const lists = new Map();
  const put = (k, v) => { if (!lists.has(k)) lists.set(k, []); lists.get(k).push(v); };
  hs.forEach((h, j) => {
    put("P" + selected + ":" + h.sideS, { h: j });
    h.corS.forEach(p => put("C" + p, { h: j }));
  });
  wires.forEach((w, i) => put("P" + w.far + ":" + w.sideF, { i }));

  // Starting order: ports by where their wire turns next; tracks by where their bundle ends.
  const corridorMid = p => mid(g.corridors[p]);
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const target = (h, axis) => mean(hs[h].members.map(i => centre(wires[i].far)[axis]));
  const axisOf = side => (side === "L" || side === "R" ? "v" : "u");
  const key = item => {
    if (item.h !== undefined) {
      const h = hs[item.h];
      return h.corS[1] ? corridorMid(h.corS[1]) : target(item.h, axisOf(h.sideS));
    }
    const w = wires[item.i], cor = [...w.corS].reverse();
    return cor[1] ? corridorMid(cor[1]) : centre(selected)[axisOf(w.sideF)];
  };
  for (const [k, l] of lists) {
    if (k[0] === "P") l.sort((x, y) => key(x) - key(y));
    else { const axis = k[1] === "g" ? "v" : "u"; l.sort((x, y) => target(x.h, axis) - target(y.h, axis)); }
  }

  const slotOf = (k, pred) => { const l = lists.get(k); return [l.findIndex(pred), l.length]; };
  const port = (id, side, pos, n) => {
    const r = g.boxes.get(id);
    if (side === "L" || side === "R") return { u: side === "L" ? r.l : r.r, v: spread(r.t, r.b, n, pos, ROUTE.portPad, ROUTE.portStep) };
    return { u: spread(r.l, r.r, n, pos, 16, 18), v: side === "T" ? r.t : r.b };
  };
  const track = (p, h) => {
    const [pos, n] = slotOf("C" + p, v => v.h === h);
    const c = g.corridors[p];
    return p[0] === "g" ? spread(c.a, c.b, n, pos, ROUTE.gutterPad, ROUTE.trackStep) : spread(c.a, c.b, n, pos, ROUTE.channelPad, ROUTE.channelStep);
  };
  const points = i => {
    const w = wires[i];
    const [ps, ns] = slotOf("P" + selected + ":" + w.sideS, v => v.h === w.h);
    const [pf, nf] = slotOf("P" + w.far + ":" + w.sideF, v => v.i === i);
    const A = port(selected, w.sideS, ps, ns), F = port(w.far, w.sideF, pf, nf);
    const pts = [A];
    let p = A;
    for (const c of w.corS) {
      p = c[0] === "g" ? { u: track(c, w.h), v: p.v } : { u: p.u, v: track(c, w.h) };
      pts.push(p);
    }
    pts.push(w.sideF === "L" || w.sideF === "R" ? { u: p.u, v: F.v } : { u: F.u, v: p.v });
    pts.push(F);
    const clean = simplify(pts);
    return w.k === "out" ? clean : clean.reverse();
  };

  // score() runs thousands of times while a search moves one or two lists between calls, so only a
  // few wires change shape. Each wire keeps its segments and length, each pair its clashes, and only
  // the pairs that involve a wire whose points changed are measured again. Same result, far less work.
  const W = wires.length;
  let work = 0;
  const over = () => work > ROUTE.budget;
  const shape = new Array(W).fill(null), segsOf = new Array(W), lengthOf = new Float64Array(W);
  const pair = new Float64Array(W * W);
  const score = () => {
    work += 17 * W;   // re-pointing a wire costs about as much as 17 pairs of segments compared
    const moved = [];
    for (let i = 0; i < W; i++) {
      const pts = points(i);
      const k = pts.map(p => p.u + "," + p.v).join(" ");
      if (k === shape[i]) continue;
      shape[i] = k;
      const s = segments(pts);
      segsOf[i] = s;
      let len = 0;
      for (const [p, q] of s) len += Math.abs(p.u - q.u) + Math.abs(p.v - q.v);
      lengthOf[i] = len;
      moved.push(i);
    }
    if (moved.length) {
      const isMoved = new Uint8Array(W);
      for (const i of moved) isMoved[i] = 1;
      for (let a = 0; a < W; a++) for (let b = a + 1; b < W; b++) {
        if (!isMoved[a] && !isMoved[b]) continue;
        work += segsOf[a].length * segsOf[b].length;
        let c = 0;
        if (wires[a].h !== wires[b].h) for (const s1 of segsOf[a]) for (const s2 of segsOf[b]) c += clash(s1, s2);
        pair[a * W + b] = c;
      }
    }
    let total = 0, length = 0;
    for (let a = 0; a < W; a++) {
      length += lengthOf[a];
      for (let b = a + 1; b < W; b++) total += pair[a * W + b];
    }
    return total + length * 1e-5;
  };

  const tryPortsThenTracks = (kp, kc) => {
    const P = lists.get(kp), C = lists.get(kc);
    const baseP = [...P];
    let keepP = [...P], keepC = [...C];
    for (const perm of PERMS[baseP.length]) {
      if (over()) break;
      perm.forEach((o, q) => { P[q] = baseP[o]; });
      for (let pass = 0, moved = true; moved && pass < 3 && !over(); pass++) {
        moved = false;
        for (let i = 0; i < C.length && !over(); i++) {
          const item = C[i];
          let at = i, s0 = score();
          C.splice(i, 1);
          for (let j = 0; j <= C.length; j++) {
            C.splice(j, 0, item);
            const s = score();
            if (s < s0 - 1e-9) { s0 = s; at = j; }
            C.splice(j, 1);
          }
          C.splice(at, 0, item);
          if (at !== i) moved = true;
        }
      }
      const s = score();
      if (s < best - 1e-9) { best = s; keepP = [...P]; keepC = [...C]; if (best < 1) break; }
    }
    P.splice(0, P.length, ...keepP);
    C.splice(0, C.length, ...keepC);
  };

  const fact = n => (n <= 1 ? 1 : n * fact(n - 1));
  const live = [...lists.keys()].filter(k => lists.get(k).length > 1 && lists.get(k).length <= 6);
  let best = score();
  const tryGroup = group => {
    const bases = group.map(k => [...lists.get(k)]);
    let keep = bases.map(b => [...b]), improved = false;
    const rec = j => {
      if (j === group.length) {
        const s = score();
        if (s < best - 1e-9) { best = s; keep = group.map(k => [...lists.get(k)]); improved = true; }
        return;
      }
      for (const perm of PERMS[bases[j].length]) {
        if (over()) break;
        const l = lists.get(group[j]);
        perm.forEach((o, q) => { l[q] = bases[j][o]; });
        rec(j + 1);
      }
    };
    rec(0);
    group.forEach((k, j) => { lists.get(k).splice(0, lists.get(k).length, ...keep[j]); });
    return improved;
  };
  const cost = keys => keys.reduce((a, k) => a * fact(lists.get(k).length), 1);
  const pairwise = keys => {
    const groups = keys.map(k => [k]);
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      if (fact(lists.get(keys[a]).length) * fact(lists.get(keys[b]).length) <= 1500) groups.push([keys[a], keys[b]]);
    }
    for (let round = 0; round < 6 && best >= 1 && !over(); round++) {
      let any = false;
      for (const grp of groups) any = tryGroup(grp) || any;
      if (!any) break;
    }
  };
  if (best >= 1) {
    if (cost(live) <= 6000) tryGroup(live);
    else {
      // Too many orders to try at once. Lists that share no bundle cannot trade places, so each
      // connected set is searched on its own: loops on one side of a node no longer use up the
      // budget of the wires on another side.
      for (const set of connected(live, k => lists.get(k).map(item => (item.h !== undefined ? item.h : wires[item.i].h)))) {
        if (best < 1) break;
        if (cost(set) <= 6000) tryGroup(set);
        else pairwise(set);
      }
    }
  }
  // Still crossings: the ports of a side and the tracks of the corridor next to it decide
  // together. Try every order of the ports and, for each, move every track to its best place.
  if (best >= 1) {
    for (const kp of [...lists.keys()].filter(k => k.startsWith("P" + selected + ":") && lists.get(k).length > 1 && lists.get(k).length <= 6)) {
      const hsOnSide = new Set(lists.get(kp).map(v => v.h));
      const corridors = [...lists.keys()].filter(k => k[0] === "C" && lists.get(k).length > 1 && lists.get(k).some(v => hsOnSide.has(v.h)));
      for (const kc of corridors) if (best >= 1 && !over()) tryPortsThenTracks(kp, kc);
    }
  }
  return {
    wires: wires.map((w, i) => ({ id: w.id, ids: w.ids, from: w.from, to: w.to, k: w.k, h: w.h, points: points(i) })),
    crossings: Math.floor(best),
    lists: g.debug ? [...lists].map(([k, l]) => `${k}:${l.length}`) : undefined,
  };
}

/** Groups `keys` into sets linked by a shared member (`membersOf(key)` lists a key's members). */
function connected(keys, membersOf) {
  const root = new Map(keys.map(k => [k, k]));
  const find = k => { while (root.get(k) !== k) k = root.get(k); return k; };
  const owner = new Map();
  for (const k of keys) for (const m of membersOf(k)) {
    if (owner.has(m)) root.set(find(k), find(owner.get(m)));
    else owner.set(m, k);
  }
  const sets = new Map();
  for (const k of keys) {
    const r = find(k);
    if (!sets.has(r)) sets.set(r, []);
    sets.get(r).push(k);
  }
  return [...sets.values()];
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers (shared with the renderer and the audit)

/** n positions centred in [a, b], at most `step` apart and at least `pad` from either end. */
export function spread(a, b, n, i, pad, step) {
  if (n === 1) return (a + b) / 2;
  const room = Math.max(0, (b - pad) - (a + pad));
  const s = Math.min(step, room / (n - 1));
  return (a + b) / 2 + (i - (n - 1) / 2) * s;
}

export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.u - p.u) < 0.5 && Math.abs(q.v - p.v) < 0.5) continue;
    out.push({ ...p });
  }
  // Snap neighbours that are almost aligned, so every segment is exactly horizontal or vertical
  // (a sub-pixel difference would otherwise leave a tiny diagonal).
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (Math.abs(a.v - b.v) < 0.5) b.v = a.v;
    else if (Math.abs(a.u - b.u) < 0.5) b.u = a.u;
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((a.u === b.u && b.u === c.u) || (a.v === b.v && b.v === c.v)) out.splice(i, 1);
  }
  return out;
}

export function segments(pts) {
  const s = [];
  for (let j = 0; j < pts.length - 1; j++) s.push([pts[j], pts[j + 1]]);
  return s;
}

/** 1 for a crossing, 4 for parallel runs closer than the minimum separation that overlap. */
export function clash(s1, s2) {
  const flat = s => Math.abs(s[0].v - s[1].v) < 0.5;
  const [a1, a2] = s1, [b1, b2] = s2;
  const inside = (x, p, q) => x > Math.min(p, q) + 0.5 && x < Math.max(p, q) - 0.5;
  if (flat(s1) && flat(s2)) {
    if (Math.abs(a1.v - b1.v) >= ROUTE.minSeparation) return 0;
    return overlap(a1.u, a2.u, b1.u, b2.u) > 1 ? 4 : 0;
  }
  if (!flat(s1) && !flat(s2)) {
    if (Math.abs(a1.u - b1.u) >= ROUTE.minSeparation) return 0;
    return overlap(a1.v, a2.v, b1.v, b2.v) > 1 ? 4 : 0;
  }
  const [h, v] = flat(s1) ? [s1, s2] : [s2, s1];
  return inside(v[0].u, h[0].u, h[1].u) && inside(h[0].v, v[0].v, v[1].v) ? 1 : 0;
}

function overlap(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function mid(c) {
  return (c.a + c.b) / 2;
}
