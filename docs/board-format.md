# Board format (`atlas/1`)

A board is a plain JSON document. This page describes every field, how Atlas reads it, and the
errors and warnings it reports. `schema/atlas-board.schema.json` describes the same format as JSON
Schema (draft 2020-12) for editors and CI checks.

```json
{
  "format": "atlas/1",
  "meta": { "title": "Order lifecycle", "direction": "right", "selected": "paid" },
  "lanes": [
    { "id": "controls", "title": "Controls", "kind": "before" },
    { "id": "inputs", "title": "Inputs" },
    { "id": "outputs", "title": "Outputs" }
  ],
  "groups": [{ "id": "billing", "title": "Billing" }],
  "nodes": [
    { "id": "paid", "title": "Paid", "subtitle": "funds captured", "details": ["Card or transfer."],
      "lane": "inputs", "group": "billing", "type": "state" },
    { "id": "packed", "title": "Packed", "lane": "outputs" }
  ],
  "edges": [{ "from": "paid", "to": "packed", "label": "pick" }],
  "constraints": [{ "type": "first", "node": "paid" }]
}
```

Only `nodes` is really needed: `{ "nodes": [{ "id": "a" }] }` is a valid board.

## Top level

| Field | Type | Default | Meaning |
|---|---|---|---|
| `format` | `"atlas/1"` | `"atlas/1"` | Format and major version. Any other `atlas/N` is rejected. |
| `meta` | object | `{}` | Board-wide settings, below. |
| `lanes` | array | `[]` | Lanes and bands, in flow order. |
| `groups` | array | `[]` | Named sets of nodes that stay together. |
| `nodes` | array | `[]` | The nodes, in sketch order (see [Order](#order)). |
| `edges` | array | `[]` | Directed connections between nodes. |
| `constraints` | array | `[]` | Ordering rules inside a lane. |
| `nodeTypes`, `edgeTypes` | object | `{}` | Your own catalogues of types. `edgeTypes`, when present, is used to warn about undeclared edge types. |

Any other top-level field is kept untouched and written back by `toJSON()`, so a board can carry
your own data. Unknown fields inside `meta`, lanes, groups, nodes, edges and constraints are kept as
well.

## `meta`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `direction` | `"right"`, `"down"`, `"left"`, `"up"` | `"right"` | Where the flow goes: lanes follow each other in this direction. |
| `selected` | node id | none | Node selected when the board loads (the `selected` option or attribute wins). |
| `ordered` | boolean | `false` | Set to `true` by Atlas once it has tidied the board; from then on the node order is kept as it is. |
| `title`, `lang` | string | none | For your own use (the development viewer shows the title). Atlas does not render them. |

## Lanes and bands

```json
{ "id": "inputs", "title": "Inputs", "kind": "flow" }
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | Unique among lanes, groups and nodes. `unassigned` is reserved. |
| `title` | string | `""` | Heading of the lane. |
| `kind` | `"flow"`, `"before"`, `"after"` | `"flow"` | A flow lane, or a band before or after the flow. |

A **flow lane** is a column of the flow (a row when the direction is `down` or `up`). Flow lanes
follow each other in the order of the `lanes` array.

A **band** runs across the whole flow, before it (`"before"`: controls on top) or after it
(`"after"`: infrastructure at the bottom). A board has at most one band of each kind.

**Without any flow lane**, Atlas draws the lanes from the relations themselves (a layered
drawing): a node that feeds another goes to an earlier lane. Cycles are broken by a depth-first
search in document order, and the edge that closes a cycle is drawn as a backward edge.

**With flow lanes**, every node should declare its lane. A node without one goes to a visible
*Unassigned* lane at the end, with an `unassigned` warning. Atlas never guesses a lane from the
edges.

## Nodes

```json
{ "id": "paid", "title": "Paid", "subtitle": "funds captured", "details": ["Card or transfer."],
  "lane": "inputs", "group": "billing", "type": "state", "pinned": true }
```

| Field | Type | Meaning |
|---|---|---|
| `id` | id, required | Unique among lanes, groups and nodes. |
| `title` | string | Main text of the node; the id when missing. |
| `subtitle` | string | Second line. `setState()` can replace it at run time without changing the board. |
| `details` | array of strings | Shown in the detail panel as a list, up to 50 items. |
| `lane` | lane id | The lane or band the node belongs to. |
| `group` | group id | The group it belongs to. |
| `type` | string | Your own category. A value matching `[A-Za-z0-9_-]{1,32}` also adds the CSS part `node-<type>`. |
| `pinned` | `true` or `false` | `reorderAll()` leaves this node where it is. |

## Edges

```json
{ "id": "pick", "from": "paid", "to": "packed", "label": "pick", "details": "…", "type": "flow" }
```

| Field | Type | Meaning |
|---|---|---|
| `from`, `to` | node ids, required | Direction of the connection. |
| `id` | edge id | Optional. Without one, an edge gets `from->to`, then `from->to#1`, `#2`… for repeats. Allowed characters: letters, digits, `_ . : # > -`, up to 141. |
| `label` | string | Shown next to the connected node in the detail panel. |
| `details` | string | Kept in the board; the built-in panel does not show it yet. |
| `type` | string | Kept in the board. If `edgeTypes` is not empty and does not contain it, a warning is reported. |

Atlas classifies every edge by the order of the lanes, bands included (before band, flow lanes,
after band):

- **forward**: towards a later lane;
- **same lane**: between two nodes of one lane;
- **backward**: towards an earlier lane, drawn dashed.

Two edges with the same `from` and `to` share one wire (a `parallel` warning). An edge from a node
to itself is listed in the panel and not drawn (a `self` warning).

Only the wires of the selected node are drawn. That keeps any board readable, and because
corridors are sized for the busiest possible selection, selecting a node never moves anything.

## Groups

```json
{ "id": "billing", "title": "Billing", "parent": null }
```

| Field | Type | Meaning |
|---|---|---|
| `id` | id, required | Unique among lanes, groups and nodes. |
| `title` | string | Label of the box drawn behind the group's nodes. |
| `parent` | group id or `null` | Nesting, up to 6 levels; no cycles. |

The members of a group (and of its subgroups) stay next to each other inside each lane, and the
group is drawn as a labelled box behind them.

## Constraints

```json
[
  { "type": "before", "a": "paid", "b": "packed" },
  { "type": "first", "node": "paid" },
  { "type": "last", "node": "refunded" }
]
```

| Type | Fields | Meaning |
|---|---|---|
| `before` | `a`, `b` | `a` comes before `b` in their lane. Ignored, with a `cross-lane` warning, if they are in different lanes. |
| `first` | `node` | The node opens its lane. One per lane. |
| `last` | `node` | The node closes its lane. One per lane. |

Constraints that cannot all hold (a cycle of `before`, two `first` in a lane, a `before` against
a `first` or `last`) are errors that name the constraints involved. Nothing is broken silently.

## Order

The order of `nodes` is the **sketch**: inside each lane, nodes appear in the order they are
listed. Atlas keeps it, so a saved board reloads exactly as it was and an edit never reshuffles
what the reader already knows. Where a node goes is decided by, highest first:

1. its **lane**, as declared;
2. **constraints**: groups together, then `before`, `first` and `last`;
3. the **sketch**;
4. **relations**: inside each lane, the order with the fewest crossings. This applies when a board
   is tidied the first time, when `reorderAll()` runs, and when a new node chooses its gap;
5. **balance**: every flow lane spans as many rows as the longest one, and shorter lanes place
   their nodes next to the nodes they connect to, so wires run straight.

The order of `lanes` is the flow order. The order of `edges` never changes where nodes go (it can
break ties between equally good wire routes).

## Limits

| What | Limit |
|---|---|
| Document size (JSON text) | 512 KB |
| Nodes | 300 |
| Edges | 1,000 |
| Lanes | 40 |
| Groups | 100, nested up to 6 levels |
| Constraints | 500 |
| Details per node | 50 |
| Any text (title, subtitle, label, detail…) | 2,000 characters |

The same values are exported as `LIMITS`.

## Errors and warnings

`validate()` and `load()` report findings as `{ path, code, message }`. `path` points into the
document (`nodes[3].lane`, `edges[0].to`), `code` is stable and meant for programs, and `message`
is meant for people. Errors make a board unusable; warnings are drawn anyway and reported.

| Code | Kind | When |
|---|---|---|
| `type` | error | The input is not a JSON object (or JSON text of one), a list or object field has the wrong shape, or a field has the wrong type. |
| `too-large` | error | The JSON text is larger than 512 KB. |
| `json` | error | The text is not valid JSON. |
| `format` | error | `format` is not `atlas/<number>`. |
| `version` | error | The format version is not 1. |
| `enum` | error | A value is not one of the allowed ones (`direction`, `kind`, constraint `type`). |
| `id` | error | An id is not valid. |
| `duplicate` | error | An id is used twice, or an edge id repeats. |
| `reserved` | error | A lane is called `unassigned`. |
| `bands` | error | More than one band of a kind. |
| `missing` | error | A reference to a lane, group or node that does not exist. |
| `cycle` | error | Groups that contain themselves, or `before` constraints in a circle. |
| `depth` | error | Groups nested deeper than 6. |
| `conflict` | error | Constraints that cannot all hold. |
| `too-many` | error | A list is longer than its limit. |
| `too-long` | error | A text is longer than 2,000 characters. |
| `op`, `invalid` | error | An edit operation is unknown or incomplete (from `apply()` and the editing methods). |
| `fetch`, `load` | error | `<atlas-map>` could not fetch or load its board (only in its `atlas-error` event). |
| `unassigned` | warning | A node has no lane while flow lanes exist. |
| `self` | warning | An edge connects a node to itself. |
| `parallel` | warning | Two edges have the same `from` and `to`. |
| `unknown-type` | warning | An edge type is not in a non-empty `edgeTypes`. |
| `cross-lane` | warning | A `before` constraint relates nodes of different lanes. |

## Ids

Lane, group and node ids are 1 to 64 characters: letters, digits and `_ . : -`, starting with a
letter or digit. `__proto__`, `constructor` and `prototype` are refused. Lanes, groups and nodes
share one namespace: an id names exactly one thing.
