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
import { layout as computeLayout, bestInsertion, inversions, withLayers } from "./layout.js";
import { route, demand, corridorSize, sideSize, ROUTE } from "./route.js";
import { STYLES } from "./styles.js";
import { MOTION, planMove, sameShape } from "./motion.js";

const NS = "http://www.w3.org/2000/svg";
const SPEED = 1150;          // px per second: every wire traces at the same speed
const BUNDLE_STAGGER = 0.09; // seconds between bundles
const MIN_GUTTER = 56;
const MIN_CHANNEL = 30;
const MIN_OUTER = 26;
const STACK_BELOW = 720;   // px of container under which lanes stack
const BAND_NODE_MIN = 96;  // px: narrowest a node of a band gets
const PANEL_GAP = 20;      // px between the board and a side panel (.atlas gap)
// Wires reshape with the nodes where the browser animates the `d` of a path (Chrome, Edge, Firefox);
// elsewhere they fade out and trace again once the nodes are in place.
const MORPH = typeof CSS !== "undefined" && CSS.supports?.("d", 'path("M0 0")') === true;
const STATUS = /^[a-z0-9_-]{1,32}$/;
const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const DEFAULT_LABELS = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  unassigned: "Unassigned",
  selfLoop: "Feeds back into itself",
  board: "Map",       // accessible name of the board when the board has no meta.title
  detail: "Detail",   // accessible name of the detail panel
  // Keyboard steps through the selected node's connections ({n}, {total}, {hub} are filled in).
  inStep: "Incoming {n} of {total} into {hub}",
  outStep: "Outgoing {n} of {total} from {hub}",
  noneIn: "{hub}: no incoming connections",
  noneOut: "{hub}: no outgoing connections",
  noneAll: "{hub}: no connections",
  cleared: "Selection cleared",
  // Marks (search results and other highlights).
  markStep: "{n} of {total}: {title}",
  marked: "Match {n} of {total}",
  keys: "Arrow keys move between nodes; Enter selects. Alt with Down or Up steps through the selected node's connections, Alt with Right or Left through its outgoing or incoming ones. Escape goes back to it, then clears the selection.",
};
let UID = 0;   // a prefix per map for the ids of its descriptions (unique in the page without a shadow root)

export class Atlas extends EventTarget {
  /**
   * @param host element to render into (a shadow root is attached unless `options.shadow` is false)
   * @param options.document board (object or JSON text)
   * @param options.selected id of the node selected at start (default: meta.selected)
   * @param options.panel "auto" | "side" | "below" | "sheet" | false — where the detail goes (auto: by the room)
   * @param options.labels texts of the interface (incoming, outgoing, unassigned, selfLoop)
   * @param options.renderNode (node, button, live) => void — custom node content
   * @param options.animate trace wires when selecting (default true)
   * @param options.shadow render into a shadow root (default true)
   * Options and labels set to undefined keep their defaults.
   */
  constructor(host, options = {}) {
    super();
    this.host = host;
    this.options = { panel: "auto", animate: true, shadow: true, historyLimit: 200, headingLevel: 2, ...clean(options) };
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
    this._animations = [];        // the current edit's motion (nodes, titles, boxes, wires)
    this._ghostAnims = [];        // removed nodes fading out (survive a new edit)
    this._cues = [];              // reduced motion: outlines and fades that mark a change
    this._wireEls = new Map();    // wire key → its drawn elements and path
    this._after = null;           // a selection made while nodes moved: paint it when they stop
    this._sheet = "peek";         // the detail as a sheet: folded to its head, or open
    this._marks = [];             // marked node ids, in reading order
    this._markAt = null;          // the current mark (nextMark), or null
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
  /** Nodes whose title, subtitle (the live one too) or details contain `text`, ignoring case and
   *  accents, in reading order. Blank text finds nothing. */
  find(text) {
    const q = fold(text).trim();
    if (!q) return [];
    const hit = n => [n.title, n.subtitle, this._live.get(n.id)?.subtitle, ...(Array.isArray(n.details) ? n.details : [])].some(s => typeof s === "string" && fold(s).includes(q));
    const rank = new Map(this._ordered().map((id, i) => [id, i]));
    return this._model.nodes.filter(hit).map(n => n.id).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }
  /** The marked nodes (see mark()), in reading order. */
  get marked() { return [...this._marks]; }
  /** The current mark (see nextMark()), or null. */
  get currentMark() { return this._markAt; }

  /**
   * Marks nodes, for example the results of a search (map.mark(map.find(text))) or of a filter:
   * they keep their look while every other node steps back, as around a selection. Unknown ids are
   * ignored; null or an empty list clears. Marks follow renames, leave with removed nodes and are
   * cleared by load(); they are not saved and not undoable, and never change the selection. Each
   * marked node is described to screen readers as "Match 2 of 5"; the count is the page's to say.
   */
  mark(ids) {
    if (this._destroyed) return;
    const want = new Set(ids == null ? [] : [...ids].filter(id => this._els.has(id)));
    const next = this._ordered().filter(id => want.has(id));
    if (next.join("\u0000") === this._marks.join("\u0000")) return;
    this._marks = next;
    this._markAt = null;
    this._highlight();
    // Not announced: the page's search box says how many it found (both would be heard).
    this._emit("mark", { ids: [...next], current: null });
  }

  /**
   * Moves to the next mark (step -1: the previous one), wrapping: it becomes the current mark,
   * scrolls into view (clear of the detail sheet) and takes the map's tab stop, and screen readers
   * hear "2 of 5: Triage". With { focus: true } it also takes focus (a search box keeps it by
   * default). Never changes the selection. Returns the id, or null without marks.
   */
  nextMark(step = 1, { focus = false } = {}) {
    if (this._destroyed || !this._marks.length) return null;
    const n = this._marks.length;
    const i = this._markAt === null ? (step >= 0 ? 0 : n - 1) : (((this._marks.indexOf(this._markAt) + Math.trunc(step)) % n) + n) % n;
    this._markAt = this._marks[i];
    this._highlight();
    this._setTabStop(this._markAt, focus, true);
    // With focus on the node its description says "Match 2 of 5"; otherwise (focus stays in a search
    // box) the live region says where the mark is.
    if (!focus) this._announce(fill(this.labels.markStep, { n: i + 1, total: n, title: this._title(this._markAt) }));
    this._emit("mark", { ids: [...this._marks], current: this._markAt });
    return this._markAt;
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
    if (this._destroyed) return this;
    const { model, warnings } = M.load(input);
    const tidy = optimize ?? model.meta.ordered !== true;
    // Without flow lanes the layers are saved with the board, the ones the order was tidied for:
    // later edits keep them wherever the edges allow.
    const L = computeLayout(model, { optimize: tidy });
    let m = withLayers(tidy ? withOrder(model, L) : model, L);
    m.meta.ordered = true;
    this._model = m;
    this._warnings = warnings;
    this._history = [];
    this._future = [];
    this._live.clear();
    this._sheet = "peek";
    this._marks = [];
    this._markAt = null;
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
    this._commit(before, model, warnings, renamesOf(ops));
    return this._rev;
  }

  /** Groups several edits into one undoable step: map.batch(m => { m.addNode(...); m.connect(...) }). */
  batch(fn) {
    const before = this._model;
    const proxy = new Batch(this, before);
    fn(proxy);
    if (proxy.model !== before) this._commit(before, proxy.model, proxy.warnings, proxy.renames);
    return this._rev;
  }

  /** Adds a node. Without an explicit index it goes to the gap with fewest crossings. */
  addNode(node, { index, edges = [] } = {}) {
    return this.batch(b => b.addNode(node, { index, edges }));
  }
  updateNode(id, changes) { return this.apply({ op: "updateNode", id, changes }); }
  moveNode(id, { lane, index } = {}) { return this.apply({ op: "moveNode", id, lane, index }); }
  removeNode(id) { return this.apply({ op: "removeNode", id }); }
  /** Changes an id. The node keeps its element on screen (and its live state, focus and selection),
   *  also when undo or redo renames it back. */
  renameNode(from, to) { return this.apply({ op: "renameNode", from, to }); }
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
  updateGroup(id, changes) { return this.apply({ op: "updateGroup", id, changes }); }
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
    if (this._destroyed) return { swaps: 0, layers: 0 };
    const now = this._layout ?? computeLayout(this._model);
    // Without flow lanes the layers are computed afresh too, from the edges alone (pinned nodes keep
    // theirs where the edges allow): the reset for the drift that many edits leave. Only Atlas's own
    // whole-number layers are dropped for that; other values in the field are the board's data.
    const free = { ...this._model, nodes: this._model.nodes.map(n => { if (n.pinned || !Number.isSafeInteger(n.layer)) return n; const { layer: _, ...rest } = n; return rest; }) };
    const tidied = computeLayout(free, { optimize: true });
    let m = withLayers(withOrder(free, tidied, true), tidied);
    // Groups and constraints apply again when the result is drawn. A lane where that would move a
    // pinned node keeps its current order: pinned nodes never move inside a lane that keeps its
    // nodes (a lane of computed layers that gains or loses nodes is laid out anew).
    const drawn = computeLayout(m);
    const pinned = new Set(this._model.nodes.filter(n => n.pinned).map(n => n.id));
    const sameNodes = (a, b) => !!a && !!b && a.length === b.length && a.every(x => b.includes(x));
    const kept = [...drawn.order].filter(([lane, ids]) => sameNodes(ids, now.order.get(lane)) && ids.some((id, i) => pinned.has(id) && now.order.get(lane)[i] !== id)).map(([lane]) => lane);
    if (kept.length) m = withOrder(m, { ...drawn, order: new Map([...drawn.order].map(([lane, ids]) => [lane, kept.includes(lane) ? now.order.get(lane) : ids])) });
    // Counted on the result, after pinned nodes went back to their places: pairs of nodes that swap
    // inside a lane, and pairs of nodes whose columns change order (a new column alone moves none).
    const after = computeLayout(m);
    const swaps = inversions(now, after);
    const ids = [...now.layers.keys()].filter(id => after.layers.has(id));
    let layers = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = Math.sign(now.layers.get(ids[i]) - now.layers.get(ids[j])), b = Math.sign(after.layers.get(ids[i]) - after.layers.get(ids[j]));
      if (a !== b) layers++;
    }
    if (dryRun || (swaps === 0 && layers === 0)) return { swaps, layers };
    this._commit(this._model, m, this._warnings);
    return { swaps, layers };
  }

  // History steps are { model, renames }: the board before the step and the renames the step made,
  // so undo and redo rename back and forth exactly.
  undo() {
    if (this._destroyed) return false;
    const prev = this._history.pop();
    if (!prev) return false;
    this._future.push({ model: this._model, renames: prev.renames });
    this._swap(prev.model, prev.renames.map(([from, to]) => [to, from]).reverse());
    return true;
  }
  redo() {
    if (this._destroyed) return false;
    const next = this._future.pop();
    if (!next) return false;
    this._history.push({ model: this._model, renames: next.renames });
    this._swap(next.model, next.renames);
    return true;
  }
  /** Forgets every undo and redo step (for example once the board is saved). */
  clearHistory() { this._history = []; this._future = []; }
  get canUndo() { return this._history.length > 0; }
  get canRedo() { return this._future.length > 0; }

  /** Live content (for example from a home automation system): never moves anything. */
  setState(id, { subtitle, status } = {}) {
    if (this._destroyed || !this._els.has(id)) return;
    const s = { ...(this._live.get(id) ?? {}) };
    if (subtitle !== undefined) s.subtitle = subtitle === null ? undefined : String(subtitle);
    if (status !== undefined) s.status = status !== null && STATUS.test(String(status)) ? String(status) : undefined;
    this._live.set(id, s);
    this._fillNode(this._model.nodes.find(n => n.id === id), this._els.get(id));
  }

  /** Selects a node (or null), shows its wires and its detail. */
  select(id, { focus = true, animate = this.options.animate, reveal = focus, announce = false } = {}) {
    this._select(id, { focus, animate, reveal }, announce);
  }

  _select(id, { focus = true, animate = this.options.animate, reveal = focus } = {}, announce = true) {
    if (this._destroyed) return;
    if (id !== null && !this._els.has(id)) id = null;
    const prev = this._selected;
    if (id !== prev) this._ring = null;   // keyboard steps belong to one selection
    this._selected = id;
    this._highlight();
    this._fillPanel();
    this._placePanel();
    // While nodes move, wires measured now would start from boxes in flight: they are drawn once
    // the nodes are in place.
    if (this._moving()) this._after = { animate };
    else this._paint(animate);
    if (id !== null) this._setTabStop(id, focus, reveal);
    if (prev !== id) this._emit("select", { id });
    if (announce) this._announce(id === null ? "" : this._summary(id));
  }

  /** Finishes any running transition at once (its end state) and redraws the wires. */
  settle() {
    if (this._destroyed) return;
    const running = [...this._animations, ...this._ghostAnims, ...this._cues];
    this._animations = [];        // a transition's end callback sees it is no longer current
    this._ghostAnims = [];
    this._cues = [];
    this._after = null;
    running.forEach(a => a.finish());
    this._ghosts.replaceChildren();
    this._paint(false);
    const late = this._revealAfter;
    this._revealAfter = null;
    if (late?.isConnected) this._reveal(late, true);   // settled now: no smooth scroll still to come
  }

  /** Frees the map: observers, frames and animations stop and the content is removed. Final: a
   *  destroyed instance draws nothing more; create a new one to show a board again. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._ro?.disconnect();
    removeEventListener("resize", this._onResize);
    cancelAnimationFrame(this._frame);
    clearTimeout(this._saying);
    const running = [...this._animations, ...this._ghostAnims, ...this._cues];
    this._animations = [];          // a transition's end callback sees it is no longer current
    this._ghostAnims = [];
    this._cues = [];
    running.forEach(a => a.cancel());
    this.root.replaceChildren();
  }
  get destroyed() { return this._destroyed === true; }

  // -------------------------------------------------------------------------------------------
  // Internals: commit, history

  _commit(before, after, warnings, renames = []) {
    if (this._destroyed) return;
    after = withLayers(after, computeLayout(after));
    // An edit that changes nothing (same title, empty list of operations) makes no undo step.
    if (after === before || JSON.stringify(M.serialize(after)) === JSON.stringify(M.serialize(before))) return;
    this._history.push({ model: before, renames });
    while (this._history.length > this.options.historyLimit) this._history.shift();
    this._future = [];
    this._model = after;
    this._warnings = warnings ?? [];
    this._rev++;
    const d = M.diff(before, after);
    const followed = this._follow(renames);
    this._render({ animate: true, diff: d });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
    if (followed) this._emit("select", { id: this._selected });
  }

  _swap(model, renames) {
    const before = this._model;
    this._model = model;
    this._warnings = M.validate(model).warnings;
    this._rev++;
    const d = M.diff(before, model);
    const followed = this._follow(renames);
    this._render({ animate: true, diff: d });
    this._emit("change", { rev: this._rev, diff: d, warnings: this.warnings });
    if (followed) this._emit("select", { id: this._selected });
  }

  /** A node renamed by an edit, a batch, undo or redo keeps its element on screen (with its live
   *  state, its focus, its marks and its place), and the selection follows it. `renames` are the
   *  step's renameNode operations, in order. Returns whether the selection moved. */
  _follow(renames = []) {
    const swapKey = (map, a, b) => { if (map.has(a)) { map.set(b, map.get(a)); map.delete(a); } };
    let followed = false;
    for (const [from, to] of renames) {
      if (!this._els.has(from) || this._els.has(to)) continue;
      swapKey(this._els, from, to);
      swapKey(this._items, from, to);
      swapKey(this._live, from, to);
      this._idOf.set(this._els.get(to), to);
      this._marks = this._marks.map(x => (x === from ? to : x));
      if (this._markAt === from) this._markAt = to;
      if (this._selected === from) { this._selected = to; followed = true; }
    }
    return followed;
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
    this._board.setAttribute("role", "region");
    this._svg = document.createElementNS(NS, "svg");
    this._svg.setAttribute("class", "wires");
    this._svg.setAttribute("aria-hidden", "true");
    // Three layers: halos under every wire, wires, then the dots and arrowheads on top.
    this._halos = svgEl("g");
    this._lines = svgEl("g");
    this._tips = svgEl("g");
    this._svg.append(this._halos, this._lines, this._tips);
    this._ghosts = el("div", "ghosts");   // removed nodes fading out, kept across rebuilds
    this._ghosts.setAttribute("aria-hidden", "true");
    this._panel = el("aside", "panel");
    this._panel.setAttribute("part", "panel");
    this._status = el("div", "status");
    this._status.setAttribute("role", "status");
    this._status.setAttribute("aria-atomic", "true");
    this._boardWrap.append(this._board);
    this._wrap.append(this._boardWrap, this._panel, this._status);
    this.root.replaceChildren(style, this._wrap);
    this._board.addEventListener("keydown", e => this._onKey(e));
    // Escape in the open sheet folds it and goes back to the selected node.
    this._panel.addEventListener("keydown", e => {
      if (e.key !== "Escape" || this._wrap.dataset.panel !== "sheet" || this._sheet !== "open") return;
      e.preventDefault();
      e.stopPropagation();   // used here: a dialog around the map stays open
      this.openDetail(false);
      if (this._selected !== null) this._setTabStop(this._selected, true);
    });
    // Alt with Left or Right is Back or Forward in Chrome and Edge on Windows and Linux: inside the
    // map it never leaves the page.
    this._wrap.addEventListener("keydown", e => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) e.preventDefault(); });
    // Descriptions read with the focused node (its relation to the selection) and with the board
    // (the keys), from hidden text.
    this._uid = `atlas${++UID}`;
    this._descs = el("div", "descs");
    this._descs.hidden = true;
    this._keysHint = el("span");
    this._keysHint.id = `${this._uid}-keys`;
    this._descs.append(this._keysHint);
    this._wrap.append(this._descs);
    this._board.setAttribute("aria-describedby", this._keysHint.id);
    this._ro = new ResizeObserver(() => this._schedule());
    this._ro.observe(this._board);
    this._ro.observe(this.host);
    // The window's height decides between a detail below the board and a sheet: a change of height
    // alone resizes neither observed box.
    this._onResize = () => this._schedule();
    addEventListener("resize", this._onResize);
  }

  _schedule() {
    if (this._destroyed) return;
    cancelAnimationFrame(this._frame);
    this._frame = requestAnimationFrame(() => {
      this._applyMode();
      this._refreshRows();
      this._placePanel();
      // Wires are drawn again only when the board's geometry changed, not when the page around it
      // did (the detail panel opening below it resizes the host): that would cut a wire being traced.
      if (!this._moving() && this._geometryKey() !== this._painted) this._paint(false);
    });
  }

  /** True while nodes move after an edit. */
  _moving() {
    return this._animations.some(a => a.playState === "running" || a.playState === "pending");
  }

  /** What the drawn wires depend on: the selection, the arrangement, the board's size, the board. */
  _geometryKey(W, H) {
    if (this._selected === null || !this._flowMode()) return `none|${this._wrap.dataset.mode}`;
    if (W === undefined) ({ width: W, height: H } = this._board.getBoundingClientRect());
    return `${this._selected}|${Math.round(W)}x${Math.round(H)}|${this._rev}`;
  }

  // -------------------------------------------------------------------------------------------
  // DOM: render the layout

  _render({ animate = false, diff = null } = {}) {
    if (this._destroyed) return;
    this._board.setAttribute("aria-label", this._model.meta.title || this.labels.board);
    this._keysHint.textContent = this.labels.keys;
    this._panel.setAttribute("aria-label", this.labels.detail);
    // The selection follows the board: a node that is gone (removed, renamed by undo, another board
    // loaded) is no longer selected, and listeners hear it.
    const lost = this._selected !== null && !this._model.nodes.some(n => n.id === this._selected);
    if (lost) { this._selected = null; this._ring = null; }
    // Marks leave with their nodes, and keep reading order.
    const present = new Set(this._model.nodes.map(n => n.id));
    if (this._marks.some(x => !present.has(x))) this._marks = this._marks.filter(x => present.has(x));
    if (this._markAt !== null && !present.has(this._markAt)) this._markAt = null;
    const active = this._active();
    const hadFocus = active !== null && this._board.contains(active);
    // Motion: none with animate: false; under reduced motion only cues that do not travel.
    const mode = !animate || !this.options.animate ? "off" : reducedMotion() ? "reduce" : "full";
    // Where everything is on screen, read before anything is written (and before running motion is
    // stopped: a node in flight starts its next move from where it is seen, not from where it was going).
    const first = mode === "off" ? null : this._snapshot();
    this._stopMotion(mode === "off");

    const L = computeLayout(this._model);
    this._layout = L;
    const geo = this._abstractGeometry(L);
    const need = demand(this._model.nodes.map(n => n.id), this._model.edges, geo.place, geo.pos, { ct: 0, cb: 1 });
    this._need = need;
    this._build(L, need);
    this._minWidth = this._intrinsicWidth();
    this._rowsWidth = this._board.getBoundingClientRect().width;   // the width its rows were sized at
    this._applyMode();
    this._refreshRows();
    this._highlight();
    this._fillPanel();
    this._placePanel();
    // Focus was on a node that is gone: keep it in the map, on the node that holds the tab stop.
    if (hadFocus && !this._board.contains(this._active())) {
      this._ensureTabStop();
      [...this._els.values()].find(b => b.tabIndex === 0)?.focus({ preventScroll: true });
    }
    if (lost) { this._emit("select", { id: null }); this._announce(""); }

    if (first) this._transition(first, diff, mode);
    else this._paint(false);
  }

  /** A heading tag `depth` levels below `headingLevel` (lane titles and the detail's title are at it,
   *  the detail's "Incoming" and "Outgoing" one below), so the map fits the page's outline. */
  _heading(depth) {
    const level = Math.min(6, Math.max(1, Math.round(Number(this.options.headingLevel) || 2) + depth));
    return `h${level}`;
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
    if (!this.options.animate) this._wrap.dataset.motion = "off"; else delete this._wrap.dataset.motion;
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
      const title = txt(this._heading(0), "lane-title", band.title ?? "");
      title.dataset.key = `lane:${band.id}`;   // titles and group boxes glide with their nodes
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
    this._flowEl = flow;
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
      flow.style.rowGap = "10px";
    }
    // Group legends take grid tracks of their own, so a legend never sits on a node or a lane title.
    // Across the flow (right, left) the rows are shared by every lane: a slot where titled groups
    // start gets one legend row per group starting there, outer groups first. Down or up, each lane
    // gets legend rows above its nodes, one per level of nesting.
    const spansOf = new Map(L.flow.map(l => [l.id, L.groups.filter(s => s.lane === l.id).sort((a, b) => a.from - b.from || a.depth - b.depth)]));
    const legendAt = new Map();   // span → its legend row (flow right, left: a flow row; down, up: a row of the lane's list)
    const slotRow = [];
    if (!vertical) {
      const starting = new Map();
      for (const spans of spansOf.values()) {
        const here = new Map();
        for (const s of spans) if (s.title) { const k = here.get(s.from) ?? 0; legendAt.set(s, k); here.set(s.from, k + 1); }
        for (const [slot, n] of here) starting.set(slot, Math.max(starting.get(slot) ?? 0, n));
      }
      // Rows of each lane's list, a subgrid of the flow's rows after the lane titles' row.
      let line = 1;
      for (let s = 0; s < rows; s++) {
        for (const [span, k] of legendAt) if (span.from === s) legendAt.set(span, line + k);
        line += starting.get(s) ?? 0;
        slotRow[s] = line++;
      }
      flow.style.gridTemplateRows = `auto repeat(${line - 1}, auto)`;
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
      const title = txt(this._heading(0), "lane-title", lane.id === M.UNASSIGNED ? this.labels.unassigned : (lane.title ?? ""));
      title.dataset.key = `lane:${lane.id}`;
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
      const spans = spansOf.get(lane.id);
      let levels = 0;
      if (vertical) {
        // Nested legends go one row lower than the legends of the groups around them.
        for (const s of spans.filter(x => x.title).sort((a, b) => a.depth - b.depth || a.from - b.from)) {
          let r = 0;
          for (const [o, row] of legendAt) if (spans.includes(o) && o.from <= s.to && s.from <= o.to) r = Math.max(r, row);
          legendAt.set(s, r + 1);
          levels = Math.max(levels, r + 1);
        }
        // The lane's rows are its legend rows and its node row; the title lines up with the nodes.
        sec.style.gridTemplateRows = `repeat(${levels + 1}, auto)`;
        sec.style.rowGap = "10px";
        list.style.gridRow = "1 / -1";
        list.style.gridTemplateRows = "subgrid";
        title.style.gridRow = `${levels + 1}`;
      }
      const nodeRow = levels + 1;
      for (const id of L.order.get(lane.id)) {
        const li = this._item(id);
        const slot = L.slots.get(id);
        // Both tracks explicit: a group box takes the lane's cross track over its span, and an item with
        // only its slot set was auto-placed past the box, into an extra column (or row).
        li.style.gridRow = vertical ? `${nodeRow}` : `${slotRow[slot]}`;
        li.style.gridColumn = vertical ? `${slot + 1}` : "1";
        list.append(li);
      }
      // Group boxes, drawn behind the nodes of their slot span, from their legend's row when titled.
      // Boxes and legends are list items (an <ol> holds only <li>s) hidden from assistive technology.
      const deco = [];
      for (const span of spans) {
        const box = el("li", "group-box");
        box.setAttribute("aria-hidden", "true");
        box.dataset.group = span.group;
        box.dataset.key = `box:${span.group}|${span.lane}`;
        const inset = -6 + 4 * Math.min(span.depth, 3);   // nested boxes sit inside their parents
        const top = span.title ? legendAt.get(span) : null;
        // A titled box starts half a legend down, so its top edge runs through the legend.
        box.style.margin = `${top !== null ? 8 : inset}px ${inset}px ${inset}px`;
        if (vertical) { box.style.gridColumn = `${span.from + 1} / ${span.to + 2}`; box.style.gridRow = `${top ?? nodeRow} / ${nodeRow + 1}`; }
        else { box.style.gridRow = `${top ?? slotRow[span.from]} / ${slotRow[span.to] + 1}`; box.style.gridColumn = "1"; }
        deco.push(box);
        if (top === null) continue;
        const legend = el("li", "group-legend");
        legend.setAttribute("aria-hidden", "true");
        legend.dataset.group = span.group;
        legend.dataset.key = `legend:${span.group}|${span.lane}`;
        legend.append(txt("span", "", span.title));
        legend.style.marginInlineStart = `${inset + 10}px`;
        if (vertical) { legend.style.gridColumn = `${span.from + 1} / ${span.to + 2}`; legend.style.gridRow = `${top}`; }
        else { legend.style.gridRow = `${top}`; legend.style.gridColumn = "1"; }
        deco.push(legend);
      }
      list.prepend(...deco);
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
    board.replaceChildren(this._svg, this._ghosts, ...parts);

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
      // Activating the selected node again opens the detail when it is a folded sheet.
      b.addEventListener("click", () => {
        const id = this._idOf.get(b);
        if (id === this._selected && this._wrap.dataset.panel === "sheet" && this._sheet !== "open") this.openDetail(true);
        else this._select(id, {}, true);   // a person selected it: screen readers hear the summary
      });
      li.append(b);
      this._items.set(id, li);
      this._els.set(id, b);
    }
    return li;
  }

  /** A node's own CSS parts: node, node-<type>, status-<status>. */
  _partOf(n) {
    const live = this._live.get(n.id) ?? {};
    const type = typeof n.type === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(n.type) ? n.type : null;
    return ["node", type && `node-${type}`, live.status && `status-${live.status}`].filter(Boolean).join(" ");
  }

  /** The parts of the map's state on a node (selected, marked, marked-current), toggled one by one
   *  so the parts a renderNode added stay. */
  _stateParts(id, b) {
    b.part.toggle("selected", id === this._selected);
    b.part.toggle("marked", this._marks.includes(id));
    b.part.toggle("marked-current", id === this._markAt);
  }

  _fillNode(n, b) {
    if (!n || !b) return;
    const live = this._live.get(n.id) ?? {};
    b.setAttribute("part", this._partOf(n));
    this._stateParts(n.id, b);
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
    // A margin against flapping: a page scroll bar that comes and goes (17 px on Windows) must not
    // swap the arrangement back and forth.
    const was = this._wrap.dataset;
    const mode = width >= Math.min(needed, STACK_BELOW) - (was.mode === "flow" ? 16 : 0) ? "flow" : "stack";
    const asked = this.options.panel;
    let panel = asked === false ? "none" : mode === "stack" ? "inline"
      : ["side", "below", "sheet"].includes(asked) ? asked
      : width >= needed + side - (was.panel === "side" ? 16 : 0) ? "side" : "below";
    const before = `${was.mode}|${was.panel}`;
    if (this._wrap.dataset.mode !== mode) this._wrap.dataset.mode = mode;
    if (panel === "below" && asked !== "below") {
      // Under the board, in the page, when the board and the open detail fit the window together;
      // otherwise a sheet kept at the foot of the window, folded to its head until it is opened.
      const vh = innerHeight || 800;
      const open = Math.min(Math.max(0.42 * vh, 280), vh - 120);
      const slack = was.panel === "sheet" ? 24 : 0;
      if (this._board.getBoundingClientRect().height + PANEL_GAP + open > vh - 24 - slack) panel = "sheet";
    }
    if (this._wrap.dataset.panel !== panel) this._wrap.dataset.panel = panel;
    if (`${mode}|${panel}` !== before) {
      if (before !== "undefined|undefined") this._fillPanel();   // a sheet's head is a toggle
      this._emit("arrange", this.arrangement);
    }
  }

  /** WebKit (Safari) keeps the rows of a grid of subgrids at their old heights when the board gets
   *  narrower or wider (the side panel appearing, a window resize): the text wraps anew, the rows do
   *  not follow, and nodes spill into the next row. Laying the flow out once as a block, then as a
   *  grid again, sizes its rows anew; nothing is hidden, so focus and animations stay. Only when the
   *  board's width changed. */
  _refreshRows() {
    const flow = this._flowEl;
    if (!flow || !this._flowMode()) return;
    const w = this._board.getBoundingClientRect().width;
    if (Math.abs(w - (this._rowsWidth ?? w)) < 0.5) return;
    this._rowsWidth = w;
    flow.style.display = "block";
    void flow.offsetHeight;
    flow.style.display = "";
  }

  /** Narrowest the board can be laid out side by side, measured once per build: it depends on the
   *  corridors and the lanes, not on the container. */
  _intrinsicWidth() {
    // Measured on a hidden copy, never on the board itself: setting the live board to min-content
    // and back left WebKit (Safari) with rows sized for the narrow layout, taller than their content,
    // until something forced a full layout.
    const shell = this._wrap.cloneNode(false);
    shell.dataset.mode = "flow";
    shell.removeAttribute("data-panel");
    shell.setAttribute("aria-hidden", "true");
    shell.style.cssText = "position:absolute;top:0;left:-100000px;visibility:hidden;pointer-events:none;contain:layout style";
    const probe = this._board.cloneNode(true);
    probe.removeAttribute("role");
    probe.style.width = "min-content";
    const wrap = this._boardWrap.cloneNode(false);
    wrap.append(probe);
    shell.append(wrap);
    this.root.append(shell);
    const w = Math.ceil(probe.getBoundingClientRect().width);
    shell.remove();
    return w;
  }

  _placePanel() {
    if (this._wrap.dataset.panel === "sheet") this._panel.dataset.sheet = this._sheet;
    else delete this._panel.dataset.sheet;
    const inline = this._wrap.dataset.panel === "inline";
    // Inline, the detail goes inside the selected node's <li>: an <ol> holds only <li>s. The class
    // lets that item take a whole row of a two-column band (no :has(), for Firefox before 121).
    this._detailItem?.classList.remove("with-detail");
    this._detailItem = null;
    if (inline && this._selected && this._items.has(this._selected)) {
      this._detailItem = this._items.get(this._selected);
      this._detailItem.append(this._panel);
      this._detailItem.classList.add("with-detail");
    }
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
    const marks = new Set(this._marks);
    for (const [nid, b] of this._els) {
      b.classList.toggle("on", nid === id);
      b.classList.toggle("near-out", outs.has(nid));
      b.classList.toggle("near-in", ins.has(nid));
      b.classList.toggle("marked", marks.has(nid));
      b.classList.toggle("marked-current", nid === this._markAt);
      this._stateParts(nid, b);
      // The selection is the current node of the map, not a toggle (aria-pressed read "toggle button,
      // not pressed" on every node).
      if (nid === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    }
    this._board.classList.toggle("has-selection", id !== null);
    this._board.classList.toggle("has-marks", marks.size > 0);
    this._describe();
  }

  /** The selected node's neighbours, each once, in reading order: { in, out, all, self }. */
  _star(hub) {
    const rank = new Map(this._ordered().map((id, i) => [id, i]));
    const group = dir => {
      const by = new Map();
      for (const e of this._model.edges) {
        if (e.from === e.to) continue;
        const other = dir === "out" ? (e.from === hub ? e.to : null) : (e.to === hub ? e.from : null);
        if (other === null) continue;
        if (!by.has(other)) by.set(other, { id: other, dir, edges: [] });
        by.get(other).edges.push(e);
      }
      return [...by.values()].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    };
    const ins = group("in"), outs = group("out");
    return { in: ins, out: outs, all: [...ins, ...outs], self: this._model.edges.some(e => e.from === hub && e.to === hub) };
  }

  _title(id) { return this._model.nodes.find(n => n.id === id)?.title ?? id; }

  /** Each neighbour of the selection is described by its relation to it ("Incoming 3 of 5 into
   *  Triage: silences"), read when keyboard focus reaches it; the selection by its summary. */
  _describe() {
    const texts = new Map();
    const hub = this._selected;
    if (hub !== null && this._els.has(hub)) {
      const s = this._star(hub), name = this._title(hub);
      const say = (x, i, list, template) => {
        const what = x.edges.flatMap(e => [e.label, e.details]).filter(t => typeof t === "string" && t).join(", ");
        const t = fill(template, { n: i + 1, total: list.length, hub: name }) + (what ? `: ${what}` : "");
        texts.set(x.id, texts.has(x.id) ? `${texts.get(x.id)}; ${t}` : t);
      };
      s.in.forEach((x, i) => say(x, i, s.in, this.labels.inStep));
      s.out.forEach((x, i) => say(x, i, s.out, this.labels.outStep));
      texts.set(hub, this._summary(hub));
    }
    this._marks.forEach((id, i) => {
      const t = fill(this.labels.marked, { n: i + 1, total: this._marks.length });
      texts.set(id, texts.has(id) ? `${texts.get(id)}; ${t}` : t);
    });
    const spans = [this._keysHint];
    let k = 0;
    for (const [id, b] of this._els) {
      const t = texts.get(id);
      if (!t) { b.removeAttribute("aria-describedby"); continue; }
      const span = el("span");
      span.id = `${this._uid}-d${k++}`;
      span.textContent = t;
      spans.push(span);
      b.setAttribute("aria-describedby", span.id);
    }
    this._descs.replaceChildren(...spans);
  }

  /** The next connection of the selection in `group` ("all", "in", "out"), from the focused node.
   *  A node reached some other way first becomes the selection. Null when there is none. */
  _step(focused, group, delta) {
    const r = this._ring;
    if (!(r && r.hub === this._selected && (focused === r.hub || focused === r.at?.id))) {
      if (this._selected !== focused) this._select(focused, { focus: false }, false);
      this._ring = { hub: focused, at: null };
    }
    const { hub, at } = this._ring;
    const list = this._star(hub)[group];
    if (!list.length) {
      this._announce(fill(this.labels[{ in: "noneIn", out: "noneOut", all: "noneAll" }[group]], { hub: this._title(hub) }));
      return null;
    }
    const i = at?.id === focused ? list.findIndex(x => x.id === at.id && x.dir === at.dir) : -1;
    const j = i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
    this._ring.at = list[j];
    return list[j].id;
  }

  _fillPanel() {
    const id = this._selected;
    if (id === null) { this._panel.replaceChildren(); return; }
    const n = this._model.nodes.find(x => x.id === id);
    const L = this._layout;
    const laneId = L.laneOf.get(id);
    const lane = [L.before, ...L.flow, L.after].find(l => l && l.id === laneId);
    const laneTitle = laneId === M.UNASSIGNED ? this.labels.unassigned : (lane?.title ?? "");   // automatic lanes have none
    const sub = this._live.get(id)?.subtitle ?? n.subtitle;
    const body = el("div", "p-body");
    body.id = `${this._uid}-body`;
    if (Array.isArray(n.details) && n.details.length) {
      const ul = el("ul", "p-details");
      for (const d of n.details) ul.append(txt("li", "", d));
      body.append(ul);
    }
    const rel = (dir, edges, other) => {
      if (!edges.length) return;
      const box = el("div", "rel");
      box.dataset.dir = dir;
      const t = el(this._heading(1), "r-title");
      t.textContent = dir === "in" ? this.labels.incoming : this.labels.outgoing;
      // One button per other node (parallel edges join their labels), as the summary counts them
      // and the keyboard steps through them.
      const ul = el("ul");
      const byNode = new Map();
      for (const e of edges) { if (!byNode.has(other(e))) byNode.set(other(e), []); byNode.get(other(e)).push(e); }
      for (const [o, es] of byNode) {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        const target = this._model.nodes.find(x => x.id === o);
        b.append(txt("span", "rt", target?.title ?? o));
        const labels = es.map(e => e.label).filter(Boolean), details = es.map(e => e.details).filter(Boolean);
        if (labels.length) b.append(txt("span", "rw", labels.join(" · ")));
        if (details.length) b.append(txt("span", "rd", details.join(" · ")));
        b.addEventListener("click", () => this._select(o, {}, true));
        li.append(b);
        ul.append(li);
      }
      box.append(t, ul);
      body.append(box);
    };
    // In reading order of the other node, the order of the keyboard's steps.
    const rank = new Map(this._ordered().map((x, i) => [x, i]));
    const byOther = other => (a, b) => (rank.get(other(a)) ?? 0) - (rank.get(other(b)) ?? 0);
    const edges = this._model.edges;
    const ins = edges.filter(e => e.to === id && e.from !== id).sort(byOther(e => e.from));
    const outs = edges.filter(e => e.from === id && e.to !== id).sort(byOther(e => e.to));
    rel("in", ins, e => e.from);
    rel("out", outs, e => e.to);
    if (edges.some(e => e.from === id && e.to === id)) body.append(txt("p", "p-sub p-self", this.labels.selfLoop));
    const head = [];
    if (this._wrap.dataset.panel === "sheet") {
      // A sheet at the foot of the window: its head is a button that folds and unfolds the rest,
      // inside the heading (the disclosure pattern of an accordion).
      const open = this._sheet === "open";
      const h = el(this._heading(0), "p-title");
      const toggle = el("button", "p-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-controls", body.id);
      if (laneTitle) toggle.append(txt("span", "p-lane", laneTitle));
      toggle.append(txt("span", "p-name", n.title ?? n.id));
      if (sub) toggle.append(txt("span", "p-sub", sub));
      const counts = el("span", "p-counts");
      for (const [dir, list, label] of [["in", ins, this.labels.incoming], ["out", outs, this.labels.outgoing]]) {
        const c = txt("span", "", `${label}: ${new Set(list.map(e => (dir === "in" ? e.from : e.to))).size}`);
        c.dataset.dir = dir;
        counts.append(c);
      }
      const chev = document.createElementNS(NS, "svg");
      chev.setAttribute("class", "p-chev");
      chev.setAttribute("viewBox", "0 0 16 16");
      chev.setAttribute("aria-hidden", "true");
      chev.append(svgEl("path", { d: "M4 10l4-4 4 4" }));
      toggle.append(counts, chev);
      toggle.addEventListener("click", () => this.openDetail(this._sheet !== "open"));
      h.append(toggle);
      head.push(h);
    } else {
      if (laneTitle) head.push(txt("p", "p-lane", laneTitle));
      head.push(txt(this._heading(0), "p-title", n.title ?? n.id));
      if (sub) head.push(txt("p", "p-sub", sub));
    }
    this._panel.replaceChildren(...head, body);
  }

  /**
   * Opens (or, with false, folds) the detail when it is a sheet at the foot of the window, and keeps
   * the selected node in view above it. Returns "open" or "peek"; the state holds from one selection
   * to the next, and in the other arrangements it waits for a sheet.
   */
  openDetail(open = true) {
    if (this._destroyed) return this._sheet;
    const want = open ? "open" : "peek";
    if (want === this._sheet) return want;
    this._sheet = want;
    if (this._wrap.dataset.panel === "sheet") {
      this._fillPanel();
      this._placePanel();
      if (open && this._selected !== null) this._reveal(this._els.get(this._selected));
      this._emit("arrange", this.arrangement);
    }
    return want;
  }

  /** How the map is laid out now: the board side by side ("flow"), scrolling sideways ("scroll") or
   *  stacked ("stack"); the detail at the side, below, as a sheet at the foot of the window, inline
   *  under the node, or none; and the sheet's state. */
  get arrangement() {
    const d = this._wrap.dataset;
    const board = d.mode === "stack" ? "stack" : this._boardWrap.scrollWidth > this._boardWrap.clientWidth + 1 ? "scroll" : "flow";
    return { board, panel: d.panel ?? "none", sheet: d.panel === "sheet" ? this._sheet : null };
  }

  /** "Triage: 5 incoming, 2 outgoing" (other nodes, each counted once), and the self-loop if any. */
  _summary(id) {
    const n = this._model.nodes.find(x => x.id === id);
    const ins = new Set(this._model.edges.filter(e => e.to === id && e.from !== id).map(e => e.from)).size;
    const outs = new Set(this._model.edges.filter(e => e.from === id && e.to !== id).map(e => e.to)).size;
    const self = this._model.edges.some(e => e.from === id && e.to === id);
    const L = this.labels;
    const text = L.summary
      ? fill(L.summary, { title: n?.title ?? id, incoming: ins, outgoing: outs })
      : `${n?.title ?? id}: ${ins} ${L.incoming.toLowerCase()}, ${outs} ${L.outgoing.toLowerCase()}`;
    return self ? `${text}. ${L.selfLoop}` : text;
  }

  /** Says `text` in the polite live region; the same text twice is said twice. */
  _announce(text) {
    clearTimeout(this._saying);
    if (text && this._status.textContent === text) {
      this._status.textContent = "";
      this._saying = setTimeout(() => { if (!this._destroyed) this._status.textContent = text; }, 100);
      return;
    }
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
    this._draw(this._route(), animate && !reducedMotion() ? "all" : null);
  }

  /** Measures the board and routes the selected node's wires (reads only; null when no wire shows). */
  _route() {
    if (!this._layout || this._selected === null || !this._flowMode()) return null;
    const g = this._measure();
    const edges = this._model.edges.filter(e => e.from !== e.to);
    const { wires } = route(this._selected, mergeParallel(edges), g);
    const L = this._layout;
    return {
      W: g.W, H: g.H,
      wires: wires.map(w => {
        const screen = w.points.map(g.fromFlow);
        const back = w.ids.some(id => L.edgeClass.get(id) === "backward");
        return { ...w, screen, key: `${w.k}:${w.from}>${w.to}`, d: pathOf(screen), cls: `${w.k}${back ? " backward" : ""}` };
      }),
    };
  }

  /**
   * Puts routed wires on screen. A wire already drawn with the same path and kind stays as it is
   * (a wire being traced goes on tracing); the others are drawn anew, traced when `trace` is "all"
   * or holds their key: bundle by bundle, at one speed, the inputs of a bundle timed to arrive together.
   */
  _draw(r, trace = null) {
    this._painted = this._geometryKey(r?.W, r?.H);
    const old = this._wireEls;
    const next = new Map();
    this._wires = r ? r.wires : [];
    if (r) this._svg.setAttribute("viewBox", `0 0 ${r.W} ${r.H}`);
    const fresh = [];
    for (const w of r?.wires ?? []) {
      const o = old.get(w.key);
      if (o && o.d === w.d && o.cls === w.cls) { next.set(w.key, o); old.delete(w.key); }
      else fresh.push(w);
    }
    for (const o of old.values()) for (const e of o.els) e.remove();
    const traced = fresh.filter(w => trace === "all" || trace?.has(w.key));
    const lengths = new Map(traced.map(w => [w, manhattan(w.screen)]));
    const order = [...new Set(traced.map(w => w.h))];
    const top = h => Math.min(...traced.filter(w => w.h === h).map(w => Math.min(...w.screen.map(p => p.y))));
    order.sort((a, b) => {
      const ka = traced.find(w => w.h === a).k, kb = traced.find(w => w.h === b).k;
      return (ka === kb ? 0 : ka === "in" ? -1 : 1) || top(a) - top(b);
    });
    const turn = new Map(order.map((h, j) => [h, j * BUNDLE_STAGGER]));
    for (const w of fresh) {
      const motion = lengths.has(w);
      const p = w.screen;
      const halo = svgEl("path", { d: w.d, class: "casing" + (motion ? " draw" : "") });
      const line = svgEl("path", { d: w.d, class: `wire ${w.cls}${motion ? " draw" : ""}` });
      const arrow = svgEl("path", { class: `arrow ${w.k}${motion ? " draw" : ""}`, d: arrowOf(p) });
      const dot = svgEl("circle", { class: `dot ${w.k}${motion ? " draw" : ""}`, cx: f(p[0].x), cy: f(p[0].y), r: 3.2 });
      this._halos.append(halo);
      this._lines.append(line);
      this._tips.append(dot, arrow);
      if (motion) {
        const len = line.getTotalLength();
        const dur = Math.max(0.2, len / SPEED);
        const longest = Math.max(...traced.filter(o => o.h === w.h).map(o => lengths.get(o)));
        const start = turn.get(w.h) + (w.k === "in" ? (longest - lengths.get(w)) / SPEED : 0);
        for (const e of [halo, line]) {
          e.style.setProperty("--len", f(len));
          e.style.setProperty("--t", `${dur.toFixed(3)}s`);
          e.style.setProperty("--d", `${start.toFixed(3)}s`);
        }
        dot.style.setProperty("--d", `${start.toFixed(3)}s`);
        arrow.style.setProperty("--d", `${(start + dur - 0.04).toFixed(3)}s`);
      }
      next.set(w.key, { d: w.d, cls: w.cls, screen: p, halo, line, arrow, dot, els: [halo, line, arrow, dot] });
    }
    this._wireEls = next;
  }

  // -------------------------------------------------------------------------------------------
  // Transitions: exit → move → enter, then the wires that changed trace again.

  /** Where everything is on screen now, in flight or not. Reads only. */
  _snapshot() {
    const nodes = new Map();
    for (const [id, b] of this._els) if (b.isConnected) nodes.set(id, { el: b, r: b.getBoundingClientRect() });
    const decor = new Map();
    for (const e of this._board.querySelectorAll("[data-key]")) decor.set(e.dataset.key, e.getBoundingClientRect());
    return { nodes, decor, moving: this._moving() };
  }

  /** Stops the current edit's motion where it is (never at its end: the next one starts from there). */
  _stopMotion(all) {
    const running = [...this._animations, ...this._cues];
    this._animations = [];
    this._cues = [];
    running.forEach(a => a.cancel());
    if (all) {
      this._ghostAnims.forEach(a => a.cancel());
      this._ghostAnims = [];
      this._ghosts.replaceChildren();
    }
  }

  _transition(first, diff, mode) {
    // Read everything, then write: a read after a write makes the browser lay the page out again,
    // and once per node that is hundreds of milliseconds on a large board.
    const board = this._board;
    const B = board.getBoundingClientRect();
    const ox = B.left + board.clientLeft, oy = B.top + board.clientTop;
    const now = new Map();
    for (const [id, b] of this._els) now.set(id, b.getBoundingClientRect());
    const decor = [...board.querySelectorAll("[data-key]")].map(e => [e, e.getBoundingClientRect()]);
    const r = this._route();
    const css = mode === "reduce" ? getComputedStyle(this._wrap) : null;
    const tint = css ? `color-mix(in srgb, ${css.getPropertyValue("--focus").trim() || "currentColor"} 22%, ${css.getPropertyValue("--sheet").trim() || "transparent"})` : "";

    const added = [...now.keys()].filter(id => !first.nodes.has(id));
    const removed = [...first.nodes.keys()].filter(id => !now.has(id));
    const moves = [];
    for (const [id, z] of now) {
      const a = first.nodes.get(id)?.r;
      if (!a) continue;
      const dx = a.left - z.left, dy = a.top - z.top;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ id, dx, dy });
    }

    if (mode === "reduce") {
      // Nothing travels: the nodes that moved or changed show a tint that fades, new nodes fade
      // in, and the wires are drawn at once.
      this._draw(r, null);
      const changed = new Set([...moves.map(m => m.id), ...(diff?.nodes.changed ?? [])].filter(id => this._els.has(id)));
      // A tint that fades: an outline would hide the focus ring of a focused node.
      for (const id of changed) this._cues.push(this._els.get(id).animate([{ backgroundColor: tint }, {}], { duration: MOTION.cue, easing: "ease-out" }));
      for (const id of added) this._cues.push(this._els.get(id).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" }));
      return;
    }

    const plan = planMove(moves, this._layout.direction);
    const decorMoves = [], decorNew = [];
    for (const [e, z] of decor) {
      const a = first.decor.get(e.dataset.key);
      if (!a) { decorNew.push(e); continue; }
      const dx = a.left - z.left, dy = a.top - z.top;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) decorMoves.push({ e, dx, dy });
    }
    // Titles and boxes keep the timing of the nodes; alone, they take the time their own travel needs.
    const moveMs = plan.ms || (decorMoves.length ? planMove(decorMoves.map(m => ({ id: "", dx: m.dx, dy: m.dy })), this._layout.direction).ms : 0);

    // The wires: unchanged ones stay, ones that keep their shape reshape with the nodes, the rest fade
    // out and trace again at the end. Wires already reshaping when this edit came all fade.
    const old = this._wireEls;
    const morph = MORPH && !plan.split && !first.moving && moveMs > 0;
    const reshape = [], fade = [], trace = new Set();
    const seen = new Set();
    for (const w of r?.wires ?? []) {
      const o = old.get(w.key);
      seen.add(w.key);
      if (o && o.d === w.d && o.cls === w.cls) continue;
      if (o && morph && o.cls === w.cls && sameShape(o.screen, w.screen)) { reshape.push([o, w]); continue; }
      if (o) fade.push(o);
      trace.add(w.key);
    }
    for (const [key, o] of old) if (!seen.has(key)) fade.push(o);

    const anims = [];
    let t = 0;
    // Exit: ghosts of removed nodes (copies, so they look like what left) and wires that go.
    for (const id of removed) {
      const { el: b, r: a } = first.nodes.get(id);
      const g = b.cloneNode(true);
      g.removeAttribute("tabindex");
      g.removeAttribute("aria-current");
      g.inert = true;
      Object.assign(g.style, { position: "absolute", left: `${a.left - ox}px`, top: `${a.top - oy}px`, width: `${a.width}px`, height: `${a.height}px`, minWidth: "0", minHeight: "0", margin: "0" });
      this._ghosts.append(g);
      const ga = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.exit, easing: MOTION.exitEase, fill: "forwards" });
      ga.finished.then(() => g.remove(), () => g.remove());
      this._ghostAnims.push(ga);
    }
    for (const o of fade) for (const e of o.els) anims.push(e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.exit, easing: MOTION.exitEase, fill: "forwards" }));
    if (removed.length || fade.length) t = MOTION.exit;

    // Move: every node, title and box from where it was seen, all at once (or along the flow, then
    // across it), for as long as the longest travel needs.
    const offset = (dx, dy) => `translate(${dx}px, ${dy}px)`;
    const frames = (dx, dy, mid) => mid
      ? [{ transform: offset(dx, dy), easing: MOTION.ease }, { transform: offset(mid[0], mid[1]), offset: plan.f, easing: MOTION.ease }, { transform: "none" }]
      : [{ transform: offset(dx, dy) }, { transform: "none" }];
    const timing = { duration: moveMs, delay: t, easing: plan.split ? "linear" : MOTION.ease, fill: "backwards" };
    const vertical = this._layout.direction === "down" || this._layout.direction === "up";
    for (const m of plan.moves) anims.push(this._els.get(m.id).animate(frames(m.dx, m.dy, m.mid), timing));
    for (const m of decorMoves) anims.push(m.e.animate(frames(m.dx, m.dy, plan.split ? (vertical ? [m.dx, 0] : [0, m.dy]) : null), timing));
    for (const [o, w] of reshape) {
      // Already drawn: the trace's dashes were cut to the old length and would leave the end bare.
      for (const e of [o.halo, o.line]) { e.classList.remove("draw"); e.setAttribute("d", w.d); anims.push(e.animate([{ d: `path("${o.d}")` }, { d: `path("${w.d}")` }], timing)); }
      const ad = arrowOf(w.screen);
      anims.push(o.arrow.animate([{ d: `path("${o.arrow.getAttribute("d")}")` }, { d: `path("${ad}")` }], timing));
      o.arrow.setAttribute("d", ad);
      const p0 = o.screen[0], p1 = w.screen[0];
      o.dot.setAttribute("cx", f(p1.x));
      o.dot.setAttribute("cy", f(p1.y));
      anims.push(o.dot.animate([{ transform: offset(p0.x - p1.x, p0.y - p1.y) }, { transform: "none" }], timing));
      o.d = w.d;
      o.screen = w.screen;
    }
    if (moveMs && (plan.moves.length || decorMoves.length)) t += moveMs;

    // Enter: new nodes, titles and boxes.
    const enter = { duration: MOTION.enter, delay: t, easing: MOTION.enterEase, fill: "backwards" };
    for (const id of added) anims.push(this._els.get(id).animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], enter));
    for (const e of decorNew) anims.push(e.animate([{ opacity: 0 }, { opacity: 1 }], enter));

    this._animations = anims;
    const done = () => {
      if (this._animations !== anims) return;   // stopped, settled or replaced by another edit
      this._animations = [];
      const late = this._revealAfter;
      this._revealAfter = null;
      if (late?.isConnected) this._reveal(late);
      const after = this._after;
      this._after = null;
      if (after) { this._paint(after.animate); return; }
      // The board may have changed size while the nodes moved: then route again.
      const { width, height } = this._board.getBoundingClientRect();
      const same = r && Math.round(width) === Math.round(r.W) && Math.round(height) === Math.round(r.H);
      this._draw(same || !r ? r : this._route(), same ? trace : "all");
    };
    if (!anims.length) { done(); return; }
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

  _setTabStop(id, focus, reveal = focus) {
    for (const b of this._els.values()) b.tabIndex = -1;
    const b = this._els.get(id);
    b.tabIndex = 0;
    if (focus && this.root.activeElement !== b) b.focus({ preventScroll: true });
    // A node in flight would be scrolled to where it is passing: reveal it once it is in place.
    if (reveal && this._moving()) this._revealAfter = b;
    else if (reveal) this._reveal(b);
  }

  /** Scrolls a node into view, sideways inside the board too, and above the detail drawer when the
   *  panel below the board covers the foot of the screen. */
  _reveal(b, instant = false) {
    const sheet = this._wrap.dataset.panel === "sheet" && !this._panel.hidden;
    // The sheet stays at the foot of the window: keep the node 12px clear of it. Open, it may still be
    // growing (its height animates): count it at its largest.
    const tall = this._sheet === "open" ? Math.min(Math.max(0.42 * innerHeight, 280), innerHeight - 120) + 12 : 0;
    const reserve = sheet ? Math.max(tall, Math.ceil(innerHeight - this._panel.getBoundingClientRect().top)) + 12 : 0;
    b.style.scrollMarginBottom = sheet ? `${reserve}px` : "";
    b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: this.options.animate && !instant && !reducedMotion() ? "smooth" : "auto" });
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
    const key = e.key;
    // Alt and an arrow: step through the selection's connections (a node reached some other way
    // becomes the selection first). Down and Up: all of them; Right: outgoing, Left: incoming (the
    // other way round when the flow goes left).
    if (e.altKey && !e.ctrlKey && !e.metaKey && key in ARROWS) {
      e.preventDefault();
      const forward = L.direction === "left" ? "ArrowLeft" : "ArrowRight";
      const [group, delta] = key === "ArrowDown" ? ["all", 1] : key === "ArrowUp" ? ["all", -1] : key === forward ? ["out", 1] : ["in", 1];
      const next = this._step(id, group, delta);
      if (next === id) this._announce(this._descs.querySelector(`#${CSS.escape(b.getAttribute("aria-describedby") ?? "")}`)?.textContent ?? "");
      else if (next) this._setTabStop(next, true);
      return;
    }
    if (key === "Escape") {
      // From a connection, back to the selection; on the selection, clear it. Without a selection
      // the key is not used here, and goes on (to a dialog around the map, for example).
      this._ring = null;
      if (this._selected === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (id !== this._selected) { this._setTabStop(this._selected, true); return; }
      this.select(null);
      this._announce(this.labels.cleared);
      return;
    }
    const lanes = [L.before, ...L.flow, L.after].filter(Boolean).map(l => L.order.get(l.id));
    const li = lanes.findIndex(ids => ids.includes(id));
    let next = null;
    if (key in ARROWS) next = this._nearest(id, ARROWS[key]);
    else if (key === "Home") next = lanes[li][0];
    else if (key === "End") next = lanes[li][lanes[li].length - 1];
    else return;
    e.preventDefault();
    this._ring = null;
    if (next) this._setTabStop(next, true);
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
  constructor(atlas, model) { this.atlas = atlas; this.model = model; this.warnings = []; this.renames = []; }
  apply(ops) {
    const r = M.apply(this.model, ops);
    this.model = r.model;
    this.warnings = r.warnings;
    this.renames.push(...renamesOf(ops));
    return this;
  }
  addNode(node, { index, edges = [] } = {}) {
    this.apply([{ op: "addNode", node }, ...edges.map(e => ({ op: "addEdge", edge: e }))]);
    // The document order of every lane becomes its drawn order first (constraints and groups can
    // draw a lane in another order than the document's): a position counted in drawn order then
    // lands exactly there, and no existing node changes places. Without flow lanes the new node's
    // layer is saved too, so the rest of the edit keeps it.
    const L0 = computeLayout(this.model);
    this.model = withLayers(withOrder(this.model, L0), L0);
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
  updateEdge(id, changes) { return this.apply({ op: "updateEdge", id, changes }); }
  addLane(lane, { index } = {}) { return this.apply({ op: "addLane", lane, index }); }
  updateLane(id, changes) { return this.apply({ op: "updateLane", id, changes }); }
  addGroup(group) { return this.apply({ op: "addGroup", group }); }
  updateGroup(id, changes) { return this.apply({ op: "updateGroup", id, changes }); }
  addConstraint(constraint) { return this.apply({ op: "addConstraint", constraint }); }
  setMeta(changes) { return this.apply({ op: "setMeta", changes }); }
}

// -----------------------------------------------------------------------------------------------
// Helpers

/** The renames made by operations, in order: [from, to] pairs. */
function renamesOf(ops) {
  return (Array.isArray(ops) ? ops : [ops]).filter(o => o?.op === "renameNode" && typeof o.from === "string" && typeof o.to === "string").map(o => [o.from, o.to]);
}

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
  // Every bend writes the same commands, even a bend of zero length, so two paths of the same shape
  // have the same command list and the browser can animate one into the other.
  for (let i = 1; i < n - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = l0 && l1 ? Math.min(ROUTE.radius, l0 / 2, l1 / 2) : 0;
    const x0 = l0 ? b.x - (b.x - a.x) / l0 * r : b.x, y0 = l0 ? b.y - (b.y - a.y) / l0 * r : b.y;
    const x1 = l1 ? b.x + (c.x - b.x) / l1 * r : b.x, y1 = l1 ? b.y + (c.y - b.y) / l1 * r : b.y;
    d += ` L${f(x0)},${f(y0)} Q${f(b.x)},${f(b.y)} ${f(x1)},${f(y1)}`;
  }
  return d + ` L${f(p[n - 1].x)},${f(p[n - 1].y)}`;
}

/** The arrowhead at the end of a wire. */
function arrowOf(p) {
  const tip = p[p.length - 1], prev = lastDistinct(p);
  const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const ux = (tip.x - prev.x) / len, uy = (tip.y - prev.y) / len;
  const bx = tip.x - ux * ROUTE.arrow, by = tip.y - uy * ROUTE.arrow;
  return `M${f(tip.x)},${f(tip.y)} L${f(bx - uy * 4.2)},${f(by + ux * 4.2)} L${f(bx + uy * 4.2)},${f(by - ux * 4.2)}Z`;
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

/** A label template with {name} placeholders filled in. */
function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

/** Text folded for searching: lower case, without accents. */
function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
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
