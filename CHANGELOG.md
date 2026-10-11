# Changelog

All notable changes to Atlas are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/); [docs/api.md](docs/api.md#stability) says what the
public API is.

## [Unreleased]

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

[Unreleased]: https://github.com/rpairo/atlas/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rpairo/atlas/releases/tag/v0.2.0
