// Type declarations for @rpairo/atlas. Hand-written; they describe dist/atlas.js.
//
// Members marked @deprecated still work, with a console warning the first time, and are removed
// in 0.6.0; each note says what replaces it.

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
  /** Pinned nodes keep their place in `reorder()`. */
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

/** A lane as Atlas saves it: always with its kind. */
export interface SavedLane extends Lane {
  kind: LaneKind;
}

/** An edge as Atlas saves and returns it: always with its id. */
export interface SavedEdge extends Edge {
  id: string;
}

/**
 * A board as Atlas saves it (`toJSON()`, `apply()`): canonical, with its defaults written out and
 * unknown fields kept; empty optional lists are left out. It loads again exactly as it is.
 */
export interface SavedBoard extends Board {
  format: typeof FORMAT;
  meta: Meta & { direction: Direction };
  lanes?: SavedLane[];
  nodes: Node[];
  edges: SavedEdge[];
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

/** Ids added, removed or changed in one list. */
export interface Delta {
  added: string[];
  removed: string[];
  changed: string[];
}

/** What changed between two boards, by id. */
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
// Constants and pure functions: a board in, a board out. No DOM; they run in Node too.

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

/** The package version, such as `"0.5.0"`. */
export declare const VERSION: string;

/** Thrown when a board or an edit cannot be used; `errors` lists every problem found. */
export declare class AtlasError extends Error {
  constructor(errors: Finding[]);
  name: "AtlasError";
  errors: Finding[];
}

/**
 * Checks a board (object or JSON text) and never throws: the findings Atlas would report, also for
 * text that is not JSON or a board of the wrong shape. Warnings include the placement ones
 * (`group-split`), as `map.warnings` does.
 */
export declare function validate(board: Board | string): ValidationResult;
/** @deprecated since 0.5.0: models leave the package with `normalize()` and `load()`; pass the board. */
export declare function validate(model: Model): ValidationResult;

/**
 * Applies operations to a board as one step and returns the edited board, canonical, with the
 * columns of a board without flow lanes saved in `layer` as Atlas saves them. It does not reorder
 * (Atlas tidies a board without `meta.ordered` when it loads it). The input is not changed. Throws
 * AtlasError, with every problem, when the board or an operation is invalid.
 */
export declare function apply(board: Board | string, ops: Operation | readonly Operation[]): SavedBoard;

/** What changed from board `before` to board `after`, by id (the `diff` of `change` events). */
export declare function diff(before: Board | string, after: Board | string): Diff;

// ---------------------------------------------------------------------------------------------
// Deprecated since 0.5.0, removed in 0.6.0: the canonical model is no longer part of the package.

/** @deprecated since 0.5.0: `validate()` and `apply()` take boards; a model is internal. */
export interface Model {
  format: string;
  meta: Meta & { direction: Direction };
  lanes: SavedLane[];
  groups: Group[];
  nodes: Node[];
  edges: SavedEdge[];
  constraints: Constraint[];
  edgeTypes: Record<string, unknown>;
  nodeTypes: Record<string, unknown>;
  extra: Record<string, unknown>;
}
/** @deprecated since 0.5.0: `SavedLane`. */
export type ModelLane = SavedLane;
/** @deprecated since 0.5.0: `SavedEdge`. */
export type ModelEdge = SavedEdge;
/** @deprecated since 0.5.0: `Meta`. */
export type ModelMeta = Meta & { direction: Direction };
/** @deprecated since 0.5.0, with `load()`. */
export interface LoadResult {
  model: Model;
  warnings: Finding[];
}
/** @deprecated since 0.5.0: `validate()`, or `JSON.parse`. */
export declare function parse(text: string): unknown;
/** @deprecated since 0.5.0: `validate()` and `apply()` take boards. */
export declare function normalize(input: Board | string): Model;
/** @deprecated since 0.5.0: `validate()`. */
export declare function load(input: Board | string): LoadResult;
/** @deprecated since 0.5.0: `apply()` returns the board to save. */
export declare function serialize(model: Model): SavedBoard;

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
  /**
   * What a selection says to screen readers, with `{title}`, `{incoming}` and `{outgoing}` (other
   * nodes, each counted once). Without it: "Triage: 5 incoming, 2 outgoing" built from `incoming`
   * and `outgoing`. A self-loop adds `selfLoop`.
   */
  summary?: string;
  /** A keyboard step to an incoming connection, with `{n}`, `{total}`, `{hub}`. Default `Incoming {n} of {total} into {hub}`. */
  inStep: string;
  /** A keyboard step to an outgoing connection. Default `Outgoing {n} of {total} from {hub}`. */
  outStep: string;
  /** No incoming connection to step to, with `{hub}`. Default `{hub}: no incoming connections`. */
  noneIn: string;
  /** No outgoing connection to step to. Default `{hub}: no outgoing connections`. */
  noneOut: string;
  /** No connection at all. Default `{hub}: no connections`. */
  noneAll: string;
  /** Said when Escape clears the selection. Default `Selection cleared`. */
  cleared: string;
  /** The board's description: the keys it takes. */
  keys: string;
  /** Said by `nextMark()` when focus stays outside the map, with `{n}`, `{total}`, `{title}`. Default `{n} of {total}: {title}`. */
  markStep: string;
  /** How a marked node is described to screen readers. Default `Match {n} of {total}`. */
  marked: string;
}

/** Live content of a node, set with `setState()`. */
export interface LiveState {
  subtitle?: string;
  status?: string;
}

/** Where the detail goes: by the room (`auto`), or always `side`, `below`, as a `sheet`, or `none`. */
export type PanelPlace = "auto" | "side" | "below" | "sheet" | "none";

export interface AtlasOptions {
  /** Default `"auto"`. (`false` is the old spelling of `"none"`, deprecated since 0.5.0.) */
  panel?: PanelPlace | false;
  labels?: Partial<Labels>;
  /** Custom node content: fill `button` (it receives a copy of the node and its live state). */
  renderNode?: (node: Node, button: HTMLButtonElement, live: LiveState) => void;
  /** Motion: wires trace when selecting, and edits move nodes into place. `false` turns all of it off. Default `true`. */
  animate?: boolean;
  /** Render into a shadow root of the host. Default `true`. */
  shadow?: boolean;
  /** Most undo steps kept. Default 200. */
  historyLimit?: number;
  /** Level of the lane titles and the detail's title (`h2` by default); the detail's relations are one below. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** @deprecated since 0.5.0: `new Atlas(host).load(board)`. */
  document?: Board | string;
  /** @deprecated since 0.5.0: `load(board, { selected })`. */
  selected?: string;
}

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

export interface MarkDetail {
  /** The marked nodes, in reading order. */
  ids: string[];
  /** The current mark (`nextMark()`), or null. */
  current: string | null;
}

export interface ErrorDetail {
  errors: Finding[];
}

/** Events of an Atlas instance. `<atlas-map>` sends them on as `atlas-<name>`. */
export interface AtlasEventMap {
  change: CustomEvent<ChangeDetail>;
  select: CustomEvent<SelectDetail>;
  mark: CustomEvent<MarkDetail>;
}

/** @deprecated since 0.5.0, with `suggestions()`. */
export type Suggestion =
  | { node: string; code: "lane"; message: string }
  | { code: "unassigned"; message: string };

/** @deprecated since 0.5.0: `batch()` hands over the map itself. */
export type Batch = Atlas;

/**
 * A board rendered as a live map. `new Atlas(host, options).load(board)`.
 *
 * Every edit is one undoable step, fires `change` and returns the map, so edits chain; an edit that
 * would make the board invalid throws AtlasError and changes nothing. Reading methods return
 * copies. A destroyed map ignores every call.
 */
export declare class Atlas extends EventTarget {
  constructor(host: HTMLElement, options?: AtlasOptions);

  readonly host: HTMLElement;
  /** Where the map is rendered: a shadow root of `host`, or `host` itself with `shadow: false`. */
  readonly root: ShadowRoot | HTMLElement;
  /** The texts in use: the defaults with `options.labels` over them. */
  readonly labels: Readonly<Labels>;

  // Reading. Inside `batch()`, `toJSON()`, `node()`, `edges()` and `find()` read the batch's working
  // copy; the rest describe the map as drawn.

  /** The board as it should be saved; it loads again exactly as it is. */
  toJSON(): SavedBoard;
  /** Increases on every load, edit, undo and redo. */
  get rev(): number;
  get selected(): string | null;
  /** The marked nodes, in reading order (see `mark()`). */
  get marked(): string[];
  /** The current mark (see `nextMark()`), or null. */
  get currentMark(): string | null;
  /** Warnings of the current board, its placement's included. */
  get warnings(): Finding[];
  /** A copy of the node, or `null`. */
  node(id: string): Node | null;
  /** Copies of the edges that start or end at the node. */
  edges(id: string): SavedEdge[];
  /** Ids of the nodes whose title, subtitle (the live one too) or details contain `text`, ignoring case and accents, in reading order. Blank text finds nothing. */
  find(text: string): string[];

  // Loading and editing

  /**
   * Replaces the board and clears the history. A board not yet tidied by Atlas (without
   * `meta.ordered`) is reordered once for the fewest crossings; `reorder` forces or prevents that.
   * `selected` (default: `meta.selected`) is selected without scrolling or focus.
   */
  load(input: Board | string, options?: { reorder?: boolean; selected?: string | null; /** @deprecated since 0.5.0: `reorder`. */ optimize?: boolean }): this;
  /** Applies operations as one step. */
  apply(ops: Operation | readonly Operation[]): this;
  /**
   * The edits made in `fn` are one undoable step and one redraw:
   * `map.batch(m => m.addNode(a).addEdge(e).select(a.id))`. `select()`, `mark()` and `setState()`
   * run when the batch ends. An error inside leaves the board as it was (a batch inside a batch, its
   * own part); `load()`, `undo()`, `redo()` and `reorder()` throw inside.
   */
  batch(fn: (map: this) => void): this;
  /**
   * Goes next to the node named by `before` or `after`, or else to the gap of its lane with the
   * fewest crossings (the allowed gap nearest `index`, among the nodes of its lane); existing nodes
   * never change places. `edges` are added with it and count in the choice of the gap.
   */
  addNode(node: Node, options?: { index?: number; before?: string; after?: string; edges?: readonly Edge[] }): this;
  updateNode(id: string, changes: Changes<Node>): this;
  /** `lane: null` removes the node's lane; `before` / `after` name a node to stand next to, and win over `index`. */
  moveNode(id: string, options?: { lane?: string | null; index?: number; before?: string; after?: string }): this;
  /** Also removes its edges and constraints. */
  removeNode(id: string): this;
  /** Rewrites every reference (edges, derived edge ids, constraints, `meta.selected`); nothing moves. */
  renameNode(from: string, to: string): this;
  /** Without an `id`, the edge gets `from->to` (and `#2`, `#3` for repeats). */
  addEdge(edge: Edge): this;
  updateEdge(id: string, changes: Changes<Edge>): this;
  removeEdge(id: string): this;
  addLane(lane: Lane, options?: { index?: number }): this;
  updateLane(id: string, changes: Changes<Lane>): this;
  /** Default index: last. */
  moveLane(id: string, options?: { index?: number }): this;
  /** @deprecated since 0.5.0: `moveLane(id, { index })`. */
  moveLane(id: string, index: number): this;
  /** Its nodes move to `moveTo`, or lose their lane. */
  removeLane(id: string, options?: { moveTo?: string | null }): this;
  addGroup(group: Group): this;
  updateGroup(id: string, changes: Changes<Group>): this;
  /** Its members and subgroups move to its parent. */
  removeGroup(id: string): this;
  addConstraint(constraint: Constraint): this;
  /** By position in the `constraints` list. */
  removeConstraint(index: number): this;
  setMeta(changes: Changes<Meta>): this;
  /**
   * Reorders every lane (and, without flow lanes, the columns) for the fewest crossings as one
   * step; pinned nodes keep their place. Returns how many pairs of nodes change order; `dryRun`
   * only counts them.
   */
  reorder(options?: { dryRun?: boolean }): number;
  /** `false` when there is nothing to undo. */
  undo(): boolean;
  /** `false` when there is nothing to redo. */
  redo(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;
  /** Forgets every undo and redo step (for example once the board is saved). */
  clearHistory(): this;

  // Live content and viewing (never undoable, never saved)

  /**
   * Changes what a node shows without moving anything; `null` clears a field. `status` becomes the
   * CSS part `status-<value>` and must match `^[a-z0-9_-]{1,32}$` (AtlasError otherwise). Unknown
   * nodes are ignored.
   */
  setState(id: string, state?: { subtitle?: string | number | null; status?: string | null }): this;
  /**
   * Selects a node (`null` clears) and shows its wires and its detail. `reveal` (default true)
   * scrolls it into view; `focus` (default false) moves keyboard focus to it; `announce` (default
   * false) makes screen readers say its summary, as a person's selection does. An unknown id
   * changes nothing.
   */
  select(id: string | null, options?: { focus?: boolean; animate?: boolean; reveal?: boolean; announce?: boolean }): this;
  /** Marks nodes (search results, filters); unknown ids are ignored, `null` or `[]` clears. Never selects. */
  mark(ids: Iterable<string> | null): this;
  /** Makes the next (step 1) or previous (-1) mark current, scrolls it into view and gives it the tab stop; `focus` also focuses it. Returns its id, or null without marks. */
  nextMark(step?: number, options?: { focus?: boolean }): string | null;
  /** Opens (`true`), folds (`false`) or toggles the detail when it is a sheet. Returns whether it is open. */
  toggleDetail(force?: boolean): boolean;
  /** Finishes any running transition at once and redraws the wires. */
  settle(): this;
  /** Stops observing and empties `root`. Final: a destroyed map ignores every later call. */
  destroy(): void;
  /** Whether `destroy()` ran. */
  readonly destroyed: boolean;

  // Deprecated since 0.5.0, removed in 0.6.0.

  /** @deprecated since 0.5.0: `toJSON()`. */
  export(): SavedBoard;
  /** @deprecated since 0.5.0: `validate()` and `map.warnings`. */
  suggestions(): Suggestion[];
  /** @deprecated since 0.5.0: `addEdge({ from, to, ...options })`. */
  connect(from: string, to: string, options?: { id?: string; label?: string; details?: string; type?: string }): this;
  /** @deprecated since 0.5.0: `removeEdge(id)`. */
  disconnect(idOrPair: string | { from: string; to: string }): this;
  /** @deprecated since 0.5.0: `updateNode(id, { pinned: true })`, with `moveNode()` in the same batch. */
  pin(id: string, options?: { lane?: string | null; index?: number }): this;
  /** @deprecated since 0.5.0: `updateNode(id, { pinned: null })`. */
  unpin(id: string): this;
  /** @deprecated since 0.5.0: `reorder()`, which returns one count. */
  reorderAll(options?: { dryRun?: boolean }): { swaps: number; layers: number };
  /** @deprecated since 0.5.0: `toggleDetail(force)`, which returns whether it is open. */
  openDetail(open?: boolean): "open" | "peek";

  addEventListener<K extends keyof AtlasEventMap>(type: K, listener: (this: Atlas, event: AtlasEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof AtlasEventMap>(type: K, listener: (this: Atlas, event: AtlasEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

// ---------------------------------------------------------------------------------------------
// The custom element.

/**
 * `<atlas-map>`. Attributes: `src` (board URL, same origin unless `cross-origin` is present),
 * `selected`, `panel` (as the option: `auto`, `side`, `below`, `sheet` or `none`), `cross-origin`,
 * `theme="dark" | "light"`. A board can also go inline in a `<script type="application/json">`
 * child. Events, bubbling and composed: `atlas-change`, `atlas-select`, `atlas-mark` (the map's
 * events) and `atlas-error` (a board that did not load).
 */
export declare class AtlasMap extends HTMLElement {
  /** The map, created when the element is first connected (again after `atlas.destroy()`). Removing the element keeps it. */
  atlas?: Atlas;
  /** Settles with the map once the current board is on screen; rejects with `{ errors }`. */
  readonly ready: Promise<Atlas>;
  /** @deprecated since 0.5.0: `ready` rejects with the same `{ errors }`. */
  readonly error: ErrorDetail | null;
  static readonly observedAttributes: string[];
  connectedCallback(): void;
  attributeChangedCallback(name: string, old: string | null, value: string | null): void;
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
  // Sent by <atlas-map>; they bubble, so any element around one hears them.
  interface HTMLElementEventMap {
    "atlas-change": CustomEvent<ChangeDetail>;
    "atlas-select": CustomEvent<SelectDetail>;
    "atlas-mark": CustomEvent<MarkDetail>;
    "atlas-error": CustomEvent<ErrorDetail>;
  }
}
