# Getting started

This page takes you from nothing to a saved, editable map. The [API reference](api.md) and the
[board format](board-format.md) have the details.

## Load Atlas

Atlas ships as two single files. Both contain the whole engine and its styles, and neither loads
anything else.

| File | Kind | Gives you |
|---|---|---|
| `dist/atlas.js` | ES module | `import { Atlas, … } from "./atlas.js"`, and registers `<atlas-map>` |
| `dist/atlas.global.js` | classic script | `window.Atlas` (the class, with every other export as a property), and registers `<atlas-map>` |

Pick a source:

```html
<!-- A copy next to your page -->
<script type="module" src="./atlas.js"></script>

<!-- From a CDN, pinned to an exact version -->
<script type="module" src="https://cdn.jsdelivr.net/gh/rpairo/atlas@v0.5.0/dist/atlas.js"></script>

<!-- Classic script, no modules -->
<script src="https://cdn.jsdelivr.net/gh/rpairo/atlas@v0.5.0/dist/atlas.global.js"></script>
```

With npm (from GitHub; Atlas is not on the npm registry):

```bash
npm install github:rpairo/atlas#v0.5.0
```

```js
import { Atlas } from "@rpairo/atlas";            // the ES module, with TypeScript types
import "@rpairo/atlas/atlas.global.js";           // or the classic script, for its side effect
import schema from "@rpairo/atlas/schema.json" with { type: "json" };
```

ES modules do not load from `file://` URLs. Serve the page over HTTP, for example with
`python3 -m http.server`, or use the classic script, which works from a file too.

### Pin a version

Always load an exact version (`@v0.5.0`, `#v0.5.0`), never a branch. The notes of every
[release](https://github.com/rpairo/atlas/releases) list the SHA-384 integrity of each file, so a
CDN copy can be checked by the browser:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/gh/rpairo/atlas@v0.5.0/dist/atlas.js"
  integrity="sha384-…from the release notes…"
  crossorigin="anonymous"></script>
```

## A first map

A board is a JSON document with lanes, nodes and edges. This one describes a tiny sign-up flow:

```json
{
  "format": "atlas/1",
  "meta": { "title": "Sign-up", "selected": "form" },
  "lanes": [
    { "id": "in", "title": "Inputs" },
    { "id": "logic", "title": "Logic" },
    { "id": "out", "title": "Outputs" }
  ],
  "nodes": [
    { "id": "form", "title": "Sign-up form", "subtitle": "web and app", "lane": "in" },
    { "id": "check", "title": "Validation", "lane": "logic",
      "details": ["Email must be unique.", "Passwords need 12 characters."] },
    { "id": "mail", "title": "Welcome email", "lane": "out" },
    { "id": "crm", "title": "CRM record", "lane": "out" }
  ],
  "edges": [
    { "from": "form", "to": "check", "label": "submits" },
    { "from": "check", "to": "mail", "label": "sends" },
    { "from": "check", "to": "crm", "label": "creates" }
  ]
}
```

Save it as `board.json` next to your page and point the element at it:

```html
<script type="module" src="./atlas.js"></script>
<atlas-map src="board.json"></atlas-map>
```

Lanes follow each other from left to right. Each node sits in its lane, in the order of the
`nodes` list. Click a node: its wires appear (blue for what reaches it, copper for what it
affects) and the detail panel lists its details and connections. Clicking a connection in the panel
jumps to that node.

The board can also live inside the element, which saves a request (this works wherever the script
is loaded, in the `<head>` or after the element):

```html
<atlas-map>
  <script type="application/json">{ "nodes": [ … ], "edges": [ … ] }</script>
</atlas-map>
```

`<atlas-map src>` only loads boards from the page's own origin unless the element has the
`cross-origin` attribute. When a board cannot be loaded or is invalid, the element fires
`atlas-error` with every problem found:

```js
document.querySelector("atlas-map").addEventListener("atlas-error", e => console.error(e.detail.errors));
```

The events fire once your code had the chance to listen. If it may run later, ask the element:
`el.ready` settles when the board is on screen, or rejects with the same `{ errors }`.

## Edit it from JavaScript

The element's map is `element.atlas`. You can also create the map yourself on any element:

```js
import { Atlas } from "./atlas.js";

const map = new Atlas(document.getElementById("map")).load(board);

map.addNode({ id: "sms", title: "Welcome SMS", lane: "out" }, {
  edges: [{ from: "check", to: "sms", label: "sends" }],
});                                   // enters the gap with the fewest crossings
map.updateNode("sms", { subtitle: "only with consent" });
map.renameNode("sms", "text");        // every reference follows; nothing moves
map.undo();                           // exact: the document is restored as it was
map.batch(m => m                      // several edits, one undo step
  .removeNode("crm")
  .addEdge({ from: "check", to: "mail", label: "also sends" }));
```

Every edit validates the whole board first. An edit that would break it throws an `AtlasError`
and changes nothing.

## Save and reload

`map.toJSON()` returns the board as it should be saved, with any fields Atlas does not know kept.
Loading that document again draws exactly the same map.

```js
map.addEventListener("change", () => {
  localStorage.setItem("board", JSON.stringify(map.toJSON()));
});
```

A board Atlas has never seen is tidied once, to the order with the fewest crossings, and saved
with `"meta": { "ordered": true }`. After that Atlas keeps the order you see and only changes it
when you ask (`map.reorder()`).

## Show live values

`setState` changes what a node shows without moving anything. It is handy for a value that changes
often, such as a sensor reading or a build status:

```js
map.setState("check", { subtitle: "3 errors in the last hour", status: "warn" });
```

`status` becomes the CSS part `status-warn` on the node, which a page can style (see
[Theming and layout](theming-and-layout.md#parts)).

## Use it without a browser

`validate()`, `apply()` and `diff()` take boards and need no DOM. They run in Node, for instance to
check boards in a CI job:

```js
import { readFileSync } from "node:fs";
import { validate } from "@rpairo/atlas";

const { ok, errors, warnings } = validate(readFileSync("board.json", "utf8"));
for (const w of warnings) console.warn(`${w.path}: ${w.message}`);
for (const e of errors) console.error(`${e.path} [${e.code}]: ${e.message}`);
if (!ok) process.exitCode = 1;
```

Editors that understand JSON Schema can validate boards as you type with
`schema/atlas-board.schema.json` (also published at
`https://rpairo.github.io/atlas/schema/atlas-board.schema.json`).

## Next

- [Board format](board-format.md): everything a board can say.
- [Theming and layout](theming-and-layout.md): colours, fonts, directions and narrow screens.
- [Examples](../examples/README.md): four boards and a starter page.
