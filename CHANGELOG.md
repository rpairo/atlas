# Changelog

All notable changes to Atlas are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/); [docs/api.md](docs/api.md#stability) says what the
public API is.

## [Unreleased]

## [0.4.0] - 2026-10-11

Five specialist reviews (graph drawing, motion, visual design, interaction and accessibility, QA)
and an independent critique of the joint plan, tuned for Chrome and Edge first. Every fix comes with
a browser-audit or Node check that fails on 0.3.2.

### Added

- **Saved layers.** On boards without flow lanes Atlas saves each node's column in a new optional
  field, `layer`, and keeps those columns through edits wherever the edges allow: over 1,480 random
  edits the drawing reshuffles after 15.5% of them instead of 38.4%; removing an edge off every
  cycle or adding a node with one edge never does. Boards without saved layers are laid out exactly
  as by 0.3.2 (a fingerprint test against that release). `layout()` returns `layers`; `withLayers()`
  saves them for code that edits with `apply()` alone. Still `atlas/1`.
- **Marks** for search results and filters: `mark(ids)`, `nextMark(step, { focus })`, the `marked`
  and `currentMark` getters, the `mark` event, the parts `marked`, `marked-current` and `selected`,
  `--atlas-mark` and `--atlas-mark-dot`.
- **The detail as a sheet.** When the side panel does not fit and the board and the open detail do
  not fit the window together, the detail is a sheet at the foot of the window, folded to a 48 px
  head (lane, title, counts) and opened by its head, by activating the selected node again or by
  `openDetail()`. When they fit, the detail sits under the board in the page. The `panel` option
  takes `"side"`, `"below"` and `"sheet"`; `arrangement` and the `arrange` event (experimental) say
  which is in use; `--atlas-sheet-height`, `--atlas-sheet-bottom`, `--atlas-panel-top`.
- **Keyboard steps through connections.** Alt with Down and Up steps through every connection of the
  selected node, Alt with Right and Left through its outgoing and incoming ones; each neighbour is
  described to screen readers ("Incoming 3 of 5 into Triage: silences"); Escape goes back to the
  selected node, then clears it. Before, Alt with an arrow followed a chain of first connections and
  never reached most of them (77 of 96 node and direction groups on the incident example).
- `select(id, { reveal, announce })`; labels `summary` (a template), `inStep`, `outStep`, `noneIn`,
  `noneOut`, `noneAll`, `cleared`, `keys`, `markStep`, `marked`; `--atlas-focus`, the focus ring's
  own colour.
- Forced colours (Windows contrast themes): the selection and its incoming and outgoing neighbours
  differ by the shape of a ring inside the node, marks use `Mark`, wires use system colours.

### Changed

- **Motion.** Edits read every position before starting any animation: a 300-node edit took
  222-237 ms in Chrome with frames of up to 233 ms; now 24-29 ms, every frame under 17 ms. A move
  lasts as long as its longest travel needs (250-700 ms), so an edit and its undo take as long; when
  many nodes change lane and row they move along the flow first, then across it; no per-node stagger.
  Lane titles and group boxes glide with their nodes; wires that keep their shape reshape with them
  (Chrome, Edge, Firefox), unchanged wires stay, the rest trace again; a move cut by another edit
  continues from where the nodes are seen (it jumped up to 219 px).
- `animate: false` turns off all motion, edits included (it only stopped the tracing).
- Under reduced motion, nodes that moved or changed are marked with a fading tint instead of
  appearing without a cue.
- A rename keeps the node's element, live state, selection and marks also through undo, redo,
  `apply()` and `batch()` (renames are recorded in the history).
- Screen readers hear a selection's summary when a person selects, not when the page's code does
  (load with `meta.selected`, `select()`), unless `select(id, { announce: true })`; the summary
  counts each neighbour once and mentions a self-loop; the same text twice is said twice. The
  selected node is `aria-current` instead of every node being a toggle button (`aria-pressed`).
- The detail lists one button per other node, in reading order (parallel edges join their labels).
- `find()` ignores accents, searches the live subtitle, returns ids in reading order and finds
  nothing for blank text (it returned every node).
- `reorderAll()` also lays out the columns of boards without flow lanes afresh and returns
  `{ swaps, layers }`.
- `load()` draws the layers its tidy ordered for (on 4% of the graph review's 400 random boards without lanes it drew others).
- Atlas writes `layer` into boards without flow lanes, a one-time difference in saved boards. A
  board that stores its own whole-number `layer` there has it replaced; any other value is kept and
  ignored, with an `ignored` warning.
- Group boxes and legends are list items hidden from assistive technology (they were `<div>`s inside
  an `<ol>`).

### Fixed

- A group pushed its lane's nodes into a second column (or row); group legends sat on nodes and
  lane titles, and nested groups' legends on each other. Legends now have grid rows of their own.
- In WebKit (Safari) the rows of the board kept their old heights when its width changed (on load
  with a side panel, on every resize) and nodes spilled into the next row.
- The detail panel below the board cut the wires being traced (on 7 of 9 selections, and always
  the initial one): wires are redrawn only when the board's geometry changes.
- A selection made while nodes moved drew wires on boxes in flight; a node selected or reached by
  keyboard while moving was scrolled to where it was passing.
- The ghost of a removed node was an empty box, 1 px off; it is now a copy of the node.
- Selecting started a CSS transition on every node (141 on the incident example).
- A destroyed map still edited and fired events.
- Hovering a node that stepped back showed nothing.
- The focus ring was the blue of "incoming".
- A very long unbroken title widened the detail panel past the screen.
- Alt with Left or Right inside the map no longer goes Back or Forward in Chrome and Edge.
- With classic scroll bars (Windows), nodes in flight made the box around the board scroll for the
  length of a move: a scroll bar flashed on edits and every node jumped 12-24 px. The board now
  clips its overflow.

### Development

- CI: the browser audit also runs through Playwright in Chrome (forced colours, reduced motion,
  scale factors 1.25 and 1.5, a dark system, real frames) and in Edge on Windows with classic scroll
  bars; every list the audit returns fails the run when not empty.
- The release workflow runs the whole CI on the tagged commit before publishing, and attests the
  built files' provenance (`gh attestation verify`).
- A fingerprint test compares placement and routing with v0.3.2 on 66 boards; package tests check
  that docs and types list every public member and label, that every version a reader copies is
  the package's, and a gzip size budget.

## [0.3.2] - 2026-10-11

### Fixed

- The routing tests' synthetic geometry drew every node 42 units tall, also in a row made taller by
  a busy node's ports, while the renderer stretches nodes to their row. It squeezed those ports and
  reported crossings the real map does not have (24 on one node of a 35-node home map, 0 in Chrome,
  Firefox and WebKit). Nodes now fill their row, and every example and that map route with no
  crossing in the tests, as on screen.

### Changed

- Lists of more than six ports or tracks (a hub's side, a busy corridor), too long to try every
  order, are improved by moving each item to its best place while crossings remain, within
  `ROUTE.budget`: 14% fewer crossings over a set of hubs and dense random boards, in the same time.
  Boards that route without crossings are unchanged.
- The format guide says what edits do to lanes computed from the edges (on boards without flow
  lanes, a new edge can move nodes to another lane; inside a lane the order is kept).

## [0.3.1] - 2026-10-11

A second review: the browser audit now also runs in Firefox and WebKit, and property-based tests
(thousands of random boards and edits, hostile values in every field) found the rest.

### Fixed

- In Safari (WebKit) some rows of the board were taller than their content (90 px for 72 px) and
  changed between renders: measuring the board's minimum width briefly set the live board to
  `min-content`, and WebKit kept rows sized for that narrow layout. The width is measured on a
  hidden copy; the result is the same in Chrome, Firefox and WebKit.
- `load()` and `apply()` threw a `TypeError` instead of `AtlasError` for values such as an object
  whose `toString` is not a function, an object as an index, or `changes` that is not an object (a
  string used to add fields such as `"0"` to a node). Every operation's arguments are checked
  first, and messages show any value safely.
- `addNode()` could still move existing nodes when a constraint drew a lane in another order than
  its document. The lane's document order becomes its drawn order before the node goes in.
- A node both `first` and `last` of a lane with other nodes was accepted, and every constraint of
  that lane was then dropped. It is a `conflict` error.
- On a board without flow lanes, constraints were checked as if every node shared one lane named
  `unassigned`. They are checked against the layers the placement computes, and reported as
  warnings (`cross-lane`, `conflict`) when they cannot hold there.
- `load(null)` returned an empty board; it is refused, as documented. Numbers out of range (`1e400`)
  are refused instead of saving as `null`. A board passed as an object has the same 512 KB limit
  and prototype-key protection as JSON text.
- An operation's payload is copied: changing the caller's object afterwards no longer changes the
  board.
- Renaming a node no longer fails, or gives an edge an id another edge has, when a derived id is
  already taken; it takes the next free `#n`.
- Saving twice gives the same text after a lane kind or a direction fell back to its default.

### Changed

- Firefox 110+ is enough (`:has()`, `Object.hasOwn` and `??=` are not used). The README states the
  real minimums and what is tested.
- `meta.lang` has the same 2,000-character limit in the schema as in `validate()`.

### Added

- `scripts/audit-browsers.mjs`: the browser audit in Firefox and WebKit through Playwright; CI runs
  it on every pull request.
- `headingLevel` option. Lane titles and the detail's title were always `h3`, which skipped a level
  under a page's `h1` (axe-core `heading-order`); they are `h2` by default, the relations one below.

## [0.3.0] - 2026-10-11

Fixes from an independent review (every one with a test that failed before) and a few additions.

### Fixed

- A selection that no longer exists no longer crashes the map: loading another board, renaming
  the selected node, or removing it in `apply()`/`batch()` threw a `TypeError` after the board had
  already changed. The selection follows a rename and is cleared, with a `select` event, when its
  node is gone.
- Selecting a node with dozens of wires froze the page for tens of seconds (a hub with 36 wires
  took 75 s in Chrome). The search for the order of wires is incremental and stops at a fixed
  amount of work, `ROUTE.budget`: about 0.3 s at worst. Boards like the examples route exactly as
  before.
- On a right-to-left page every wire ran over the nodes. The board stays left to right and each
  text follows its own direction.
- Tidying a dense board took seconds (16.6 s for 300 nodes and 1,000 edges in two lanes); it takes
  milliseconds, with the same result.
- `<atlas-map>` showed an older board when `src` changed before the previous one arrived, and the
  events of an inline board fired before code right after the import could listen.
- Adding a node next to groups could swap existing nodes; `reorderAll()` could move pinned nodes
  when groups were enforced again.
- Arrow keys could move the focus to a node off screen or under the detail drawer, and selecting a
  node near the foot of the screen opened the drawer over it. The view scrolls to keep it visible.
- Dimmed nodes kept only 2.2:1 text contrast; they keep 4.5:1 or more (WCAG 1.4.3).
- `destroy()` during a transition left an unhandled rejection; a destroyed `<atlas-map>` stayed
  empty when inserted again.
- Live state of a removed node came back on a new node with the same id; focus on a removed node
  fell out of the map; edits that changed nothing made undo steps.
- `load(board, { selected: null })` selected `meta.selected`.
- Long unbroken text overflowed the detail, lane titles and group labels; the inline detail was an
  invalid child of a list; its bullets were circles.
- The board format and its JSON Schema disagree no more: a field set to `null` is a field left
  out, wrong types are errors on both sides, lengths count characters as JSON Schema does, and the
  schema refuses the ids that `validate()` refuses.
- A long chain of `before` constraints threw `RangeError`; a derived edge id could repeat an
  explicit one; an edge type named `toString` was not reported; `null` in `addLane`, `updateLane`
  and `setMeta` did not fall back to defaults; `removeNode` kept `meta.selected`.

### Added

- `element.ready` (a promise for the board on screen) and `element.error` on `<atlas-map>`;
  `atlas.destroyed`.
- `historyLimit` option and `clearHistory()`; `updateGroup()`; `batch()` also offers
  `updateEdge`, `addLane`, `updateLane`, `addGroup`, `updateGroup`, `addConstraint` and `setMeta`.
- The detail panel shows an edge's `details`.
- The board is a region named after `meta.title` (label `board`) and the panel is named (label
  `detail`).
- Warnings `group-split` (constraints put other nodes inside a group) and `missing` for a
  `meta.selected` that names no node.
- `bestInsertion(model, id, near)`.

### Changed

- Dimmed nodes step back with the paper background and the secondary ink instead of opacity.
- An inline detail sits inside the selected node's list item.

## [0.2.0] - 2026-10-11

First public release.

### Changed

- The package is `@rpairo/atlas`. Its `exports` are the module build (with types),
  `./atlas.global.js`, `./schema.json` and `./package.json`; the sources are no longer exported.
- The banner of the built files carries the version, the license and the repository URL.
- The JSON Schema has an absolute `$id`:
  `https://rpairo.github.io/atlas/schema/atlas-board.schema.json`. A node's `type` may be any
  string, as `validate()` always allowed; only matching values become a CSS part.
- Arrow keys move to the nearest node on screen in their direction. They used to follow the order
  of the flow, which went the wrong way with `left` and `up` and sideways in the bands.
- `validate()` also checks `meta.title` (text, up to 2,000 characters), a node's `type` (text) and
  `pinned` (true or false), which the schema already required.
- A board that is not a JSON object (`null`, a number, a list), or whose lists are not lists, is
  rejected with a `type` error. `null` used to throw a `TypeError`, and the others loaded an empty
  board without a word.

### Fixed

- Wires that return to the side they left (two nodes of the same lane, or of the same band) no
  longer share a track. Two such loops on one track always crossed, for example a node linked to
  one node above it and one below it in its own lane. Each loop now gets its own track and port.
- When a node has too many wires for an exhaustive search of their order, sets of wires that share
  nothing are searched separately, instead of falling back to a weaker search for all of them.
- The built files no longer contain `</script`, so they can be pasted inside an HTML `<script>`
  element.
- Options and labels set to `undefined` keep their defaults (`shadow: undefined` used to render
  without a shadow root).
- `removeLane(id, { moveTo: null })` leaves the nodes without a lane instead of saving
  `"lane": null`, which the schema rejects.
- `disconnect({ from, to })` without such an edge throws a clear `AtlasError`.
- `unpin()` removes the `pinned` field instead of saving `"pinned": false`.
- A refused `renameNode()` (to an invalid id, or one used by a lane or group) leaves the map usable.
  It used to keep the new id on screen, so the next selection or edit threw.
- `undo()` and `redo()` bring `warnings` (and the `change` event) back in line with the board.
- `<atlas-map>` with an inline board works when the classic script is loaded in `<head>`; the map
  used to stay empty, without an error.
- `reorderAll()` counts the swaps that actually happen once pinned nodes keep their places, and
  makes no undo step when nothing changes.
- `renameNode()` also renames `meta.selected`.

### Added

- TypeScript declarations (`types/atlas.d.ts`), checked in CI against a usage file.
- An incident-response example (35 nodes, 66 edges) and a copy-paste starter page.
- Routing tests in Node on a geometry sized like the renderer's, for every example in both
  proportions; tests that the source, the builds and the declarations export the same names.
- Documentation: getting started, board format, API, theming and layout, accessibility, security.
- A live demo, CI (tests on Node 22, 24 and 26, build check, types, browser audit) and releases
  with Subresource Integrity hashes.

## 0.1.1 - 2026-10-10

Not published. Fixes found by embedding Atlas in a host page.

- The board fills its box and only scrolls below its true minimum, measured from the layout.
- Theming from a page that has its own `--paper`, `--ink`… variables no longer leaves the board
  unpainted.
- The detail drawer covers the board instead of showing it through.
- Stacked mode: lanes form one column again, and the detail opens under the selected node.

## 0.1.0 - 2026-10-10

Not published. First version: the `atlas/1` format with validation and edit operations, placement,
orthogonal routing, the `Atlas` class and the `<atlas-map>` element, single-file builds and tests.

[Unreleased]: https://github.com/rpairo/atlas/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/rpairo/atlas/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/rpairo/atlas/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/rpairo/atlas/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rpairo/atlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rpairo/atlas/releases/tag/v0.2.0
