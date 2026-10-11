// Type-checks the public declarations by using them as a consumer would. Nothing here runs.
// "@rpairo/atlas" resolves through package.json "exports" (self-reference), as for a consumer.
//
//   npx --yes -p typescript@7.0.2 tsc -p test/types

import {
  Atlas, AtlasMap, AtlasError, define, FORMAT, LIMITS, VERSION,
  parse, normalize, validate, load, apply, serialize, diff,
  layout, bestInsertion, inversions, route, demand, ROUTE,
} from "@rpairo/atlas";
import type {
  Board, Model, Node, Edge, Constraint, Operation, OperationName, Finding, Diff, SavedBoard,
  ChangeDetail, ErrorDetail, Suggestion, Batch, Layout, RouteResult,
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

// The model functions.
const fmt: "atlas/1" = FORMAT;
const maxNodes: number = LIMITS.nodes;
// @ts-expect-error: LIMITS is read-only
LIMITS.nodes = 1;
const version: string = VERSION;
const raw: unknown = parse('{"nodes":[]}');
const model: Model = normalize(board);
const fromText: Model = normalize('{"nodes":[]}');
const check = validate(model);
const okFlag: boolean = check.ok;
const firstError: Finding | undefined = check.errors[0];
const loaded = load(board);
const edgeId: string = loaded.model.edges[0].id;
const direction: "right" | "down" | "left" | "up" = loaded.model.meta.direction;
const extra: Record<string, unknown> = loaded.model.extra;
const next = apply(loaded.model, [
  { op: "addNode", node: { id: "x", lane: "inputs" }, after: "paid" },
  { op: "setMeta", changes: { title: null, direction: "left" } },
]);
const saved: SavedBoard = serialize(next.model);
const savedEdgeId: string = saved.edges[0].id;
const changes: Diff = diff(loaded.model, next.model);
const added: string[] = changes.nodes.added;
const reordered: boolean = changes.order;
// @ts-expect-error: a model is not a board (normalize would nest its `extra`)
normalize(loaded.model);

try {
  load("{");
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
  document: board,
  selected: "paid",
  panel: false,
  labels: { incoming: "Entradas" },
  renderNode(node: Node, button: HTMLButtonElement, live) {
    button.textContent = live.subtitle ?? node.title ?? node.id;
    if (live.status) button.dataset.status = live.status;
  },
  animate: false,
  shadow: true,
});
// @ts-expect-error: panel is "auto" or false
new Atlas(host, { panel: true });
// @ts-expect-error: the host is an element
new Atlas("map");

const root: ShadowRoot | HTMLElement = map.root;
const label: string = map.labels.selfLoop;
const animate: boolean = map.options.animate;
const json: SavedBoard = map.toJSON();
const same: SavedBoard = map.export();
const rev: number = map.rev;
const selected: string | null = map.selected;
const warnings: Finding[] = map.warnings;
const node: Node | null = map.node("paid");
const wireIds: string[] = map.edges("paid").map(e => e.id);
const found: string[] = map.find("pai");
const advice: Suggestion[] = map.suggestions();
for (const s of advice) if (s.code === "lane") console.log(s.node);
const chained: Atlas = map.load(board, { optimize: false, selected: null }).load('{"nodes":[]}');

const revs: number[] = [
  map.apply({ op: "removeEdge", id: "paid->packed" }),
  map.apply([{ op: "addEdge", edge: { from: "paid", to: "packed" } }]),
  map.batch((b: Batch) => {
    b.addNode({ id: "y", lane: "outputs" }, { index: 0, edges: [{ from: "paid", to: "y" }] })
      .connect("y", "packed", { label: "then", weight: 2 })
      .updateNode("y", { subtitle: null })
      .moveNode("y", { before: "packed" })
      .disconnect("y->packed")
      .removeNode("y")
      .apply({ op: "setMeta", changes: { ordered: true } });
  }),
  map.addNode({ id: "z", title: "Z", lane: "inputs" }, { edges: [{ from: "z", to: "packed" }] }),
  map.updateNode("z", { title: "Zed", details: null }),
  map.moveNode("z", { lane: null, index: 1 }),
  map.renameNode("z", "zed"),
  map.connect("zed", "paid", { id: "e2", label: "back", details: "why", type: "flow" }),
  map.updateEdge("e2", { label: null }),
  map.disconnect("e2"),
  map.disconnect({ from: "paid", to: "packed" }),
  map.addLane({ id: "late", kind: "after" }, { index: 0 }),
  map.updateLane("late", { title: "Late" }),
  map.moveLane("late", 2),
  map.moveLane("late"),
  map.removeLane("late", { moveTo: "inputs" }),
  map.addGroup({ id: "ops", parent: "billing" }),
  map.removeGroup("ops"),
  map.addConstraint({ type: "last", node: "packed" }),
  map.removeConstraint(0),
  map.pin("paid", { lane: "inputs", index: 0 }),
  map.unpin("paid"),
  map.setMeta({ direction: "up", title: "New" }),
  map.removeNode("zed"),
];
const { swaps }: { swaps: number } = map.reorderAll({ dryRun: true });
const undone: boolean = map.undo();
const redone: boolean = map.redo();
const canUndo: boolean = map.canUndo && map.canRedo;
map.setState("paid", { subtitle: 21.5, status: "on" });
map.setState("paid", { subtitle: null, status: null });
map.select("paid", { focus: false, animate: true });
map.select(null);
map.settle();
map.destroy();
// @ts-expect-error: edits return the revision, not a boolean
const notBoolean: boolean = map.updateNode("paid", {});
// @ts-expect-error: rev is read-only
map.rev = 3;
// @ts-expect-error: connect takes the ends separately
map.connect({ from: "a", to: "b" });

// Events, with typed detail.
map.addEventListener("change", e => {
  const detail: ChangeDetail = e.detail;
  const r: number = e.detail.rev;
  const d: Diff | null = e.detail.diff;
  const w: Finding[] = e.detail.warnings;
});
map.addEventListener("select", e => {
  const id: string | null = e.detail.id;
});
map.addEventListener("other", (e: Event) => e.type);
const onSelect = (e: CustomEvent<{ id: string | null }>) => void e.detail.id;
map.addEventListener("select", onSelect);
map.removeEventListener("select", onSelect);
// @ts-expect-error: a select event carries an id, not a rev
map.addEventListener("select", e => e.detail.rev);

// The element.
define();
define("board-map");
const element: AtlasMap = document.querySelector("atlas-map")!;
const instance: Atlas | undefined = document.querySelector("atlas-map")!.atlas;
document.querySelector("atlas-map")!.atlas?.select("paid");
const created: AtlasMap = document.createElement("atlas-map");
element.addEventListener("atlas-change", e => { const r: number = e.detail.rev; });
element.addEventListener("atlas-select", e => { const id: string | null = e.detail.id; });
element.addEventListener("atlas-error", e => { const errors: Finding[] = e.detail.errors; });
host.addEventListener("atlas-change", e => e.detail.diff?.nodes.changed);
const attributes: string[] = AtlasMap.observedAttributes;
const whenReady: Promise<Atlas> = element.ready;
const failure: ErrorDetail | null = element.error;
const gone: boolean = map.destroyed;
map.updateGroup("billing", { title: "Billing" });
map.clearHistory();
map.batch(b => b.addLane({ id: "extra", title: "Extra" }).setMeta({ title: "Shop" }).addConstraint({ type: "first", node: "paid" }));
const limited = new Atlas(document.createElement("div"), { historyLimit: 10, labels: { board: "Mapa", detail: "Detalle" } });

// The experimental internals.
const placement: Layout = layout(loaded.model, { optimize: true });
const lanesInOrder: string[] = placement.flow.map(l => l.id);
const order: string[] | undefined = placement.order.get("inputs");
const gap: number = bestInsertion(loaded.model, "paid");
const moved: number = inversions(placement, layout(loaded.model));
const need = demand(["a", "b"], [{ id: "a->b", from: "a", to: "b" }], () => ({ kind: "col", col: 0 }), () => ({ u: 0, v: 0.5 }), { ct: 0, cb: 1 });
const tracks: number | undefined = need.tracks.get("g1");
const routed: RouteResult = route("a", [{ id: "a->b", from: "a", to: "b" }], {
  boxes: new Map([["a", { l: 0, r: 10, t: 0, b: 10 }], ["b", { l: 40, r: 50, t: 0, b: 10 }]]),
  corridors: { g0: { a: -20, b: 0 }, g1: { a: 10, b: 40 }, g2: { a: 50, b: 70 }, ct: { a: -20, b: 0 }, cb: { a: 10, b: 30 } },
  place: id => ({ kind: "col", col: id === "a" ? 0 : 1 }),
});
const firstPoint: number | undefined = routed.wires[0]?.points[0]?.u;
const radius: number = ROUTE.radius;
