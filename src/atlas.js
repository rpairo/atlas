// Atlas: renders a board document as a live map and edits it through a small API.
//
//   const map = new Atlas(element, { document, selected: "a" });
//   map.addNode({ id: "b", title: "B", lane: "in" });     // placed in the best gap, animated
//   map.connect("a", "b", { label: "feeds" });
//   map.undo();
//   map.addEventListener("select", e => console.log(e.detail.id));
//
// Pipeline on every change: model → layout (pure) → corridor demand (pure) → DOM → measure →
// route the selected node's wires (pure) → paint. Text always goes in with textContent, never as
// HTML, and no CSS value comes from the data.

import * as M from "./model.js";
import { layout as computeLayout, bestInsertion, inversions } from "./layout.js";
import { route, demand, corridorSize, sideSize, ROUTE } from "./route.js";
import { STYLES } from "./styles.js";

const NS = "http://www.w3.org/2000/svg";
const SPEED = 1150;          // px per second: every wire traces at the same speed
const BUNDLE_STAGGER = 0.09; // seconds between bundles
const MIN_GUTTER = 56;
const MIN_CHANNEL = 30;
const MIN_OUTER = 26;
const STACK_BELOW = 720;   // px of container under which lanes stack
const BAND_NODE_MIN = 96;  // px: narrowest a node of a band gets
const PANEL_GAP = 20;      // px between the board and a side panel (.atlas gap)
const STAGES = { remove: 200, move: 450, add: 250, stagger: 30, staggerCap: 120 };
const STATUS = /^[a-z0-9_-]{1,32}$/;
const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const DEFAULT_LABELS = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  unassigned: "Unassigned",
  selfLoop: "Feeds back into itself",
};

export class Atlas extends EventTarget {
  /**
   * @param host element to render into (a shadow root is attached unless `options.shadow` is false)
   * @param options.document board (object or JSON text)
   * @param options.selected id of the node selected at start (default: meta.selected)
   * @param options.panel "auto" | false — show the detail panel
   * @param options.labels texts of the interface (incoming, outgoing, unassigned, selfLoop)
   * @param options.renderNode (node, button, live) => void — custom node content
   * @param options.animate trace wires when selecting (default true)
   * @param options.shadow render into a shadow root (default true)
   * Options and labels set to undefined keep their defaults.
   */
  constructor(host, options = {}) {
    super();
    this.host = host;
    this.options = { panel: "auto", animate: true, shadow: true, ...clean(options) };
    this.labels = { ...DEFAULT_LABELS, ...clean(options.labels ?? {}) };
    this.root = this.options.shadow ? (host.shadowRoot ?? host.attachShadow({ mode: "open" })) : host;
    this._els = new Map();        // node id → button
    this._items = new Map();      // node id → li
    this._live = new Map();       // node id → { subtitle, status }
    this._idOf = new WeakMap();   // button → node id (survives renames)
    this._history = [];
    this._future = [];
    this._rev = 0;
    this._selected = null;
    this._layout = null;
    this._animations = [];
    this._frame = 0;
    this._mount();
    this._model = M.normalize({ nodes: [] });
    if (options.document !== undefined) this.load(options.document, { selected: options.selected });
  }

  // -------------------------------------------------------------------------------------------
  // Reading

  /** The board as it should be saved (canonical, with the current order as its sketch). */
  toJSON() { return M.serialize(this._model); }
  export() { return this.toJSON(); }
  get rev() { return this._rev; }
  get selected() { return this._selected; }
  /** Warnings of the board (validate) and of its placement (a group split by constraints). */
  get warnings() { return [...(this._warnings ?? []), ...(this._layout?.warnings ?? [])]; }
  node(id) { const n = this._model.nodes.find(x => x.id === id); return n ? M.clone(n) : null; }
  edges(id) {
    return this._model.edges.filter(e => e.from === id || e.to === id).map(e => M.clone(e));
  }
  /** Nodes whose title, subtitle or details contain `text` (case-insensitive). */
  find(text) {
    const q = String(text).toLocaleLowerCase();
    return this._model.nodes.filter(n => [n.title, n.subtitle, ...(n.details ?? [])].some(s => typeof s === "string" && s.toLocaleLowerCase().includes(q))).map(n => n.id);
  }
  /** Nodes that contradict their lane: most of their edges run backwards. Advice, never applied. */
  suggestions() {
    const out = [];
    const L = this._layout;
    if (!L) return out;
    for (const n of this._model.nodes) {
      const es = this._model.edges.filter(e => (e.from === n.id || e.to === n.id) && e.from !== e.to);
      if (es.length < 2) continue;
      const back = es.filter(e => L.edgeClass.get(e.id) === "backward").length;
      if (back * 2 > es.length) out.push({ node: n.id, code: "lane", message: `most edges of "${n.id}" run against the flow; check its lane` });
    }
    if (L.flow.some(l => l.id === M.UNASSIGNED)) out.push({ code: "unassigned", message: "some nodes have no lane" });
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Loading and editing. Every edit is one undoable step and fires a "change" event.

  /** Replaces the board. A board not yet ordered by Atlas is tidied once (fewest crossings). */
  load(input, { optimize, selected } = {}) {
    const { model, warnings } = M.load(input);
    const tidy = optimize ?? model.meta.ordered !== true;
    let m = model;
    if (tidy) {
      const L = computeLayout(m, { optimize: true });
      m = withOrder(m, L);
    }
    m.meta.ordered = true;
    this._model = m;
    this._warnings = warnings;
    this._history = [];
    this._future = [];
    this._live.clear();
    this._rev++;
    this._render({ animate: false });
    const first = selected === undefined ? (m.meta.selected ?? null) : selected;
    this.select(first && m.nodes.some(n => n.id === first) ? first : null, { focus: false, animate: this.options.animate });
    this._emit("change", { rev: this._rev, diff: null, warnings: this.warnings });
    return this;
  }

  /** Applies raw operations (see model.js OPS) as one step. */
  apply(ops) {
    const before = this._model;
    const { model, warnings } = M.apply(before, ops);
    this._commit(before, model, warnings);
    return this._rev;
  }

  /** Groups several edits into one undoable step: map.batch(m => { m.addNode(...); m.connect(...) }). */
  batch(fn) {
    const before = this._model;
    const proxy = new Batch(this, before);
    fn(proxy);
    if (proxy.model !== before) this._commit(before, proxy.model, proxy.warnings);
    return this._rev;
  }

  /** Adds a node. Without an explicit index it goes to the gap with fewest crossings. */
  addNode(node, { index, edges = [] } = {}) {
    return this.batch(b => b.addNode(node, { index, edges }));
  }
  updateNode(id, changes) { return this.apply({ op: "updateNode", id, changes }); }
  moveNode(id, { lane, index } = {}) { return this.apply({ op: "moveNode", id, lane, index }); }
  removeNode(id) { return this.apply({ op: "removeNode", id }); }
  renameNode(from, to) {
    // The element stays the same node on screen: it glides (if anything), never fades out and in.
    const swapKey = (map, a, b) => { if (map.has(a)) { map.set(b, map.get(a)); map.delete(a); } };
    const rekey = (a, b) => {
      swapKey(this._els, a, b);
      swapKey(this._items, a, b);
      swapKey(this._live, a, b);
      this._idOf.set(this._els.get(b), b);
    };
    const moved = this._els.has(from) && !this._els.has(to);
    const selected = this._selected === from;
    if (moved) rekey(from, to);
    if (selected) this._selected = to;
    let rev;
    try {
      rev = this.apply({ op: "renameNode", from, to });
    } catch (e) {
      if (moved) rekey(to, from);   // the edit was refused: the screen keeps the old id
      if (selected) this._selected = from;
      throw e;
    }
    if (selected) this._emit("select", { id: to });
    return rev;
  }
  connect(from, to, { id, label, details, type } = {}) {
    return this.apply({ op: "addEdge", edge: clean({ id, from, to, label, details, type }) });
  }
  updateEdge(id, changes) { return this.apply({ op: "updateEdge", id, changes }); }
  disconnect(idOrPair) {
    const id = typeof idOrPair === "string" ? idOrPair
      : this._model.edges.find(e => e.from === idOrPair?.from && e.to === idOrPair?.to)?.id;
    if (id === undefined) {
      throw new M.AtlasError([{ path: "", code: "invalid", message: `no edge from "${idOrPair?.from}" to "${idOrPair?.to}"` }]);
    }
    return this.apply({ op: "removeEdge", id });
  }
  addLane(lane, { index } = {}) { return this.apply({ op: "addLane", lane, index }); }
  updateLane(id, changes) { return this.apply({ op: "updateLane", id, changes }); }
  moveLane(id, index) { return this.apply({ op: "moveLane", id, index }); }
  removeLane(id, { moveTo } = {}) { return this.apply({ op: "removeLane", id, moveTo }); }
  addGroup(group) { return this.apply({ op: "addGroup", group }); }
  removeGroup(id) { return this.apply({ op: "removeGroup", id }); }
  addConstraint(constraint) { return this.apply({ op: "addConstraint", constraint }); }
  removeConstraint(index) { return this.apply({ op: "removeConstraint", index }); }
  /** Optionally moves a node, then marks it pinned: reorderAll() leaves it where it is. */
  pin(id, { lane, index } = {}) {
    return this.batch(b => {
      if (lane !== undefined || index !== undefined) b.apply({ op: "moveNode", id, lane, index });
      b.apply({ op: "updateNode", id, changes: { pinned: true } });
    });
  }
  unpin(id) { return this.apply({ op: "updateNode", id, changes: { pinned: null } }); }
  setMeta(changes) { return this.apply({ op: "setMeta", changes }); }

  /**
   * Reorders every lane for the fewest crossings. With { dryRun: true } it only reports how many
   * pairs of nodes would swap. Pinned nodes keep their place.
   */
  reorderAll({ dryRun = false } = {}) {
    const now = this._layout ?? computeLayout(this._model);
    let m = withOrder(this._model, computeLayout(this._model, { optimize: true }), true);
    // Groups and constraints apply again when the result is drawn. A lane where that would move a
    // pinned node keeps its current order: pinned nodes never move.
    const drawn = computeLayout(m);
    const pinned = new Set(this._model.nodes.filter(n => n.pinned).map(n => n.id));
    const kept = [...now.order].filter(([lane, ids]) => ids.some((id, i) => pinned.has(id) && drawn.order.get(lane)?.[i] !== id)).map(([lane]) => lane);
    if (kept.length) m = withOrder(this._model, { ...drawn, order: new Map([...drawn.order].map(([lane, ids]) => [lane, kept.includes(lane) ? now.order.get(lane) : ids])) });
    // Counted on the order that results, after pinned nodes went back to their places.
    const swaps = inversions(now, computeLayout(m));
    if (dryRun || swaps === 0) return { swaps };
    this._commit(this._model, m, this._warnings, { long: true });
    return { swaps };
  }

  undo() {
    const prev = this._history.pop();
    if (!prev) return false;
    this._future.push(this._model);
    this._swap(prev);
    return true;
  }
  redo() {
    const next = this._future.pop();
    if (!next) return false;
    this._history.push(this._model);
    this._swap(next);
    return true;
  }
  get canUndo() { return this._history.length > 0; }
  get canRedo() { return this._future.length > 0; }

  /** Live content (for example from a home automation system): never moves anything. */
  setState(id, { subtitle, status } = {}) {
    if (!this._els.has(id)) return;
    const s = { ...(this._live.get(id) ?? {}) };
    if (subtitle !== undefined) s.subtitle = subtitle === null ? undefined : String(subtitle);
    if (status !== undefined) s.status = status !== null && STATUS.test(String(status)) ? String(status) : undefined;
    this._live.set(id, s);
    this._fillNode(this._model.nodes.find(n => n.id === id), this._els.get(id));
  }

  /** Selects a node (or null), shows its wires and its detail. */
  select(id, { focus = true, animate = this.options.animate } = {}) {
    if (id !== null && !this._els.has(id)) id = null;
    const prev = this._selected;
    this._selected = id;
    this._highlight();
    this._fillPanel();
    this._placePanel();
    this._paint(animate);
    if (id !== null) this._setTabStop(id, focus);
    if (prev !== id) this._emit("select", { id });
    this._announce(id === null ? "" : this._summary(id));
  }

  /** Finishes any running transition at once (its end state) and redraws the wires. */
  settle() {
    const running = this._animations;
    this._animations = [];
    running.forEach(a => a.finish());
    for (const g of this._board.querySelectorAll(":scope > .node[aria-hidden]")) g.remove();
    this._paint(false);
  }

  /** Frees the map: observers, frames and animations stop and the content is removed. Final: a
   *  destroyed instance draws nothing more; create a new one to show a board again. */
  destroy() {
    this._destroyed = true;
    this._ro?.disconnect();
    cancelAnimationFrame(this._frame);
    const running = this._animations;
    this._animations = [];          // a transition's end callback sees it is no longer current
    running.forEach(a => a.cancel());
    this.root.replaceChildren();
  }
  get destroyed() { return this._destroyed === true; }

  // -------------------------------------------------------------------------------------------
  // Internals: commit, history

  _commit(before, after, warnings, { long = false } = {}) {
    // An edit that changes nothing (same title, empty list of operations) makes no undo step.
    if (after === before || JSON.stringify(M.serialize(after)) === JSON.stringify(M.serialize(before))) return;
    this._history.push(before);
    if (this._history.length > 200) this._history.shift();
    this._future = [];
    this._model = after;
    this._warnings = warnings ?? [];
    this._rev++;
    const d = M.diff(before, after);
    this._render({ animate: true, diff: d, long });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
  }

  _swap(model) {
    const before = this._model;
    this._model = model;
    this._warnings = M.validate(model).warnings;
    this._rev++;
    const d = M.diff(before, model);
    this._render({ animate: true, diff: d });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.host.dispatchEvent(new CustomEvent(`atlas-${type}`, { detail, bubbles: true, composed: true }));
  }

  // -------------------------------------------------------------------------------------------
  // DOM: skeleton

  _mount() {
    const style = document.createElement("style");
    style.textContent = STYLES;
    this._wrap = el("div", "atlas");
    this._boardWrap = el("div", "board-wrap");
    this._board = el("div", "board");
    this._board.setAttribute("part", "board");
    this._svg = document.createElementNS(NS, "svg");
    this._svg.setAttribute("class", "wires");
    this._svg.setAttribute("aria-hidden", "true");
    this._panel = el("aside", "panel");
    this._panel.setAttribute("part", "panel");
    this._status = el("div", "status");
    this._status.setAttribute("role", "status");
    this._status.setAttribute("aria-atomic", "true");
    this._boardWrap.append(this._board);
    this._wrap.append(this._boardWrap, this._panel, this._status);
    this.root.replaceChildren(style, this._wrap);
    this._board.addEventListener("keydown", e => this._onKey(e));
    this._ro = new ResizeObserver(() => this._schedule());
    this._ro.observe(this._board);
    this._ro.observe(this.host);
  }

  _schedule() {
    if (this._destroyed) return;
    cancelAnimationFrame(this._frame);
    this._frame = requestAnimationFrame(() => {
      this._applyMode();
      this._placePanel();
      if (!this._running()) this._paint(false);
    });
  }

  _running() {
    return this._animations.some(a => a.playState === "running" || a.playState === "pending");
  }

  // -------------------------------------------------------------------------------------------
  // DOM: render the layout

  _render({ animate = false, diff = null, long = false } = {}) {
    if (this._destroyed) return;
    // The selection follows the board: a node that is gone (removed, renamed by undo, another board
    // loaded) is no longer selected, and listeners hear it.
    const lost = this._selected !== null && !this._model.nodes.some(n => n.id === this._selected);
    if (lost) this._selected = null;
    const active = this._active();
    const hadFocus = active !== null && this._board.contains(active);
    const motion = animate && !reducedMotion();
    this._animations.forEach(a => a.finish());
    this._animations = [];
    const first = motion ? this._rects() : null;

    const L = computeLayout(this._model);
    this._layout = L;
    const geo = this._abstractGeometry(L);
    const need = demand(this._model.nodes.map(n => n.id), this._model.edges, geo.place, geo.pos, { ct: 0, cb: 1 });
    this._need = need;
    this._build(L, need);
    this._minWidth = this._intrinsicWidth();
    this._applyMode();
    this._highlight();
    this._fillPanel();
    this._placePanel();
    // Focus was on a node that is gone: keep it in the map, on the node that holds the tab stop.
    if (hadFocus && !this._board.contains(this._active())) {
      this._ensureTabStop();
      [...this._els.values()].find(b => b.tabIndex === 0)?.focus({ preventScroll: true });
    }
    if (lost) { this._emit("select", { id: null }); this._announce(""); }

    if (motion && first) this._transition(first, diff, long);
    else this._paint(false);
  }

  /** The focused element inside the map's root (shadow root or host). */
  _active() {
    const a = this.root instanceof ShadowRoot ? this.root.activeElement : document.activeElement;
    return a ?? null;
  }

  /** Abstract positions (before measuring) used to size corridors: u = lane, v = slot. */
  _abstractGeometry(L) {
    const col = new Map(L.flow.map((l, i) => [l.id, i]));
    const N = L.flow.length;
    const bandIndex = new Map();
    for (const band of [L.before, L.after]) if (band) L.order.get(band.id).forEach((id, i, a) => bandIndex.set(id, (i + 0.5) / a.length * N));
    const place = id => {
      const lane = L.laneOf.get(id);
      if (L.before && lane === L.before.id) return { kind: "top" };
      if (L.after && lane === L.after.id) return { kind: "bot" };
      return { kind: "col", col: col.get(lane) };
    };
    const pos = id => {
      const p = place(id);
      if (p.kind === "top") return { u: bandIndex.get(id) - 0.5, v: -0.5 };
      if (p.kind === "bot") return { u: bandIndex.get(id) - 0.5, v: 1.5 };
      return { u: p.col, v: (L.slots.get(id) + 0.5) / L.rows };
    };
    return { place, pos };
  }

  _build(L, need) {
    const dir = L.direction;
    const vertical = dir === "down" || dir === "up";
    const reversed = dir === "left" || dir === "up";
    const N = L.flow.length;
    this._wrap.dataset.direction = dir;
    const board = this._board;
    const keep = new Set(this._model.nodes.map(n => n.id));
    for (const [id, li] of this._items) if (!keep.has(id)) { li.remove(); this._items.delete(id); this._els.delete(id); this._live.delete(id); }

    const size = (c, min) => Math.max(min, corridorSize(need.tracks.get(c) ?? 0, c[0] === "g" ? "g" : "c"));
    const gutters = Array.from({ length: N + 1 }, (_, k) => size("g" + k, k === 0 || k === N ? MIN_OUTER : MIN_GUTTER));
    const ch = { ct: size("ct", MIN_CHANNEL), cb: size("cb", MIN_CHANNEL), ca: size("ca", 12), cz: size("cz", 12) };
    for (let k = 0; k <= N; k++) board.style.setProperty(`--g${k}`, `${gutters[k]}px`);
    for (const [k, v] of Object.entries(ch)) board.style.setProperty(`--${k}`, `${v}px`);

    // Board: before band, channel, flow, channel, after band, stacked across the flow.
    const parts = [];
    const bandEl = (band, kind) => {
      const sec = el("section", `band ${kind}`);
      sec.dataset.lane = band.id;
      const title = txt("h3", "lane-title", band.title ?? "");
      const spacer = el("div", `channel ch-${kind === "before" ? "ca" : "cz"}`);
      const list = el("ol", "nodes");
      const ids = L.order.get(band.id);
      if (vertical) {
        list.style.gridTemplateRows = `repeat(${Math.max(1, ids.length)}, auto)`;
        sec.style.gridTemplateColumns = kind === "before" ? `var(--ca) minmax(140px, 220px)` : `minmax(140px, 220px) var(--cz)`;
        sec.style.gridTemplateRows = "auto 1fr";
        title.style.gridColumn = "1 / -1";
        spacer.style.gridColumn = kind === "before" ? "1" : "2";
        list.style.gridColumn = kind === "before" ? "2" : "1";
        spacer.style.gridRow = list.style.gridRow = "2";
        list.style.marginBlock = `var(--g${reversed ? N : 0}) var(--g${reversed ? 0 : N})`;
      } else {
        list.style.gridTemplateColumns = `repeat(${Math.max(1, ids.length)}, minmax(${BAND_NODE_MIN}px, 1fr))`;
        sec.style.gridTemplateRows = kind === "before" ? "auto var(--ca) auto" : "auto var(--cz) auto";
        list.style.marginInline = `var(--g${reversed ? N : 0}) var(--g${reversed ? 0 : N})`;
      }
      ids.forEach((id, i) => {
        const li = this._item(id);
        li.style.gridRow = vertical ? `${i + 1}` : "";
        li.style.gridColumn = vertical ? "" : `${i + 1}`;
        list.append(li);
      });
      if (kind === "before") sec.append(title, spacer, list);
      else sec.append(list, spacer, title);
      return sec;
    };
    if (L.before) parts.push(bandEl(L.before, "before"));
    parts.push(cls(el("div", "channel ch-ct"), "lane-gap"));

    const flow = el("div", "flow");
    const rows = L.rows;
    if (vertical) {
      const tracks = [];
      for (let k = 0; k < N; k++) tracks.push(`var(--g${k})`, "auto");
      tracks.push(`var(--g${N})`);
      flow.style.gridTemplateRows = (reversed ? reverseTracks(tracks) : tracks).join(" ");
      flow.style.gridTemplateColumns = `minmax(64px, max-content) repeat(${rows}, minmax(var(--node-min-cross, 120px), 1fr))`;
      flow.style.columnGap = "10px";
    } else {
      const tracks = [];
      for (let k = 0; k < N; k++) tracks.push(`var(--g${k})`, "minmax(var(--node-min), 1fr)");
      tracks.push(`var(--g${N})`);
      flow.style.gridTemplateColumns = (reversed ? reverseTracks(tracks) : tracks).join(" ");
      flow.style.gridTemplateRows = `auto repeat(${rows}, auto)`;
      flow.style.rowGap = "10px";
    }
    const gutterEls = [];
    for (let k = 0; k <= N; k++) {
      const g = el("div", "gutter");
      g.dataset.k = String(k);
      const track = reversed ? 2 * (N - k) + 1 : 2 * k + 1;
      if (vertical) { g.style.gridRow = `${track}`; g.style.gridColumn = "1 / -1"; }
      else { g.style.gridColumn = `${track}`; g.style.gridRow = "1 / -1"; }
      gutterEls.push(g);
      flow.append(g);
    }
    this._gutters = gutterEls;
    this._lanes = [];
    L.flow.forEach((lane, k) => {
      const sec = el("section", "lane");
      sec.dataset.lane = lane.id;
      const track = reversed ? 2 * (N - 1 - k) + 2 : 2 * k + 2;
      const title = txt("h3", "lane-title", lane.id === M.UNASSIGNED ? this.labels.unassigned : (lane.title ?? ""));
      const list = el("ol", "nodes");
      if (vertical) {
        sec.style.gridRow = `${track}`;
        sec.style.gridColumn = "1 / -1";
        sec.style.gridTemplateColumns = "subgrid";
        title.style.gridColumn = "1";
        title.style.alignSelf = "center";
        list.style.gridColumn = "2 / -1";
        list.style.gridTemplateColumns = "subgrid";
      } else {
        sec.style.gridColumn = `${track}`;
        sec.style.gridRow = "1 / -1";
        sec.style.gridTemplateRows = "subgrid";
        title.style.gridRow = "1";
        list.style.gridRow = "2 / -1";
        list.style.gridTemplateRows = "subgrid";
      }
      for (const id of L.order.get(lane.id)) {
        const li = this._item(id);
        const slot = L.slots.get(id) + 1;
        li.style.gridRow = vertical ? "" : `${slot}`;
        li.style.gridColumn = vertical ? `${slot}` : "";
        list.append(li);
      }
      // Group boxes, drawn behind the nodes of their slot span.
      for (const span of L.groups.filter(s => s.lane === lane.id)) {
        const box = el("div", "group-box");
        const label = txt("span", "", span.title);
        box.append(label);
        if (vertical) { box.style.gridColumn = `${span.from + 1} / ${span.to + 2}`; box.style.gridRow = "1"; }
        else { box.style.gridRow = `${span.from + 1} / ${span.to + 2}`; box.style.gridColumn = "1"; }
        list.prepend(box);
      }
      sec.append(title, list);
      this._lanes.push(sec);
      flow.append(sec);
    });
    parts.push(flow);
    parts.push(cls(el("div", "channel ch-cb"), "lane-gap"));
    if (L.after) parts.push(bandEl(L.after, "after"));

    if (vertical) {
      // min-content minimums: an auto track would let Chrome squeeze the parts (min-width: 0) below
      // what their own tracks need, and the board would end narrower than its content.
      board.style.gridTemplateColumns = parts.map(p => p.classList.contains("ch-ct") ? "var(--ct)" : p.classList.contains("ch-cb") ? "var(--cb)" : p.classList.contains("flow") ? "minmax(min-content, 1fr)" : "minmax(min-content, auto)").join(" ");
      board.style.gridTemplateRows = "";
    } else {
      board.style.gridTemplateRows = parts.map(p => p.classList.contains("ch-ct") ? "var(--ct)" : p.classList.contains("ch-cb") ? "var(--cb)" : "auto").join(" ");
      board.style.gridTemplateColumns = "minmax(min-content, 1fr)";
    }
    board.replaceChildren(this._svg, ...parts);

    // Ports need room: a node is at least as long as its busiest side requires.
    for (const n of this._model.nodes) {
      const b = this._els.get(n.id);
      const sides = vertical ? ["T", "B"] : ["L", "R"];
      const len = Math.max(...sides.map(s => sideSize(need.ports.get(`${n.id}:${s}`) ?? 0)));
      b.style.minHeight = !vertical && len ? `${len}px` : "";
      b.style.minWidth = vertical && len ? `${len}px` : "";
      this._fillNode(n, b);
    }
    this._ensureTabStop();
  }

  _item(id) {
    let li = this._items.get(id);
    if (!li) {
      li = el("li");
      const b = el("button", "node");
      b.type = "button";
      b.tabIndex = -1;
      this._idOf.set(b, id);
      b.addEventListener("click", () => this.select(this._idOf.get(b)));
      li.append(b);
      this._items.set(id, li);
      this._els.set(id, b);
    }
    return li;
  }

  _fillNode(n, b) {
    if (!n || !b) return;
    const live = this._live.get(n.id) ?? {};
    const type = typeof n.type === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(n.type) ? n.type : null;
    b.setAttribute("part", ["node", type && `node-${type}`, live.status && `status-${live.status}`].filter(Boolean).join(" "));
    if (live.status) b.dataset.status = live.status; else delete b.dataset.status;
    if (this.options.renderNode) { this.options.renderNode(M.clone(n), b, { ...live }); return; }
    const t = txt("span", "t", n.title ?? n.id);
    const sub = live.subtitle ?? n.subtitle;
    const parts = [t];
    if (sub) parts.push(txt("span", "s", sub));
    b.replaceChildren(...parts);
  }

  // -------------------------------------------------------------------------------------------
  // Modes: flow (wires) or stack (one lane after another); the panel at the side or below.

  _applyMode() {
    const L = this._layout;
    if (!L) return;
    const width = this.host.getBoundingClientRect().width || this._wrap.getBoundingClientRect().width;
    // A hidden host measures 0: measure again once it shows, and estimate until then.
    if (!this._minWidth) this._minWidth = this._intrinsicWidth();
    const vertical = L.direction === "down" || L.direction === "up";
    const lanes = vertical ? Math.max(1, L.rows) : Math.max(1, L.flow.length);
    const needed = this._minWidth || lanes * (vertical ? 130 : 150) + (lanes + 1) * MIN_GUTTER + 40;
    const side = (parseFloat(getComputedStyle(this._wrap).getPropertyValue("--atlas-panel-width")) || 300) + PANEL_GAP;
    // Wires need the lanes side by side. When they do not fit, the board scrolls sideways inside
    // its box; only a really narrow container stacks the lanes.
    const mode = width >= Math.min(needed, STACK_BELOW) ? "flow" : "stack";
    const panel = this.options.panel === false ? "none" : mode === "stack" ? "inline" : width >= needed + side ? "side" : "below";
    if (this._wrap.dataset.mode !== mode) this._wrap.dataset.mode = mode;
    if (this._wrap.dataset.panel !== panel) this._wrap.dataset.panel = panel;
  }

  /** Narrowest the board can be laid out side by side, measured once per build: it depends on the
   *  corridors and the lanes, not on the container. */
  _intrinsicWidth() {
    const wrap = this._wrap, board = this._board, mode = wrap.dataset.mode;
    wrap.dataset.mode = "flow";
    board.style.width = "min-content";
    const w = Math.ceil(board.getBoundingClientRect().width);
    board.style.width = "";
    if (mode === undefined) delete wrap.dataset.mode; else wrap.dataset.mode = mode;
    return w;
  }

  _placePanel() {
    const inline = this._wrap.dataset.panel === "inline";
    // Inline, the detail goes inside the selected node's <li>: an <ol> holds only <li>s.
    if (inline && this._selected && this._items.has(this._selected)) this._items.get(this._selected).append(this._panel);
    else if (!inline && this._panel.parentNode !== this._wrap) this._wrap.insertBefore(this._panel, this._status);
    this._panel.hidden = this._selected === null || this._wrap.dataset.panel === "none";
  }

  _flowMode() {
    return this._wrap.dataset.mode === "flow";
  }

  // -------------------------------------------------------------------------------------------
  // Selection, highlight and detail panel

  _highlight() {
    const id = this._selected;
    const outs = new Set(), ins = new Set();
    if (id !== null) for (const e of this._model.edges) {
      if (e.from === id && e.to !== id) outs.add(e.to);
      if (e.to === id && e.from !== id) ins.add(e.from);
    }
    for (const [nid, b] of this._els) {
      b.classList.toggle("on", nid === id);
      b.classList.toggle("near-out", outs.has(nid));
      b.classList.toggle("near-in", ins.has(nid));
      b.setAttribute("aria-pressed", nid === id ? "true" : "false");
    }
    this._board.classList.toggle("has-selection", id !== null);
  }

  _fillPanel() {
    const id = this._selected;
    if (id === null) { this._panel.replaceChildren(); return; }
    const n = this._model.nodes.find(x => x.id === id);
    const L = this._layout;
    const laneId = L.laneOf.get(id);
    const lane = [L.before, ...L.flow, L.after].find(l => l && l.id === laneId);
    const kids = [];
    const p = txt("p", "p-lane", laneId === M.UNASSIGNED ? this.labels.unassigned : (lane?.title ?? ""));
    const h = txt("h3", "", n.title ?? n.id);
    kids.push(p, h);
    const sub = this._live.get(id)?.subtitle ?? n.subtitle;
    if (sub) kids.push(txt("p", "p-sub", sub));
    if (Array.isArray(n.details) && n.details.length) {
      const ul = el("ul");
      for (const d of n.details) ul.append(txt("li", "", d));
      kids.push(ul);
    }
    const rel = (dir, edges, other) => {
      if (!edges.length) return;
      const box = el("div", "rel");
      box.dataset.dir = dir;
      const t = el("h4");
      t.textContent = dir === "in" ? this.labels.incoming : this.labels.outgoing;
      const ul = el("ul");
      for (const e of edges) {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        const target = this._model.nodes.find(x => x.id === other(e));
        b.append(txt("span", "rt", target?.title ?? other(e)));
        if (e.label) b.append(txt("span", "rw", e.label));
        b.addEventListener("click", () => this.select(other(e)));
        li.append(b);
        ul.append(li);
      }
      box.append(t, ul);
      kids.push(box);
    };
    const edges = this._model.edges;
    rel("in", edges.filter(e => e.to === id && e.from !== id), e => e.from);
    rel("out", edges.filter(e => e.from === id && e.to !== id), e => e.to);
    if (edges.some(e => e.from === id && e.to === id)) {
      const s = el("p", "p-sub");
      s.textContent = this.labels.selfLoop;
      kids.push(s);
    }
    this._panel.replaceChildren(...kids);
  }

  _summary(id) {
    const n = this._model.nodes.find(x => x.id === id);
    const ins = this._model.edges.filter(e => e.to === id && e.from !== id).length;
    const outs = this._model.edges.filter(e => e.from === id && e.to !== id).length;
    return `${n?.title ?? id}: ${ins} ${this.labels.incoming.toLowerCase()}, ${outs} ${this.labels.outgoing.toLowerCase()}`;
  }

  _announce(text) {
    this._status.textContent = text;
  }

  // -------------------------------------------------------------------------------------------
  // Measuring and painting the wires

  /** Measures the board and converts every box into flow coordinates. */
  _measure() {
    const L = this._layout;
    const B = this._board.getBoundingClientRect();
    const W = B.width, H = B.height;
    const dir = L.direction;
    const rel = r => ({ x1: r.left - B.left, x2: r.right - B.left, y1: r.top - B.top, y2: r.bottom - B.top });
    const toFlow = {
      right: r => ({ l: r.x1, r: r.x2, t: r.y1, b: r.y2 }),
      left: r => ({ l: W - r.x2, r: W - r.x1, t: r.y1, b: r.y2 }),
      down: r => ({ l: r.y1, r: r.y2, t: r.x1, b: r.x2 }),
      up: r => ({ l: H - r.y2, r: H - r.y1, t: r.x1, b: r.x2 }),
    }[dir];
    const fromFlow = {
      right: p => ({ x: p.u, y: p.v }),
      left: p => ({ x: W - p.u, y: p.v }),
      down: p => ({ x: p.v, y: p.u }),
      up: p => ({ x: p.v, y: H - p.u }),
    }[dir];
    const box = e => toFlow(rel(e.getBoundingClientRect()));
    const boxes = new Map();
    for (const [id, b] of this._els) if (b.isConnected) boxes.set(id, box(b));
    const corridors = {};
    for (const g of this._gutters) { const r = box(g); corridors["g" + g.dataset.k] = { a: r.l, b: r.r }; }
    const ch = name => { const e = this._board.querySelector(`.ch-${name}`); return e ? box(e) : null; };
    const ct = ch("ct"), cb = ch("cb"), ca = ch("ca"), cz = ch("cz");
    corridors.ct = { a: ct.t, b: ct.b };
    corridors.cb = { a: cb.t, b: cb.b };
    corridors.ca = ca ? { a: ca.t, b: ca.b } : { a: 0, b: 0 };
    corridors.cz = cz ? { a: cz.t, b: cz.b } : { a: 0, b: 0 };
    const col = new Map(L.flow.map((l, i) => [l.id, i]));
    const place = id => {
      const lane = L.laneOf.get(id);
      if (L.before && lane === L.before.id) return { kind: "top" };
      if (L.after && lane === L.after.id) return { kind: "bot" };
      return { kind: "col", col: col.get(lane) };
    };
    return { W, H, boxes, corridors, place, fromFlow };
  }

  _paint(animate) {
    if (this._destroyed) return;
    this._svg.replaceChildren();
    this._wires = [];
    if (!this._layout || this._selected === null || !this._flowMode()) return;
    const g = this._measure();
    this._svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    const edges = this._model.edges.filter(e => e.from !== e.to);
    const merged = mergeParallel(edges);
    const { wires } = route(this._selected, merged, g);
    const L = this._layout;
    const halos = svgEl("g"), lines = svgEl("g"), marks = svgEl("g");
    this._svg.append(halos, lines, marks);
    const motion = animate && !reducedMotion();

    const pts = wires.map(w => w.points.map(g.fromFlow));
    const lengths = pts.map(manhattan);
    const order = [...new Set(wires.map(w => w.h))];
    const top = h => Math.min(...wires.map((w, i) => (w.h === h ? Math.min(...pts[i].map(p => p.y)) : Infinity)));
    order.sort((a, b) => {
      const ka = wires.find(w => w.h === a).k, kb = wires.find(w => w.h === b).k;
      return (ka === kb ? 0 : ka === "in" ? -1 : 1) || top(a) - top(b);
    });
    const turn = new Map(order.map((h, j) => [h, j * BUNDLE_STAGGER]));

    wires.forEach((w, i) => {
      const p = pts[i];
      const back = w.ids.some(id => L.edgeClass.get(id) === "backward");
      const d = pathOf(p);
      const halo = svgEl("path", { d, class: "casing" + (motion ? " draw" : "") });
      const line = svgEl("path", { d, class: `wire ${w.k}${back ? " backward" : ""}${motion ? " draw" : ""}` });
      halos.append(halo);
      lines.append(line);
      const len = line.getTotalLength();
      const dur = Math.max(0.2, len / SPEED);
      const longest = Math.max(...wires.map((o, j) => (o.h === w.h ? lengths[j] : 0)));
      const start = turn.get(w.h) + (w.k === "in" ? (longest - lengths[i]) / SPEED : 0);
      const tip = p[p.length - 1], prev = lastDistinct(p);
      const ux = (tip.x - prev.x) / (Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1);
      const uy = (tip.y - prev.y) / (Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1);
      const bx = tip.x - ux * ROUTE.arrow, by = tip.y - uy * ROUTE.arrow;
      const arrow = svgEl("path", {
        class: `arrow ${w.k}${motion ? " draw" : ""}`,
        d: `M${f(tip.x)},${f(tip.y)} L${f(bx - uy * 4.2)},${f(by + ux * 4.2)} L${f(bx + uy * 4.2)},${f(by - ux * 4.2)}Z`,
      });
      const dot = svgEl("circle", { class: `dot ${w.k}${motion ? " draw" : ""}`, cx: f(p[0].x), cy: f(p[0].y), r: 3.2 });
      marks.append(dot, arrow);
      for (const e of [halo, line]) {
        e.style.setProperty("--len", f(len));
        e.style.setProperty("--t", `${dur.toFixed(3)}s`);
        e.style.setProperty("--d", `${start.toFixed(3)}s`);
      }
      dot.style.setProperty("--d", `${start.toFixed(3)}s`);
      arrow.style.setProperty("--d", `${(start + dur - 0.04).toFixed(3)}s`);
      this._wires.push({ ...w, screen: p });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Transitions: remove → move → add, then the wires trace again.

  _rects() {
    const out = new Map();
    for (const [id, b] of this._els) if (b.isConnected) out.set(id, b.getBoundingClientRect());
    return out;
  }

  _transition(first, diff, long) {
    this._svg.replaceChildren();
    const removed = diff ? diff.nodes.removed : [];
    // A renamed node keeps its element, so it is not "new" on screen.
    const added = new Set((diff ? diff.nodes.added : []).filter(id => !first.has(id)));
    const B = this._board.getBoundingClientRect();
    const anims = [];
    const moveDur = long ? 900 : STAGES.move;
    let t = 0;

    // Ghosts of removed nodes fade out where they were.
    if (removed.length) {
      for (const id of removed) {
        const r = first.get(id);
        if (!r) continue;
        const ghost = el("div", "node");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, { position: "absolute", left: `${r.left - B.left}px`, top: `${r.top - B.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: 3, margin: 0 });
        this._board.append(ghost);
        const a = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: STAGES.remove, easing: "ease-in", fill: "forwards" });
        a.finished.then(() => ghost.remove(), () => ghost.remove());
        anims.push(a);
      }
      t = STAGES.remove;
    }

    // Nodes that stay glide from where they were (FLIP).
    let moved = 0;
    for (const [id, b] of this._els) {
      if (added.has(id) || !first.has(id)) continue;
      const a = first.get(id), z = b.getBoundingClientRect();
      const dx = a.left - z.left, dy = a.top - z.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const delay = t + Math.min(moved * STAGES.stagger, STAGES.staggerCap);
      moved++;
      anims.push(b.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: moveDur, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" }));
    }
    if (moved) t += moveDur + Math.min(moved * STAGES.stagger, STAGES.staggerCap);

    // New nodes come in last.
    for (const id of added) {
      const b = this._els.get(id);
      if (!b) continue;
      anims.push(b.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
        { duration: STAGES.add, delay: t, easing: "ease-out", fill: "backwards" }));
    }
    if (added.size) t += STAGES.add;

    this._animations = anims;
    const done = () => { if (this._animations === anims) { this._animations = []; this._paint(this.options.animate); } };
    if (!anims.length) { this._paint(this.options.animate); return; }
    Promise.allSettled(anims.map(a => a.finished)).then(done);
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard: one tab stop; arrows move by the layout, Enter selects, Escape clears.

  _ensureTabStop() {
    const current = [...this._els.values()].find(b => b.tabIndex === 0);
    if (current && current.isConnected) return;
    const first = this._selected ?? this._ordered()[0];
    if (first !== undefined && this._els.has(first)) this._els.get(first).tabIndex = 0;
  }

  _setTabStop(id, focus) {
    for (const b of this._els.values()) b.tabIndex = -1;
    const b = this._els.get(id);
    b.tabIndex = 0;
    if (!focus) return;
    if (this.root.activeElement !== b) b.focus({ preventScroll: true });
    this._reveal(b);
  }

  /** Scrolls a node into view, sideways inside the board too, and above the detail drawer when the
   *  panel below the board covers the foot of the screen. */
  _reveal(b) {
    const drawer = this._wrap.dataset.panel === "below" && !this._panel.hidden;
    // The drawer is sticky 12px above the bottom; keep the node another 12px clear of it.
    b.style.scrollMarginBottom = drawer ? `${Math.ceil(this._panel.getBoundingClientRect().height) + 24}px` : "";
    b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: this.options.animate && !reducedMotion() ? "smooth" : "auto" });
  }

  _ordered() {
    const L = this._layout;
    if (!L) return [];
    const lanes = [L.before, ...L.flow, L.after].filter(Boolean);
    return lanes.flatMap(l => L.order.get(l.id));
  }

  _onKey(e) {
    const b = e.target.closest?.(".node");
    if (!b) return;
    const id = this._idOf.get(b);
    if (id === undefined) return;
    const L = this._layout;
    const lanes = [L.before, ...L.flow, L.after].filter(Boolean).map(l => L.order.get(l.id));
    const li = lanes.findIndex(ids => ids.includes(id));
    let next = null;
    const key = e.key;
    if (e.altKey && (key === "ArrowRight" || key === "ArrowDown")) next = this._model.edges.find(x => x.from === id && x.to !== id)?.to ?? null;
    else if (e.altKey && (key === "ArrowLeft" || key === "ArrowUp")) next = this._model.edges.find(x => x.to === id && x.from !== id)?.from ?? null;
    else if (key in ARROWS) next = this._nearest(id, ARROWS[key]);
    else if (key === "Home") next = lanes[li][0];
    else if (key === "End") next = lanes[li][lanes[li].length - 1];
    else if (key === "Escape") { this.select(null); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    if (next) { this._setTabStop(next, true); }
  }

  /** The node on screen nearest to `id` in direction [dx, dy], preferring the same row or column. */
  _nearest(id, [dx, dy]) {
    const a = this._els.get(id).getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const [other, b] of this._els) {
      if (other === id || !b.isConnected) continue;
      const r = b.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = x * dx + y * dy, aside = Math.abs(x * dy - y * dx);
      if (along < 1 || aside > along) continue;   // only within 45° of the arrow
      const s = along + 2 * aside;
      if (s < score) { score = s; best = other; }
    }
    return best;
  }
}

// -----------------------------------------------------------------------------------------------
// A batch collects edits on a working copy and commits them as one step.

class Batch {
  constructor(atlas, model) { this.atlas = atlas; this.model = model; this.warnings = []; }
  apply(ops) {
    const r = M.apply(this.model, ops);
    this.model = r.model;
    this.warnings = r.warnings;
    return this;
  }
  addNode(node, { index, edges = [] } = {}) {
    this.apply([{ op: "addNode", node }, ...edges.map(e => ({ op: "addEdge", edge: e }))]);
    // Positions are relative to the node's lane, which may be automatic: anchor on a neighbour.
    const L = computeLayout(this.model);
    const peers = L.order.get(L.laneOf.get(node.id)).filter(id => id !== node.id);
    // The best gap, or the allowed gap nearest the given index: never one that moves existing nodes.
    index = bestInsertion(this.model, node.id, index);
    if (!peers.length) return this;
    return this.apply(index < peers.length
      ? { op: "moveNode", id: node.id, before: peers[index] }
      : { op: "moveNode", id: node.id, after: peers[peers.length - 1] });
  }
  connect(from, to, opts = {}) { return this.apply({ op: "addEdge", edge: clean({ from, to, ...opts }) }); }
  removeNode(id) { return this.apply({ op: "removeNode", id }); }
  updateNode(id, changes) { return this.apply({ op: "updateNode", id, changes }); }
  moveNode(id, opts = {}) { return this.apply({ op: "moveNode", id, ...opts }); }
  disconnect(id) { return this.apply({ op: "removeEdge", id }); }
}

// -----------------------------------------------------------------------------------------------
// Helpers

/** A model whose node order follows a layout's lane order (the new sketch). */
function withOrder(model, L, keepPinned = false) {
  const m = M.clone(model);
  const pos = new Map();
  let k = 0;
  for (const lane of [L.before, ...L.flow, L.after].filter(Boolean)) for (const id of L.order.get(lane.id)) pos.set(id, k++);
  const original = new Map(m.nodes.map((n, i) => [n.id, i]));
  if (keepPinned) {
    // Pinned nodes keep their index inside their lane.
    const byLane = new Map();
    for (const n of model.nodes) {
      const lane = L.laneOf.get(n.id);
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(n.id);
    }
    for (const [lane, before] of byLane) {
      const after = L.order.get(lane).filter(id => !model.nodes.find(n => n.id === id)?.pinned);
      const merged = [];
      let j = 0;
      for (const id of before) merged.push(model.nodes.find(n => n.id === id)?.pinned ? id : after[j++]);
      const base = Math.min(...before.map(id => pos.get(id)));
      merged.forEach((id, i) => pos.set(id, base + i));
    }
  }
  m.nodes.sort((a, b) => (pos.get(a.id) ?? original.get(a.id)) - (pos.get(b.id) ?? original.get(b.id)));
  return m;
}

/** Parallel edges (same from and to) travel as one wire. */
function mergeParallel(edges) {
  const out = new Map();
  for (const e of edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (!out.has(key)) out.set(key, { id: e.id, from: e.from, to: e.to, ids: [] });
    out.get(key).ids.push(e.id);
  }
  return [...out.values()];
}

function pathOf(points) {
  const p = points.map(q => ({ ...q }));
  const n = p.length;
  const u = p[n - 1], v = lastDistinct(p);
  const len = Math.hypot(u.x - v.x, u.y - v.y) || 1;
  const cut = Math.min(ROUTE.arrow - 1, len - 1);
  p[n - 1] = { x: u.x - (u.x - v.x) / len * cut, y: u.y - (u.y - v.y) / len * cut };
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
    if (!l0 || !l1) continue;
    const r = Math.min(ROUTE.radius, l0 / 2, l1 / 2);
    const x0 = b.x - (b.x - a.x) / l0 * r, y0 = b.y - (b.y - a.y) / l0 * r;
    const x1 = b.x + (c.x - b.x) / l1 * r, y1 = b.y + (c.y - b.y) / l1 * r;
    d += ` L${f(x0)},${f(y0)} Q${f(b.x)},${f(b.y)} ${f(x1)},${f(y1)}`;
  }
  return d + ` L${f(p[n - 1].x)},${f(p[n - 1].y)}`;
}

function lastDistinct(p) {
  const tip = p[p.length - 1];
  for (let i = p.length - 2; i >= 0; i--) if (Math.hypot(tip.x - p[i].x, tip.y - p[i].y) > 0.5) return p[i];
  return p[0];
}

function manhattan(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
  return L;
}

function reverseTracks(tracks) {
  return [...tracks].reverse();
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** An element holding the board's own text: its direction follows the text, so an Arabic or Hebrew
 *  title reads and aligns right to left while the board's geometry stays left to right. */
function txt(tag, className, text) {
  const e = el(tag, className);
  e.dir = "auto";
  e.textContent = text;
  return e;
}

function cls(e, name) {
  e.classList.add(name);
  return e;
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function f(n) {
  return Number(n).toFixed(1);
}

export { M as model };
