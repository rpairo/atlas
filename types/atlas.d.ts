// Type declarations for @rpairo/atlas. Hand-written; they describe dist/atlas.js.
//
// Everything marked @experimental (layout, bestInsertion, inversions, route, demand, ROUTE and
// their types) is outside the SemVer guarantee: it may change in any minor release.

/// <reference lib="dom" />

// ---------------------------------------------------------------------------------------------
// The board document (what you write and save). Unknown fields are kept and written back, at the
// top level and inside every object, so every object type accepts extra keys.

/** Direction in which the lanes follow each other. */
export type Direction = "right" | "down" | "left" | "up";

/** `flow`: a column of the flow. `before` / `after`: a band across the whole flow, before or after it. */
export type LaneKind = "flow" | "before" | "after";

/** Board-level settings. */
export interface Meta {
  title?: string;
  /** Default `"right"`. */
  direction?: Direction;
  /** Node selected when the board loads. */
  selected?: string;
  lang?: string;
  /** True once Atlas has tidied the board; the node order is then kept as is. */
  ordered?: boolean;
  [key: string]: unknown;
}

export interface Lane {
  id: string;
  title?: string;
  /** Default `"flow"`. At most one lane of kind `before` and one of kind `after`. */
  kind?: LaneKind;
  [key: string]: unknown;
}

export interface Group {
  id: string;
  title?: string;
  /** Enclosing group, nested at most `LIMITS.groupDepth` deep. */
  parent?: string | null;
  [key: string]: unknown;
}

export interface Node {
  /** Letters, digits and `_ . : -`, up to 64; lanes, groups and nodes share one namespace. */
  id: string;
  title?: string;
  subtitle?: string;
  details?: string[];
  /** Without it, and with flow lanes declared, the node goes to the "Unassigned" lane. */
  lane?: string;
  group?: string;
  /** Becomes the CSS part `node-<type>` when it matches `^[A-Za-z0-9_-]{1,32}$`. */
  type?: string;
  /** Pinned nodes keep their place in `reorderAll()`. */
  pinned?: boolean;
  /**
   * The node's column on a board without flow lanes (a whole number from 0), written by Atlas so
   * that edits keep the drawing stable; only the order of the numbers matters. Ignored in bands and
   * on boards with flow lanes.
   */
  layer?: number;
  [key: string]: unknown;
}

export interface Edge {
  /** Optional; without one, an edge gets `from->to` (and `#n` for repeats). */
  id?: string;
  from: string;
  to: string;
  label?: string;
  details?: string;
  type?: string;
  [key: string]: unknown;
}

/** Order inside a lane: `a` before `b`, or a node first or last of its lane. */
export type Constraint =
  | { type: "before"; a: string; b: string; [key: string]: unknown }
  | { type: "first" | "last"; node: string; [key: string]: unknown };

/** A board as written by hand or by `toJSON()`. Every list is optional. */
export interface Board {
  format?: typeof FORMAT;
  meta?: Meta;
  /** Order matters: it is the order of the flow. */
  lanes?: Lane[];
  groups?: Group[];
  /** Order matters: it is the sketch, kept within each lane. */
  nodes?: Node[];
  edges?: Edge[];
  constraints?: Constraint[];
  edgeTypes?: Record<string, unknown>;
  nodeTypes?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A board as `serialize()` and `Atlas#toJSON()` write it: empty optional lists are left out. */
export interface SavedBoard extends Board {
  format: typeof FORMAT;
  meta: ModelMeta;
  nodes: Node[];
  edges: ModelEdge[];
}

// ---------------------------------------------------------------------------------------------
// The canonical model (what normalize() and load() return and the edit functions work on).

export interface ModelMeta extends Meta {
  direction: Direction;
}

export interface ModelLane extends Lane {
  kind: LaneKind;
}

export interface ModelEdge extends Edge {
  id: string;
}

/**
 * The canonical board: every list present, every lane with a kind, every edge with an id, and
 * unknown top-level fields kept aside in `extra` so that `serialize()` gives them back.
 * Build it with `normalize()` or `load()`, never by hand, and do not pass it back to them.
 */
export interface Model {
  /** As found in the input (`FORMAT` when absent); `validate()` accepts only `"atlas/1"`. */
  format: string;
  meta: ModelMeta;
  lanes: ModelLane[];
  groups: Group[];
  nodes: Node[];
  edges: ModelEdge[];
  constraints: Constraint[];
  edgeTypes: Record<string, unknown>;
  nodeTypes: Record<string, unknown>;
  extra: Record<string, unknown>;
}

/** One problem: a JSON-path-like `path`, a stable `code` and a readable `message`. */
export interface Finding {
  path: string;
  code: string;
  message: string;
}

/** Errors make a board unusable; warnings are drawn anyway and reported. */
export interface ValidationResult {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
}

export interface LoadResult {
  model: Model;
  warnings: Finding[];
}

/** Ids added, removed or changed in one list. */
export interface Delta {
  added: string[];
  removed: string[];
  changed: string[];
}

/** What changed between two models, by id. */
export interface Diff {
  nodes: Delta;
  edges: Delta;
  lanes: Delta;
  groups: Delta;
  /** The order of the nodes changed. */
  order: boolean;
  meta: boolean;
  constraints: boolean;
}

/** Fields to merge into an object: `null` (or `undefined`) removes a field; `id` is ignored. */
export type Changes<T> = { [K in keyof T as K extends "id" ? never : K]?: T[K] | null };

// ---------------------------------------------------------------------------------------------
// Edit operations: plain data, so a sequence can be stored, sent and replayed.

/**
 * One edit. Positions: `index` is the position among the nodes of the same lane (default: last);
 * `before` / `after` name a node to stand next to, and win over `index`.
 */
export type Operation =
  | { op: "addNode"; node: Node; index?: number | null; before?: string | null; after?: string | null }
  | { op: "updateNode"; id: string; changes: Changes<Node> }
  /** `lane: null` removes the node's lane; leaving it out keeps it. */
  | { op: "moveNode"; id: string; lane?: string | null; index?: number | null; before?: string | null; after?: string | null }
  /** Also removes the node's edges and constraints. */
  | { op: "removeNode"; id: string }
  /** Rewrites every reference, including derived edge ids and `meta.selected`. */
  | { op: "renameNode"; from: string; to: string }
  | { op: "addEdge"; edge: Edge }
  | { op: "updateEdge"; id: string; changes: Changes<Edge> }
  | { op: "removeEdge"; id: string }
  | { op: "addLane"; lane: Lane; index?: number | null }
  | { op: "updateLane"; id: string; changes: Changes<Lane> }
  | { op: "moveLane"; id: string; index?: number | null }
  /** Its nodes move to `moveTo`, or lose their lane when it is left out or null. */
  | { op: "removeLane"; id: string; moveTo?: string | null }
  | { op: "addGroup"; group: Group }
  | { op: "updateGroup"; id: string; changes: Changes<Group> }
  /** Its members and subgroups move to its parent. */
  | { op: "removeGroup"; id: string }
  | { op: "addConstraint"; constraint: Constraint }
  /** `index` in the `constraints` list. */
  | { op: "removeConstraint"; index: number }
  | { op: "setMeta"; changes: Changes<Meta> };

/** The name of an operation. */
export type OperationName = Operation["op"];

// ---------------------------------------------------------------------------------------------
// Constants and pure functions (no DOM).

/** The board format this version reads and writes. */
export declare const FORMAT: "atlas/1";

/** Hard limits; a board beyond them does not load. */
export declare const LIMITS: Readonly<{
  /** Size of the JSON text, in UTF-8 bytes (512 KiB). */
  bytes: number;
  nodes: number;
  edges: number;
  lanes: number;
  groups: number;
  constraints: number;
  /** Characters per text field. */
  text: number;
  /** Entries in a node's `details`. */
  details: number;
  groupDepth: number;
}>;

/** The package version, such as `"0.3.0"`. */
export declare const VERSION: string;

/** Thrown when a board cannot be used; `errors` lists every problem found. */
export declare class AtlasError extends Error {
  constructor(errors: Finding[]);
  name: "AtlasError";
  errors: Finding[];
}

/** Parses JSON text without letting keys like `__proto__` reach a prototype. Throws AtlasError. */
export declare function parse(text: string): unknown;

/** The canonical model of a board (object or JSON text). Fills defaults; does not validate. */
export declare function normalize(input: Board | string): Model;

/** Checks a canonical model; never throws. */
export declare function validate(model: Model): ValidationResult;

/** `normalize()` then `validate()`. Throws AtlasError with every error if the board is unusable. */
export declare function load(input: Board | string): LoadResult;

/**
 * Applies operations atomically to a copy of `model`: all succeed and the result validates, or
 * AtlasError is thrown and `model` is untouched.
 */
export declare function apply(model: Model, ops: Operation | readonly Operation[]): LoadResult;

/** The board as it should be saved: canonical order, unknown fields restored. */
export declare function serialize(model: Model): SavedBoard;

/** What changed between two models, by id. */
export declare function diff(before: Model, after: Model): Diff;

// ---------------------------------------------------------------------------------------------
// The engine's internals, exported for tools and audits. All @experimental.

/** @experimental A lane as placed by `layout()`; synthetic lanes are "Unassigned" and automatic ones. */
export interface LayoutLane {
  id: string;
  title: string;
  kind: LaneKind;
  synthetic?: boolean;
}

/** @experimental Where a group's members sit in one lane (row slots `from`..`to`). */
export interface GroupSpan {
  group: string;
  title: string;
  lane: string;
  from: number;
  to: number;
  depth: number;
}

/** @experimental The placement of a model: lanes, order inside each lane and row slots. */
export interface Layout {
  direction: Direction;
  /** `auto` when no flow lane is declared and lanes come from the relations. */
  mode: "lanes" | "auto";
  flow: LayoutLane[];
  before: LayoutLane | null;
  after: LayoutLane | null;
  /** Node id → lane id. */
  laneOf: Map<string, string>;
  /** Lane id → rank along the flow (-1 for the `before` band). */
  rank: Map<string, number>;
  /** Without flow lanes: node id → its computed layer (column), for nodes outside the bands. Empty otherwise. */
  layers: Map<string, number>;
  /** Lane id → node ids in drawing order. */
  order: Map<string, string[]>;
  /** Node id → row slot. */
  slots: Map<string, number>;
  rows: number;
  /** Edge id → its class. */
  edgeClass: Map<string, "forward" | "same" | "backward" | "self">;
  groups: GroupSpan[];
  /** Placement warnings, such as `group-split` (constraints put other nodes inside a group). */
  warnings: Finding[];
}

/** @experimental Places a canonical model. `optimize` reorders every lane for fewest crossings. */
export declare function layout(model: Model, options?: { optimize?: boolean }): Layout;

/**
 * @experimental Where a node already in `model` should go: its index among the other nodes of
 * its lane (in drawing order), at the gap with the fewest crossings, or with `near` the allowed gap
 * nearest that index. Gaps that would move a group block, and existing nodes with it, are skipped.
 */
export declare function bestInsertion(model: Model, nodeId: string, near?: number): number;

/** @experimental How many pairs of nodes swap places between two layouts. */
export declare function inversions(before: Pick<Layout, "order">, after: Pick<Layout, "order">): number;
/**
 * @experimental The model with each node's computed layer saved in `layer` (boards without flow
 * lanes; removed elsewhere), as Atlas saves it after every edit. For code that edits with `apply()`
 * without an `Atlas`.
 */
export declare function withLayers(model: Model, layout: Layout): Model;

/** @experimental A point in flow coordinates: `u` along the flow, `v` across it. */
export interface FlowPoint {
  u: number;
  v: number;
}

/** @experimental Where a node sits: in the `before` band (`top`), a flow lane (`col`) or the `after` band (`bot`). */
export interface Place {
  kind: "top" | "col" | "bot";
  col?: number;
}

/** @experimental An edge as the router reads it; `ids` lists the edges merged into one wire. */
export interface RouteEdge {
  id: string;
  from: string;
  to: string;
  ids?: string[];
}

/** @experimental Measured geometry for `route()`, in flow coordinates. */
export interface RouteGeometry {
  /** Node id → box (`l`/`r` along u, `t`/`b` along v). */
  boxes: Map<string, { l: number; r: number; t: number; b: number }>;
  /** Corridor (`g0`..`gN`, `ct`, `cb`, `ca`, `cz`) → extent. */
  corridors: Record<string, { a: number; b: number }>;
  place: (id: string) => Place;
  debug?: boolean;
}

/** @experimental One routed wire. `k` tells whether it leaves (`out`) or reaches (`in`) the selected node. */
export interface Wire {
  id: string;
  ids: string[];
  from: string;
  to: string;
  k: "in" | "out";
  /** Bundle index. */
  h: number;
  points: FlowPoint[];
}

/** @experimental The result of `route()`. */
export interface RouteResult {
  wires: Wire[];
  crossings: number;
  /** Only with `debug`. */
  lists?: string[];
}

/** @experimental Routes the wires of the selected node through free corridors. */
export declare function route(selected: string, edges: readonly RouteEdge[], geometry: RouteGeometry): RouteResult;

/**
 * @experimental Tracks per corridor and ports per node side needed over every possible
 * selection (`channels` are the abstract positions of `ct` and `cb` along v).
 */
export declare function demand(
  nodeIds: readonly string[],
  edges: readonly RouteEdge[],
  place: (id: string) => Place,
  pos: (id: string) => FlowPoint,
  channels: { ct: number; cb: number },
): { tracks: Map<string, number>; ports: Map<string, number> };

/** @experimental Routing constants, in CSS pixels. */
export declare const ROUTE: Readonly<{
  gutterPad: number;
  channelPad: number;
  trackStep: number;
  channelStep: number;
  portPad: number;
  portStep: number;
  minSeparation: number;
  arrow: number;
  radius: number;
  /** Most search work one `route()` may spend (pairs of segments compared); past it, the best order found is kept. */
  budget: number;
}>;

// ---------------------------------------------------------------------------------------------
// The live map.

/** Texts of the interface (English by default). */
export interface Labels {
  incoming: string;
  outgoing: string;
  unassigned: string;
  selfLoop: string;
  /** Accessible name of the board when it has no `meta.title`. Default `Map`. */
  board: string;
  /** Accessible name of the detail panel. Default `Detail`. */
  detail: string;
}

/** Live content of a node, set with `setState()`. */
export interface LiveState {
  subtitle?: string;
  status?: string;
}

export interface AtlasOptions {
  /** Board to load at once (object or JSON text). */
  document?: Board | string;
  /** Node selected at start (default: `meta.selected`). */
  selected?: string;
  /** `false` hides the detail panel. Default `"auto"`. */
  panel?: "auto" | false;
  labels?: Partial<Labels>;
  /** Custom node content: fill `button` (it receives a copy of the node and its live state). */
  renderNode?: (node: Node, button: HTMLButtonElement, live: LiveState) => void;
  /** Trace wires when selecting. Default `true`. */
  animate?: boolean;
  /** Render into a shadow root of the host. Default `true`. */
  shadow?: boolean;
  /** Most undo steps kept. Default 200. */
  historyLimit?: number;
  /** Level of the lane titles and the detail's title (`h2` by default); the detail's relations are one below. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** A node whose edges mostly run against its lane, or a board with unassigned nodes. Advice only. */
export type Suggestion =
  | { node: string; code: "lane"; message: string }
  | { code: "unassigned"; message: string };

export interface ChangeDetail {
  /** The revision after the change. */
  rev: number;
  /** `null` when a whole board was loaded. */
  diff: Diff | null;
  warnings: Finding[];
}

export interface SelectDetail {
  id: string | null;
}

export interface ErrorDetail {
  errors: Finding[];
}

/** Events of an Atlas instance. The host element receives them too, as `atlas-change` and `atlas-select`. */
export interface AtlasEventMap {
  change: CustomEvent<ChangeDetail>;
  select: CustomEvent<SelectDetail>;
}

/** The working copy inside `batch()`: each call applies at once, and the batch commits as one step. */
export interface Batch {
  apply(ops: Operation | readonly Operation[]): Batch;
  addNode(node: Node, options?: { index?: number; edges?: readonly Edge[] }): Batch;
  connect(from: string, to: string, options?: { id?: string; label?: string; details?: string; type?: string; [key: string]: unknown }): Batch;
  removeNode(id: string): Batch;
  updateNode(id: string, changes: Changes<Node>): Batch;
  moveNode(id: string, options?: { lane?: string | null; index?: number; before?: string; after?: string }): Batch;
  disconnect(id: string): Batch;
  updateEdge(id: string, changes: Changes<Edge>): Batch;
  addLane(lane: Lane, options?: { index?: number }): Batch;
  updateLane(id: string, changes: Changes<Lane>): Batch;
  addGroup(group: Group): Batch;
  updateGroup(id: string, changes: Changes<Group>): Batch;
  addConstraint(constraint: Constraint): Batch;
  setMeta(changes: Changes<Meta>): Batch;
}

/**
 * A board rendered as a live map, edited through methods. Every edit is one undoable step, fires
 * `change` and returns the new revision; an edit that would make the board invalid throws
 * AtlasError and changes nothing.
 */
export declare class Atlas extends EventTarget {
  constructor(host: HTMLElement, options?: AtlasOptions);

  readonly host: HTMLElement;
  /** Where the map is rendered: a shadow root of `host`, or `host` itself with `shadow: false`. */
  readonly root: ShadowRoot | HTMLElement;
  labels: Labels;
  options: AtlasOptions & { panel: "auto" | false; animate: boolean; shadow: boolean };

  // Reading

  /** The board as it should be saved; it reloads exactly as it is. */
  toJSON(): SavedBoard;
  /** Same as `toJSON()`. */
  export(): SavedBoard;
  /** Increases on every load, edit, undo and redo. */
  get rev(): number;
  get selected(): string | null;
  /** Warnings of the current board. */
  get warnings(): Finding[];
  /** A copy of the node, or `null`. */
  node(id: string): Node | null;
  /** Copies of the edges that start or end at the node. */
  edges(id: string): ModelEdge[];
  /** Ids of the nodes whose title, subtitle or details contain `text` (case-insensitive). */
  find(text: string): string[];
  suggestions(): Suggestion[];

  // Loading and editing

  /** Replaces the board and clears the history. A board without `meta.ordered` is tidied once. */
  load(input: Board | string, options?: { optimize?: boolean; selected?: string | null }): this;
  apply(ops: Operation | readonly Operation[]): number;
  /** Several edits as one undoable step. */
  batch(fn: (batch: Batch) => void): number;
  /** Goes to the gap with the fewest crossings unless `index` (among the nodes of its lane) is given. */
  addNode(node: Node, options?: { index?: number; edges?: readonly Edge[] }): number;
  updateNode(id: string, changes: Changes<Node>): number;
  /** `lane: null` removes the node's lane. */
  moveNode(id: string, options?: { lane?: string | null; index?: number }): number;
  /** Also removes its edges and constraints. */
  removeNode(id: string): number;
  /** Rewrites every reference (edges, derived edge ids, constraints, `meta.selected`); nothing moves. */
  renameNode(from: string, to: string): number;
  connect(from: string, to: string, options?: { id?: string; label?: string; details?: string; type?: string }): number;
  updateEdge(id: string, changes: Changes<Edge>): number;
  /** By edge id, or the first edge from `from` to `to`; throws an `AtlasError` if there is none. */
  disconnect(idOrPair: string | { from: string; to: string }): number;
  addLane(lane: Lane, options?: { index?: number }): number;
  updateLane(id: string, changes: Changes<Lane>): number;
  /** Default index: last. */
  moveLane(id: string, index?: number): number;
  /** Its nodes move to `moveTo`, or lose their lane. */
  removeLane(id: string, options?: { moveTo?: string | null }): number;
  addGroup(group: Group): number;
  updateGroup(id: string, changes: Changes<Group>): number;
  /** Its members and subgroups move to its parent. */
  removeGroup(id: string): number;
  addConstraint(constraint: Constraint): number;
  /** By position in the `constraints` list. */
  removeConstraint(index: number): number;
  /** Moves the node (when `lane` or `index` is given) and sets `pinned: true`. */
  pin(id: string, options?: { lane?: string | null; index?: number }): number;
  /** Removes the `pinned` field. */
  unpin(id: string): number;
  setMeta(changes: Changes<Meta>): number;
  /** Reorders every lane for the fewest crossings; pinned nodes keep their place. */
  /** `swaps`: pairs of nodes that change places in a lane; `layers`: nodes that change layer (boards without flow lanes). */
  reorderAll(options?: { dryRun?: boolean }): { swaps: number; layers: number };
  /** `false` when there is nothing to undo. */
  undo(): boolean;
  /** `false` when there is nothing to redo. */
  redo(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;
  /** Forgets every undo and redo step (for example once the board is saved). */
  clearHistory(): void;

  // Live content and viewing

  /**
   * Changes what a node shows without moving anything; `null` clears a field. `status` must match
   * `^[a-z0-9_-]{1,32}$` and becomes the CSS part `status-<value>`. Ignored for unknown nodes.
   */
  setState(id: string, state?: { subtitle?: string | number | null; status?: string | null }): void;
  /** Selects a node (or none), shows its wires and its detail. */
  select(id: string | null, options?: { focus?: boolean; animate?: boolean }): void;
  /** Finishes any running transition at once and redraws the wires. */
  settle(): void;
  /** Stops observing and empties `root`. Final: a destroyed instance draws nothing more. */
  destroy(): void;
  /** Whether `destroy()` ran. */
  readonly destroyed: boolean;

  addEventListener<K extends keyof AtlasEventMap>(type: K, listener: (this: Atlas, event: AtlasEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof AtlasEventMap>(type: K, listener: (this: Atlas, event: AtlasEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

// ---------------------------------------------------------------------------------------------
// The custom element.

/**
 * `<atlas-map>`. Attributes: `src` (board URL, same origin unless `cross-origin` is present),
 * `selected`, `panel="false"`, `cross-origin`, `theme="dark" | "light"`. A board can also go
 * inline in a `<script type="application/json">` child. Events: `atlas-change`, `atlas-select`,
 * `atlas-error`, all bubbling and composed.
 */
export declare class AtlasMap extends HTMLElement {
  /** The instance, created when the element is first connected (again after `atlas.destroy()`). */
  atlas?: Atlas;
  /** Settles with the instance once the current board is on screen; rejects with `{ errors }`. */
  readonly ready: Promise<Atlas>;
  /** The last failure to load, or null once a board is on screen. */
  error: ErrorDetail | null;
  static readonly observedAttributes: string[];
  connectedCallback(): void;
  attributeChangedCallback(name: string, old: string | null, value: string | null): void;
  /** Keeps the instance alive while the element moves; call `atlas.destroy()` to free it. */
  disconnectedCallback(): void;
}

/**
 * Registers `<atlas-map>` (or a subclass of it under another name) unless the name is taken.
 * Importing the package already registers `atlas-map` in a browser.
 */
export declare function define(name?: string): void;

declare global {
  interface HTMLElementTagNameMap {
    "atlas-map": AtlasMap;
  }
  interface HTMLElementEventMap {
    "atlas-change": CustomEvent<ChangeDetail>;
    "atlas-select": CustomEvent<SelectDetail>;
    "atlas-error": CustomEvent<ErrorDetail>;
  }
}
