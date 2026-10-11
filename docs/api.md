# JavaScript API

Everything here is exported by `dist/atlas.js` (and set on `window.Atlas` by
`dist/atlas.global.js`). TypeScript declarations are in `types/atlas.d.ts`.

- [`Atlas`](#atlas): the live map, rendered into any element
- [`<atlas-map>`](#atlas-map): the custom element
- [Events](#events)
- [Pure functions](#pure-functions): a board in, a board out
- [Deprecated](#deprecated): old names and what replaces them
- [Stability](#stability): what SemVer covers

## `Atlas`

```js
const map = new Atlas(element, options).load(board);
```

Renders a board into `element` (inside a shadow root by default) and keeps it in sync with every
edit. `Atlas` is an `EventTarget`. Every edit returns the map, so edits chain:

```js
map.addNode({ id: "cache", lane: "services" }).addEdge({ from: "api", to: "cache" }).select("cache");
```

### Options

Options left out or set to `undefined` keep their defaults.

| Option | Type | Default | |
|---|---|---|---|
| `panel` | `"auto"`, `"side"`, `"below"`, `"sheet"` or `"none"` | `"auto"` | Where the detail goes: by the room available (see [How the map fits its box](theming-and-layout.md#how-the-map-fits-its-box)), forced, or nowhere. |
| `labels` | object | English | Interface texts, below. |
| `renderNode` | function | none | `(node, button, live) => void`: replaces the content of each node. See [Custom node content](#custom-node-content). |
| `animate` | boolean | `true` | Motion: edits move nodes into place, wires trace when a node is selected, the sheet folds smoothly. `false` turns all of it off. |
| `historyLimit` | number | `200` | Most undo steps kept. |
| `headingLevel` | 1–6 | `2` | Heading level of the lane titles and of the detail's title; "Incoming" and "Outgoing" go one below. Set it so the map fits the page's outline (under an `h2`, use `3`). |
| `shadow` | boolean | `true` | Render into a shadow root. With `false` Atlas renders into the element itself and its stylesheet applies to the whole page; keep the default unless you need to. |

#### Labels

| Label | Default | |
|---|---|---|
| `incoming`, `outgoing` | `Incoming`, `Outgoing` | Headings of the detail's connections, and the sheet's counts. |
| `unassigned` | `Unassigned` | The lane of nodes without one. |
| `selfLoop` | `Feeds back into itself` | Said and shown for a node with an edge to itself. |
| `board` | `Map` | The board's accessible name when it has no `meta.title`. |
| `detail` | `Detail` | The detail panel's accessible name. |
| `summary` | none | What a selection says, with `{title}`, `{incoming}`, `{outgoing}`: `"{title}: {incoming} entradas, {outgoing} salidas"`. Without it: "Triage: 5 incoming, 2 outgoing", built from `incoming` and `outgoing`. |
| `inStep`, `outStep` | `Incoming {n} of {total} into {hub}`, `Outgoing {n} of {total} from {hub}` | How a neighbour of the selection is described to screen readers ([keyboard steps](accessibility.md#keyboard)). |
| `noneIn`, `noneOut`, `noneAll` | `{hub}: no incoming connections` (and so on) | Said when a keyboard step finds nothing that way. |
| `cleared` | `Selection cleared` | Said when Escape clears the selection. |
| `keys` | a sentence | The board's description: the keys it takes. |
| `markStep` | `{n} of {total}: {title}` | Said by `nextMark()` when focus stays outside the map. |
| `marked` | `Match {n} of {total}` | How a marked node is described to screen readers. |

A page in another language passes its own. Templates make whole sentences translatable:

```js
new Atlas(el, { labels: {
  incoming: "Entradas", outgoing: "Salidas", unassigned: "Sin carril", selfLoop: "Vuelve sobre sí misma",
  summary: "{title}: {incoming} entradas, {outgoing} salidas",
  inStep: "Entrada {n} de {total} hacia {hub}", outStep: "Salida {n} de {total} desde {hub}",
} }).load(board);
```

### Reading

Reading members return copies. Inside `batch()`, `toJSON()`, `node()`, `edges()` and `find()` read
the batch's working copy; the other members describe the map as drawn.

| Member | Returns | |
|---|---|---|
| `toJSON()` | board | The board as it should be saved: canonical, with the current order as its sketch and unknown fields restored; loading it again draws the same map. |
| `node(id)` | node or `null` | A copy of the node. |
| `edges(id)` | edges | Copies of every edge that starts or ends at `id`. |
| `find(text)` | ids | Nodes whose title, subtitle (the live one too) or details contain `text`, ignoring case and accents, in reading order. Blank text finds nothing. |
| `selected` | id or `null` | The selected node. |
| `marked`, `currentMark` | ids, id or `null` | The marked nodes in reading order, and the current one (see `mark()`). |
| `rev` | number | Revision, increased by every load, edit, undo and redo. |
| `warnings` | findings | Warnings of the current board and of its placement (see [Board format](board-format.md#errors-and-warnings)). |
| `canUndo`, `canRedo` | boolean | |
| `labels` | object | The interface texts in use (read-only: pass `labels` to the constructor). |

### Loading and editing

Every edit validates the whole board before it is applied. If the result would be invalid, the
method throws an [`AtlasError`](#atlaserror) and nothing changes. Each successful edit is one undo
step, animates the change, fires `change` and returns the map; `reorder()`, `undo()` and `redo()`
return what the table says.

| Method | |
|---|---|
| `load(board, { reorder, selected })` | Replaces the board (object or JSON text) and clears the history. A board without `meta.ordered: true` is tidied once (fewest crossings); `reorder: true` forces that, `false` prevents it. On a board without flow lanes it saves each node's column in `layer` ([Nodes](board-format.md#nodes)), as every edit does. `selected` (default `meta.selected`) is selected without scrolling. |
| `addNode(node, { index, before, after, edges })` | Adds a node with its optional `edges`. With `before` or `after` (a node id) it goes next to that node. Otherwise, without `index` it enters the gap of its lane with the fewest crossings (counting its `edges`); with `index` it becomes the `index`-th node of its lane, or goes to the nearest gap that keeps the lane's groups and constraints as they are. Existing nodes never change places. |
| `updateNode(id, changes)` | Merges `changes` into the node. A field set to `null` is removed. The id cannot change here. |
| `moveNode(id, { lane, index, before, after })` | Moves a node to another lane (`lane: null` removes its lane) and/or position: `index` among the nodes of its lane, or next to the node named by `before` or `after`. |
| `removeNode(id)` | Removes a node with its edges and constraints. |
| `renameNode(from, to)` | Changes an id and every reference to it (edges, derived edge ids, constraints, `meta.selected`). Nothing moves: the node keeps its element, live state, selection and marks, also when undo, redo, `apply()` or `batch()` renames it. |
| `addEdge(edge)` | Adds an edge: `{ from, to, label, details, type }`. Without an `id` it gets `from->to` (`#2`, `#3` for repeats). |
| `updateEdge(id, changes)`, `removeEdge(id)` | Edges by id (`edges(nodeId)` lists them). |
| `addLane(lane, { index })`, `updateLane(id, changes)`, `moveLane(id, { index })` | Lanes and bands. |
| `removeLane(id, { moveTo })` | Removes a lane. Its nodes move to `moveTo`, or lose their lane. |
| `addGroup(group)`, `updateGroup(id, changes)`, `removeGroup(id)` | Removing a group moves its members and subgroups to its parent. |
| `addConstraint(constraint)`, `removeConstraint(index)` | See [Constraints](board-format.md#constraints). |
| `setMeta(changes)` | Merges into `meta` (for example `{ direction: "down" }`). |
| `apply(ops)` | Applies raw [operations](#operations) as one step. |
| `batch(fn)` | Makes the edits inside `fn` one undo step and one redraw: `map.batch(m => m.addNode(…).addEdge(…).select(…))`. `fn` receives the map itself; `select()`, `mark()` and `setState()` called inside run when the batch ends. An error inside leaves the board as it was; inside another batch, it undoes only its own part. `load()`, `undo()`, `redo()` and `reorder()` throw inside. |
| `reorder({ dryRun })` | Reorders every lane for the fewest crossings as one step, keeping pinned nodes (`pinned: true`) in place; without flow lanes it also lays the columns out afresh from the edges (pinned nodes keep theirs where the edges allow). Returns how many pairs of nodes change order. With `dryRun: true` it only counts them. |
| `undo()`, `redo()` | Return `false` when there is nothing to undo or redo. Undo restores the exact previous document. An edit that changes nothing is not a step. |
| `clearHistory()` | Forgets every undo and redo step, for example once the board is saved. |

### Viewing

None of these is an edit: they are not undoable, not saved, and return the map unless stated.

| Method | |
|---|---|
| `select(id, { focus, animate, reveal, announce })` | Selects a node (or clears the selection with `null`), draws its wires and fills the panel. `reveal` (default `true`) scrolls it into view, clear of the detail sheet; `focus` (default `false`) moves keyboard focus to it; `announce` (default `false`) makes screen readers say its summary, as a person's selection does. An unknown id changes nothing. |
| `mark(ids)` | Marks nodes, for example the results of a search: `map.mark(map.find(text))`. They keep their look (a fill and a dot) while every other node steps back. Unknown ids are ignored; `null` or `[]` clears. Marks follow renames, leave with removed nodes, are cleared by `load()` and never change the selection. Atlas does not re-run a search after edits: re-run `find()` on `change` for live results. |
| `nextMark(step, { focus })` | Makes the next mark (`step` 1, the default) or the previous one (`-1`) current, in reading order, wrapping: it scrolls into view and takes the map's tab stop (Tab from a search box lands on it); with `focus: true` it also takes focus. Never selects. Returns its id, or `null` without marks. |
| `toggleDetail(force)` | Opens (`true`), folds (`false`) or toggles the detail when it is a sheet, keeping the selected node in view above it. Returns whether it is open. |
| `setState(id, { subtitle, status })` | Live content that never moves anything: replaces the subtitle shown (not the one in the board) and sets a status. `status` must match `[a-z0-9_-]{1,32}` (an `AtlasError` otherwise) and becomes the CSS part `status-<value>`. `null` clears either. Unknown ids are ignored. |
| `settle()` | Finishes running motion at once and redraws the wires. Useful before measuring or taking a screenshot. |
| `destroy()` | Stops observing, cancels animations and empties its root (the shadow root, or the element with `shadow: false`). Final: `destroyed` turns true and every later call does nothing. Returns nothing. |

### Custom node content

By default a node shows its title and subtitle. `renderNode` replaces that:

```js
new Atlas(el, {
  renderNode(node, button, live) {
    const title = document.createElement("strong");
    title.textContent = node.title ?? node.id;          // always textContent, never innerHTML
    const value = document.createElement("span");
    value.textContent = live.subtitle ?? node.subtitle ?? "";
    button.replaceChildren(title, value);
  },
}).load(board);
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
| `selected` | Node to select. Changing it selects another node; removing it clears the selection. |
| `panel` | As the option: `auto` (or absent), `side`, `below`, `sheet` or `none`. Changing it moves the detail. |
| `cross-origin` | Allows `src` on another origin. |
| `theme` | `light` or `dark` forces a theme; without it the system preference applies. |

Instead of `src`, the board can be inline:
`<atlas-map><script type="application/json">{ … }</script></atlas-map>`.

The map is the element's `atlas` property, available once the element is connected:

```js
const el = document.querySelector("atlas-map");
el.atlas.addNode({ id: "cache", title: "Cache", lane: "services" });
```

`el.ready` is a promise for the board on its way: it settles with the map once the board is on
screen, or rejects with `{ errors }`. It works whenever your code runs, even after the events fired:

```js
el.ready.then(map => map.select("api"), ({ errors }) => console.error(errors));
```

When `src` changes before the previous board arrived, only the latest one is shown.

`define(name)` registers the element under another name (`define("my-map")`). Both builds call
`define()` with the default name when `customElements` exists. Removing the element from the page
does not destroy its map; call `el.atlas.destroy()` when you are done with it. A destroyed
element that is inserted again gets a new map and loads its board again.

## Events

| Event on `Atlas` | On `<atlas-map>` | `detail` |
|---|---|---|
| `change` | `atlas-change` | `{ rev, diff, warnings }`; `diff` is `null` after `load()` |
| `select` | `atlas-select` | `{ id }`; `id` is `null` when the selection is cleared |
| `mark` | `atlas-mark` | `{ ids, current }`: the marks and the current one, when either changes (by `mark()`, `nextMark()`, or an edit or `load()` that renames, removes or clears marked nodes) |
| | `atlas-error` | `{ errors: [{ path, code, message }] }`: a board that did not load |

Listen on the map (`map.addEventListener("select", …)`). `<atlas-map>` sends the map's events on
from the element, bubbling and crossing shadow boundaries (`composed`); a plain host element gets no
events. Add listeners before `load()` to hear its `change` and `select`.

`diff` says what changed by id: `{ nodes, edges, lanes, groups }`, each with `added`, `removed` and
`changed` arrays, plus booleans `order`, `meta` and `constraints`. A node whose saved `layer`
changed is listed under `changed`.

## Pure functions

These take a board (an object or JSON text) and return plain data. They need no DOM and run in
Node, for tools that check or edit boards without drawing them.

| Function | |
|---|---|
| `validate(board)` | `{ ok, errors, warnings }`: the findings Atlas would report. It never throws, also for text that is not JSON or a board of the wrong shape. |
| `apply(board, ops)` | Applies [operations](#operations) as one step and returns the edited board, canonical, with the columns of a board without flow lanes saved in `layer` as Atlas saves them. It does not reorder: Atlas tidies a board without `meta.ordered` when it loads it. The input is not changed. Throws `AtlasError` when the board or an operation is invalid. |
| `diff(before, after)` | What changed between two boards, by id (the `diff` of `change` events). |

`FORMAT` is `"atlas/1"`, `LIMITS` holds the [limits](board-format.md#limits) and `VERSION` (in the
builds) is the version of Atlas.

```js
import { validate, apply } from "@rpairo/atlas";

const { ok, errors } = validate(text);
const saved = apply(text, [
  { op: "addNode", node: { id: "cache", lane: "services" }, after: "api" },
  { op: "addEdge", edge: { from: "api", to: "cache", label: "reads" } },
]);
```

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

### `AtlasError`

Thrown by `apply()`, `load()` and every editing method when the board or the edit is invalid, by
`setState()` for a status that cannot be a part name, and by the methods that cannot run inside
`batch()`. `error.errors` lists every problem as `{ path, code, message }`; `error.message` joins
them. The codes are listed in [Board format](board-format.md#errors-and-warnings).

## Deprecated

These still work in 0.5, print one `console.warn` the first time (a CSS variable cannot), and go in
0.6.0.

| Deprecated | Use instead |
|---|---|
| `new Atlas(el, { document, selected })` | `new Atlas(el).load(board, { selected })` |
| `panel: false`, `panel="false"` | `panel: "none"`, `panel="none"` |
| `load(board, { optimize })` | `load(board, { reorder })` |
| `connect(from, to, options)` | `addEdge({ from, to, ...options })` |
| `disconnect(id)`, `disconnect({ from, to })` | `removeEdge(id)` |
| `moveLane(id, index)` | `moveLane(id, { index })` |
| `pin(id, { lane, index })`, `unpin(id)` | `updateNode(id, { pinned: true })` (with `moveNode()` in the same `batch()`), `updateNode(id, { pinned: null })` |
| `reorderAll()`, which returned `{ swaps, layers }` | `reorder()`, which returns one count |
| `openDetail(open)`, which returned `"open"` or `"peek"` | `toggleDetail(force)`, which returns whether it is open |
| `export()` | `toJSON()` |
| `suggestions()` | `validate()` and `map.warnings` |
| `--atlas-sheet` (the colour of nodes and panel) | `--atlas-surface` (`--atlas-sheet-height` and `--atlas-sheet-bottom` stay: they are the sheet's) |
| `el.error` on `<atlas-map>` | `el.ready`, which rejects with the same `{ errors }` |
| `parse()`, `normalize()`, `load()`, `serialize()` | `validate(board)` and `apply(board, ops)`, which take and return boards |

## Stability

Atlas follows [Semantic Versioning](https://semver.org/). While the version is 0.x, a minor
release (0.5.0) may break the public API and a patch release (0.5.1) never does. From 1.0.0 on,
only a major release may break it.

**Public API:** the `atlas/1` board format and its schema, everything documented on this page, the
`<atlas-map>` attributes and events, the `--atlas-*` CSS variables, the CSS parts, the key bindings
and the package's `exports`.

**Not public:** members whose names start with `_`, the structure and class names of the rendered
DOM, and the default colours, sizes and animation timings.

**Deprecation.** Something about to go is listed under [Deprecated](#deprecated) here and marked
`@deprecated` in the type declarations, listed under "Deprecated" in the changelog, and prints one
`console.warn` per page. It goes at the earliest in the next minor release while Atlas is 0.x (the
next major from 1.0), always after at least one release with the warning. Fields of `atlas/1` are
never removed ([How the format grows](board-format.md#how-the-format-grows)).
