# Changelog

All notable changes to Atlas are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/); [docs/api.md](docs/api.md#stability) says what the
public API is.

## [Unreleased]

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

[Unreleased]: https://github.com/rpairo/atlas/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/rpairo/atlas/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rpairo/atlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rpairo/atlas/releases/tag/v0.2.0
