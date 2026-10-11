// Type-checks the public declarations by using them as a consumer would. Nothing here runs.
// "@rpairo/atlas" resolves through package.json "exports" (self-reference), as for a consumer.
//
//   npx --yes -p typescript@7.0.2 tsc -p test/types

import {
  Atlas, AtlasMap, AtlasError, define, FORMAT, LIMITS, VERSION, validate, apply, diff,
  parse, normalize, load, serialize,
} from "@rpairo/atlas";
import type {
  Board, Model, Node, Edge, Constraint, Operation, OperationName, Finding, Diff, SavedBoard,
  ChangeDetail, ErrorDetail, MarkDetail, Suggestion, Batch, PanelPlace,
} from "@rpairo/atlas";

const board: Board = {
  format: "atlas/1",
  meta: { title: "Order lifecycle", direction: "down", selected: "paid", lang: "en", custom: 1 },
  lanes: [{ id: "controls", kind: "before" }, { id: "inputs", title: "Inputs" }, { id: "outputs" }],
  groups: [{ id: "billing", title: "Billing", parent: null }],
  nodes: [
    { id: "paid", title: "Paid", subtitle: "funds captured", details: ["one"], lane: "inputs", group: "billing", type: "state" },
    { id: "packed", lane: "outputs", pinned: true, owner: "unknown fields are kept" },
  ],
  edges: [{ from: "paid", to: "packed", label: "pick", details: "…", type: "flow" }],
  constraints: [{ type: "before", a: "paid", b: "packed" }, { type: "first", node: "paid" }],
  edgeTypes: { flow: {} },
  extension: { kept: true },
};

// @ts-expect-error: not a direction
const sideways: Board = { meta: { direction: "sideways" } };
// @ts-expect-error: an edge needs `to`
const dangling: Edge = { from: "a" };
// @ts-expect-error: `first` takes `node`, not `a`
const badConstraint: Constraint = { type: "first", a: "x" };

// The pure functions: a board in, a board out.
const fmt: "atlas/1" = FORMAT;
const maxNodes: number = LIMITS.nodes;
// @ts-expect-error: LIMITS is read-only
LIMITS.nodes = 1;
const version: string = VERSION;
const check = validate(board);
const okFlag: boolean = check.ok;
const firstError: Finding | undefined = validate("{").errors[0];
const next: SavedBoard = apply(board, [
  { op: "addNode", node: { id: "x", lane: "inputs" }, after: "paid" },
  { op: "setMeta", changes: { title: null, direction: "left" } },
]);
const fromText: SavedBoard = apply('{"nodes":[]}', { op: "addNode", node: { id: "a" } });
const savedEdgeId: string = next.edges[0].id;
const savedDirection: "right" | "down" | "left" | "up" = next.meta.direction;
const changes: Diff = diff(board, next);
const added: string[] = changes.nodes.added;
const reordered: boolean = changes.order;
// @ts-expect-error: apply returns the board, not { model, warnings }
const notModel: Model = apply(board, []).model;

// Deprecated in 0.5.0, still typed until 0.6.0.
const raw: unknown = parse('{"nodes":[]}');
const model: Model = normalize(board);
const loaded = load(board);
const extra: Record<string, unknown> = loaded.model.extra;
const resaved: SavedBoard = serialize(model);
const checkModel = validate(model);
// @ts-expect-error: a model is not a board (normalize would nest its `extra`)
normalize(loaded.model);

try {
  apply(board, { op: "removeNode", id: "nope" });
} catch (e) {
  if (e instanceof AtlasError) {
    const codes: string[] = e.errors.map(f => f.code);
    const name: "AtlasError" = e.name;
  }
}
const thrown = new AtlasError([{ path: "nodes[0].id", code: "id", message: "bad id" }]);

// Operations: a discriminated union, narrowed by `op`.
function describe(op: Operation): string {
  switch (op.op) {
    case "addNode": return `add ${op.node.id} at ${op.index ?? op.before ?? op.after ?? "the end"}`;
    case "moveNode": return `move ${op.id} to ${op.lane === null ? "no lane" : op.lane ?? "its lane"}`;
    case "renameNode": return `${op.from} → ${op.to}`;
    case "removeLane": return `remove ${op.id}, nodes to ${op.moveTo ?? "no lane"}`;
    case "removeConstraint": return `constraint #${op.index.toFixed(0)}`;
    case "addConstraint": return op.constraint.type === "before" ? `${op.constraint.a} < ${op.constraint.b}` : op.constraint.node;
    case "addEdge": return `${op.edge.from} → ${op.edge.to}`;
    case "setMeta": return Object.keys(op.changes).join(", ");
    case "updateNode": case "updateEdge": case "updateLane": case "updateGroup":
    case "removeNode": case "removeEdge": case "moveLane": case "removeGroup":
      return op.id;
    case "addLane": return op.lane.id;
    case "addGroup": return op.group.id;
    default: {
      const never: never = op;
      return never;
    }
  }
}
const opName: OperationName = "renameNode";
// @ts-expect-error: unknown operation
const unknownOp: Operation = { op: "explode", id: "a" };
// @ts-expect-error: removeConstraint takes an index, not an id
const wrongField: Operation = { op: "removeConstraint", id: "a" };
// @ts-expect-error: moveNode needs the node id
const missingId: Operation = { op: "moveNode", lane: "inputs" };

// The live map.
const host = document.createElement("div");
const map = new Atlas(host, {
  panel: "none",
  labels: { incoming: "Entradas" },
  renderNode(node: Node, button: HTMLButtonElement, live) {
    button.textContent = live.subtitle ?? node.title ?? node.id;
    if (live.status) button.dataset.status = live.status;
  },
  animate: false,
  shadow: true,
  headingLevel: 3,
}).load(board, { selected: "paid", reorder: false });
const places: PanelPlace[] = ["auto", "side", "below", "sheet", "none"];
// @ts-expect-error: panel is a place
new Atlas(host, { panel: true });
// @ts-expect-error: the host is an element
new Atlas("map");
// Deprecated spellings still type-check.
new Atlas(host, { document: board, selected: "paid", panel: false });

const root: ShadowRoot | HTMLElement = map.root;
const label: string = map.labels.selfLoop;
// @ts-expect-error: the labels in use are read-only
map.labels.selfLoop = "x";
// @ts-expect-error: the options are not part of the map
map.options;
const json: SavedBoard = map.toJSON();
const rev: number = map.rev;
const selected: string | null = map.selected;
const warnings: Finding[] = map.warnings;
const node: Node | null = map.node("paid");
const wireIds: string[] = map.edges("paid").map(e => e.id);
const found: string[] = map.find("pai");
const chained: Atlas = map.load('{"nodes":[]}');

// Every edit returns the map, so edits chain.
map
  .apply({ op: "removeEdge", id: "paid->packed" })
  .apply([{ op: "addEdge", edge: { from: "paid", to: "packed" } }])
  .batch(m => {
    m.addNode({ id: "y", lane: "outputs" }, { index: 0, edges: [{ from: "paid", to: "y" }] })
      .addEdge({ from: "y", to: "packed", label: "then", weight: 2 })
      .updateNode("y", { subtitle: null })
      .moveNode("y", { before: "packed" })
      .removeEdge("y->packed")
      .removeNode("y")
      .apply({ op: "setMeta", changes: { ordered: true } });
    const inside: Node | null = m.node("paid");
  })
  .addNode({ id: "z", title: "Z", lane: "inputs" }, { edges: [{ from: "z", to: "packed" }] })
  .updateNode("z", { title: "Zed", details: null })
  .moveNode("z", { lane: null, index: 1 })
  .renameNode("z", "zed")
  .addEdge({ id: "e2", from: "zed", to: "paid", label: "back", details: "why", type: "flow" })
  .updateEdge("e2", { label: null })
  .removeEdge("e2")
  .addLane({ id: "late", kind: "after" }, { index: 0 })
  .updateLane("late", { title: "Late" })
  .moveLane("late", { index: 2 })
  .moveLane("late")
  .removeLane("late", { moveTo: "inputs" })
  .addGroup({ id: "ops", parent: "billing" })
  .updateGroup("ops", { title: "Ops" })
  .removeGroup("ops")
  .addConstraint({ type: "last", node: "packed" })
  .removeConstraint(0)
  .updateNode("paid", { pinned: true })
  .setMeta({ direction: "up", title: "New" })
  .removeNode("zed")
  .clearHistory()
  .setState("paid", { subtitle: 21.5, status: "on" })
  .setState("paid", { subtitle: null, status: null })
  .select("paid", { focus: true, animate: true, reveal: false, announce: true })
  .select(null)
  .mark(map.find("pai"))
  .mark(null)
  .settle();
const swapped: number = map.reorder({ dryRun: true });
const undone: boolean = map.undo();
const redone: boolean = map.redo();
const canUndo: boolean = map.canUndo && map.canRedo;
const current: string | null = map.nextMark(-1, { focus: true });
const open: boolean = map.toggleDetail(true);
// @ts-expect-error: edits return the map, not a revision
const notRev: number = map.updateNode("paid", {});
// @ts-expect-error: rev is read-only
map.rev = 3;
// @ts-expect-error: addEdge takes one edge
map.addEdge("a", "b");

// Deprecated in 0.5.0, still typed until 0.6.0.
const same: SavedBoard = map.export();
const advice: Suggestion[] = map.suggestions();
for (const s of advice) if (s.code === "lane") console.log(s.node);
map.connect("paid", "packed", { label: "x" }).disconnect({ from: "paid", to: "packed" }).pin("paid", { index: 0 }).unpin("paid").moveLane("inputs", 1);
const { swaps, layers }: { swaps: number; layers: number } = map.reorderAll({ dryRun: true });
const sheet: "open" | "peek" = map.openDetail(false);
map.batch((b: Batch) => b.addLane({ id: "extra" }));
map.load(board, { optimize: false });

// Events, with typed detail, from the instance.
map.addEventListener("change", e => {
  const detail: ChangeDetail = e.detail;
  const r: number = e.detail.rev;
  const d: Diff | null = e.detail.diff;
  const w: Finding[] = e.detail.warnings;
});
map.addEventListener("select", e => {
  const id: string | null = e.detail.id;
});
map.addEventListener("mark", e => {
  const detail: MarkDetail = e.detail;
  const ids: string[] = e.detail.ids;
});
map.addEventListener("other", (e: Event) => e.type);
const onSelect = (e: CustomEvent<{ id: string | null }>) => void e.detail.id;
map.addEventListener("select", onSelect);
map.removeEventListener("select", onSelect);
// @ts-expect-error: a select event carries an id, not a rev
map.addEventListener("select", e => e.detail.rev);
map.destroy();
const gone: boolean = map.destroyed;

// The element.
define();
define("board-map");
const element: AtlasMap = document.querySelector("atlas-map")!;
const instance: Atlas | undefined = document.querySelector("atlas-map")!.atlas;
document.querySelector("atlas-map")!.atlas?.select("paid");
const created: AtlasMap = document.createElement("atlas-map");
element.addEventListener("atlas-change", e => { const r: number = e.detail.rev; });
element.addEventListener("atlas-select", e => { const id: string | null = e.detail.id; });
element.addEventListener("atlas-mark", e => { const ids: string[] = e.detail.ids; });
element.addEventListener("atlas-error", e => { const errors: Finding[] = e.detail.errors; });
const attributes: string[] = AtlasMap.observedAttributes;
const whenReady: Promise<Atlas> = element.ready;
const failure: ErrorDetail | null = element.error;
const limited = new Atlas(document.createElement("div"), { historyLimit: 10, labels: { board: "Mapa", detail: "Detalle" } });
