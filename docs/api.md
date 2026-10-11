# JavaScript API

Everything here is exported by `dist/atlas.js` (and set on `window.Atlas` by
`dist/atlas.global.js`). TypeScript declarations are in `types/atlas.d.ts`.

- [`Atlas`](#atlas): the engine, rendered into any element
- [`<atlas-map>`](#atlas-map): the custom element
- [Events](#events)
- [Pure functions](#pure-functions): validation, edit operations, placement
- [Stability](#stability): what SemVer covers

## `Atlas`

```js
const map = new Atlas(element, options);
```

Renders a board into `element` (inside a shadow root by default) and keeps it in sync with every
edit. `Atlas` is an `EventTarget`.

### Options

Options left out or set to `undefined` keep their defaults.

| Option | Type | Default | |
|---|---|---|---|
| `document` | object or JSON text | none | The board to load. Without it the map starts empty; call `load()` later. |
| `selected` | node id | `meta.selected` | Node selected at start. |
| `panel` | `"auto"` or `false` | `"auto"` | `false` hides the detail panel. |
| `labels` | object | English | Interface texts: `{ incoming, outgoing, unassigned, selfLoop, board, detail }`. `board` names the board for screen readers when it has no `meta.title`; `detail` names the detail panel. |
| `renderNode` | function | none | `(node, button, live) => void`: replaces the content of each node. See [Custom node content](#custom-node-content). |
| `animate` | boolean | `true` | Trace wires when a node is selected. |
| `historyLimit` | number | `200` | Most undo steps kept. |
| `shadow` | boolean | `true` | Render into a shadow root. With `false` Atlas renders into the element itself and its stylesheet applies to the whole page; keep the default unless you need to. |

The default labels are `Incoming`, `Outgoing`, `Unassigned`, `Feeds back into itself`, `Map` (board)
and `Detail` (detail). A page in
another language passes its own:

```js
new Atlas(el, { document: board, labels: { incoming: "Entradas", outgoing: "Salidas", unassigned: "Sin carril", selfLoop: "Vuelve sobre sí misma" } });
```

### Reading

| Member | Returns | |
|---|---|---|
| `toJSON()` | board | The board as it should be saved: canonical, with the current order as its sketch and unknown fields restored; loading it again draws the same map. `export()` is the same. |
| `node(id)` | node or `null` | A copy of the node. |
| `edges(id)` | edges | Copies of every edge that starts or ends at `id`. |
| `find(text)` | ids | Nodes whose title, subtitle or details contain `text`, ignoring case. |
| `suggestions()` | `{ node?, code, message }[]` | Advice, never applied: nodes most of whose edges run backwards (`lane`), and nodes without a lane (`unassigned`). |
| `selected` | id or `null` | The selected node. |
| `rev` | number | Revision, increased by every load, edit, undo and redo. |
| `warnings` | findings | Warnings of the current board (see [Board format](board-format.md#errors-and-warnings)). |
| `canUndo`, `canRedo` | boolean | |
| `labels` | object | The interface texts in use. Changes show at the next redraw (a selection or an edit). |

### Loading and editing

Every edit validates the whole board before it is applied. If the result would be invalid, the
method throws an [`AtlasError`](#atlaserror) and nothing changes. Each successful call is one undo
step, animates the change and fires `change`. Editing methods return the new revision.

| Method | |
|---|---|
| `load(board, { optimize, selected })` | Replaces the board and clears the history. A board without `meta.ordered: true` is tidied once (fewest crossings); `optimize: true` forces that, `false` prevents it. Returns the map. |
| `addNode(node, { index, edges })` | Adds a node with its optional `edges`. Without `index` it enters the gap of its lane with the fewest crossings; with `index` it becomes the `index`-th node of its lane, or goes to the nearest gap that keeps the lane's groups and constraints as they are. Existing nodes never change places. |
| `updateNode(id, changes)` | Merges `changes` into the node. A field set to `null` is removed. The id cannot change here. |
| `moveNode(id, { lane, index })` | Moves a node to another lane (`lane: null` removes its lane) and/or position. |
| `removeNode(id)` | Removes a node with its edges and constraints. |
| `renameNode(from, to)` | Changes an id and every reference to it (edges, derived edge ids, constraints, `meta.selected`). Nothing moves. |
| `connect(from, to, { id, label, details, type })` | Adds an edge. |
| `updateEdge(id, changes)` | Merges `changes` into an edge (`null` removes a field). |
| `disconnect(id)` / `disconnect({ from, to })` | Removes an edge by id, or the first edge from `from` to `to`; throws if there is none. |
| `addLane(lane, { index })`, `updateLane(id, changes)`, `moveLane(id, index)` | Lanes and bands. |
| `removeLane(id, { moveTo })` | Removes a lane. Its nodes move to `moveTo`, or lose their lane. |
| `addGroup(group)`, `updateGroup(id, changes)`, `removeGroup(id)` | Removing a group moves its members and subgroups to its parent. |
| `addConstraint(constraint)`, `removeConstraint(index)` | See [Constraints](board-format.md#constraints). |
| `pin(id, { lane, index })`, `unpin(id)` | Optionally moves the node, then marks it `pinned` so `reorderAll()` leaves it in place. |
| `setMeta(changes)` | Merges into `meta` (for example `{ direction: "down" }`). |
| `reorderAll({ dryRun })` | Reorders every lane for the fewest crossings, keeping pinned nodes in place. Returns `{ swaps }`, the number of node pairs that change places; with `dryRun: true` it only counts them. |
| `batch(fn)` | Runs several edits as one undo step: `map.batch(m => { m.addNode(…); m.connect(…); })`. The batch object offers `addNode`, `connect`, `removeNode`, `updateNode`, `moveNode`, `updateEdge`, `addLane`, `updateLane`, `addGroup`, `updateGroup`, `addConstraint`, `setMeta`, `apply` and `disconnect` (which takes an edge id only); each returns the batch, so calls chain. |
| `apply(ops)` | Applies raw [operations](#operations) as one step. |
| `undo()`, `redo()` | Return `false` when there is nothing to undo or redo. Undo restores the exact previous document. The history keeps 200 steps (`historyLimit`). An edit that changes nothing is not a step. |
| `clearHistory()` | Forgets every undo and redo step, for example once the board is saved. |

### Viewing

| Method | |
|---|---|
| `select(id, { focus, animate })` | Selects a node (or clears the selection with `null`), draws its wires and fills the panel. `focus` (default `true`) moves keyboard focus to it. |
| `setState(id, { subtitle, status })` | Live content that never moves anything: replaces the subtitle shown (not the one in the board) and sets a status. `status` must match `[a-z0-9_-]{1,32}` and becomes the CSS part `status-<value>`. `null` clears either. |
| `settle()` | Finishes running transitions at once and redraws the wires. Useful before measuring or taking a screenshot. |
| `destroy()` | Stops observing, cancels animations and empties its root (the shadow root, or the element with `shadow: false`). Final: `destroyed` turns true and the instance draws nothing more. |

### Custom node content

By default a node shows its title and subtitle. `renderNode` replaces that:

```js
new Atlas(el, {
  document: board,
  renderNode(node, button, live) {
    const title = document.createElement("strong");
    title.textContent = node.title ?? node.id;          // always textContent, never innerHTML
    const value = document.createElement("span");
    value.textContent = live.subtitle ?? node.subtitle ?? "";
    button.replaceChildren(title, value);
  },
});
```

It receives a copy of the node, the node's `<button>` and the live state set by `setState`, and is
called again whenever the node or its live state changes. Board text comes from the document, so
insert it with `textContent`.

## `<atlas-map>`

Importing either build registers the element. It is a thin wrapper around `Atlas`.

```html
<atlas-map src="board.json" selected="api" theme="dark"></atlas-map>
```

| Attribute | |
|---|---|
| `src` | URL of the board. Same origin only, unless `cross-origin` is present. Changing it loads the new board. |
| `selected` | Node to select. Changing it selects another node. |
| `panel` | `panel="false"` hides the detail panel (read when the element connects). |
| `cross-origin` | Allows `src` on another origin. |
| `theme` | `light` or `dark` forces a theme; without it the system preference applies. |

Instead of `src`, the board can be inline:
`<atlas-map><script type="application/json">{ … }</script></atlas-map>`.

The engine is the element's `atlas` property, available once the element is connected:

```js
const el = document.querySelector("atlas-map");
el.atlas.addNode({ id: "cache", title: "Cache", lane: "services" });
```

`el.ready` is a promise for the board on its way: it settles with the engine once the board is on
screen, or rejects with `{ errors }`. `el.error` keeps the last failure (null once a board is on
screen). Both work whenever your code runs, even after the events fired:

```js
el.ready.then(map => map.select("api"), ({ errors }) => console.error(errors));
```

When `src` changes before the previous board arrived, only the latest one is shown.

`define(name)` registers the element under another name (`define("my-map")`). Both builds call
`define()` with the default name when `customElements` exists. Removing the element from the page
does not destroy its engine; call `el.atlas.destroy()` when you are done with it. A destroyed
element that is inserted again gets a new engine and loads its board again.

## Events

| Event on `Atlas` | On the host element | `detail` |
|---|---|---|
| `change` | `atlas-change` | `{ rev, diff, warnings }`; `diff` is `null` after `load()` |
| `select` | `atlas-select` | `{ id }`; `id` is `null` when the selection is cleared |
| | `atlas-error` (`<atlas-map>` only) | `{ errors: [{ path, code, message }] }` |

Events on the host element bubble and cross shadow boundaries (`composed`).

`diff` says what changed by id: `{ nodes, edges, lanes, groups }`, each with `added`, `removed` and
`changed` arrays, plus booleans `order`, `meta` and `constraints`.

## Pure functions

These work on plain data, need no DOM and run in Node.

| Function | |
|---|---|
| `parse(text)` | Parses JSON text, refusing documents over 512 KB and dropping `__proto__`, `constructor` and `prototype` keys. |
| `normalize(input)` | Turns a board (object or text) into the canonical model: every list present, every edge with an id, unknown top-level fields in `extra`. It takes a board as saved, not a model: to go back from a model to a board, use `serialize`. |
| `validate(model)` | `{ ok, errors, warnings }` for a canonical model. |
| `load(input)` | `normalize` then `validate`; returns `{ model, warnings }` or throws `AtlasError` with every error. |
| `apply(model, ops)` | Applies operations atomically to a copy: returns `{ model, warnings }` or throws `AtlasError` and leaves `model` untouched. |
| `serialize(model)` | The document to save. |
| `diff(before, after)` | What changed between two models (the `diff` of `change` events). |

`FORMAT` is `"atlas/1"`, `LIMITS` holds the [limits](board-format.md#limits) and `VERSION` (in the
builds) is the version of Atlas.

### Operations

An operation is plain data, so a sequence can be stored, sent and replayed. Every editing method
of `Atlas` is one or more of these.

| `op` | Fields |
|---|---|
| `addNode` | `node`, and one of `index` (position in its lane), `before` or `after` (a node id) |
| `updateNode` | `id`, `changes` |
| `moveNode` | `id`, `lane` (a lane id, or `null` for none), and one of `index`, `before`, `after` |
| `removeNode` | `id` |
| `renameNode` | `from`, `to` |
| `addEdge` | `edge` |
| `updateEdge` | `id`, `changes` |
| `removeEdge` | `id` |
| `addLane` | `lane`, `index` |
| `updateLane` | `id`, `changes` |
| `moveLane` | `id`, `index` |
| `removeLane` | `id`, `moveTo` |
| `addGroup` | `group` |
| `updateGroup` | `id`, `changes` |
| `removeGroup` | `id` |
| `addConstraint` | `constraint` |
| `removeConstraint` | `index` |
| `setMeta` | `changes` |

```js
const { model } = apply(load(board).model, [
  { op: "addNode", node: { id: "cache", lane: "services" }, after: "api" },
  { op: "addEdge", edge: { from: "api", to: "cache", label: "reads" } },
]);
```

### `AtlasError`

Thrown by `parse`, `normalize` and `load` (when given invalid text or an invalid board), `apply` and
every editing method. `error.errors` lists every problem as
`{ path, code, message }`; `error.message` joins them. The codes are listed in
[Board format](board-format.md#errors-and-warnings).

### Placement and routing (experimental)

`layout(model, { optimize })`, `bestInsertion(model, nodeId, near)`, `inversions(before, after)`,
`route(selected, edges, geometry)`, `demand(…)` and `ROUTE` expose the engine's internals: where
every node goes, and how the wires of one selection run through the corridors. They are useful for
tests and tools, but their shapes may change in any minor release.

## Stability

Atlas follows [Semantic Versioning](https://semver.org/). While the version is 0.x, a minor
release (0.3.0) may break the public API and a patch release (0.2.1) never does. From 1.0.0 on,
only a major release may break it.

**Public API:** the `atlas/1` board format and its schema, everything documented on this page
except the experimental functions, the `<atlas-map>` attributes and events, the `--atlas-*` CSS
variables, the CSS parts and the package's `exports`.

**Not public:** members whose names start with `_`, the experimental functions, the structure and
class names of the rendered DOM, and the default colours, sizes and animation timings.
