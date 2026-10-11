# Contributing

Thank you for helping. Bug reports, small fixes and documentation improvements are all welcome.
For a larger change, open an issue first so we can agree on the approach.

## Ground rules

- **No runtime dependencies and no build step for users.** Atlas is plain ES modules in `src/`;
  `scripts/build.mjs` (no bundler) turns them into the two single files in `dist/`.
- **Deterministic and pure where it can be.** `model.js`, `layout.js` and `route.js` take data and
  return data: no DOM, no randomness, no clock. The DOM lives in `atlas.js` and `element.js`.
- **Text from boards goes in with `textContent`.** Never `innerHTML`, never a CSS value or URL taken
  from the data.
- **A change that adds behaviour adds a test** that fails without it.

## Setup

You need Node 22 or newer. There is nothing to install.

```bash
git clone https://github.com/rpairo/atlas.git
cd atlas
npm test
```

To see your changes, serve the repository and open the viewer, which loads `src/` directly:

```bash
python3 -m http.server 8000
# http://localhost:8000/examples/viewer.html?board=incident-response/board.json&direction=down&theme=dark
# http://localhost:8000/ is the demo, which loads dist/
```

## Tests

| Command | What it checks |
|---|---|
| `npm test` | Model, placement and routing in Node, property tests on 150 random boards, the package surface |
| `RUNS=1000 node --test test/random.test.mjs` | The property tests on 1,000 boards; a failure prints the seed (`SEED=<n>` reruns it) |
| `node test/bench-route.mjs [board] [--vertical]` | Routing time and clashes for every selection of a board |
| `npx --yes -p typescript@<version in ci.yml> tsc -p test/types` | The type declarations against `test/types/usage.ts` |
| `scripts/audit.sh [board] [widths…]` | The browser audit, below |

### Browser audit

`scripts/audit.sh` serves the repository locally, opens `test/browser/audit.html` in headless Chrome
at each width, selects every node of the board and checks that:

- no wire crosses a node, no two wires cross or run closer than 5 px, and every arrow has room;
- nothing leaves the board, and selecting never moves a node;
- adding a node works, undo restores the exact document and renaming keeps the geometry;
- the theme paints the board, and the detail drawer covers it;
- when stacked, the lanes form one readable column, nothing overlaps, and the detail sits under
  the selected node;
- a refused edit leaves the map usable, warnings follow undo, every arrow key moves the focus the
  way of the arrow, and `reorderAll()` counts what it changes.

```bash
scripts/audit.sh                                              # incident-response at six widths
scripts/audit.sh ../../examples/org-chart/board.json 1400 600
EXTRA="&direction=up" scripts/audit.sh "" 1400 600
EXTRA="&hostvars=1" scripts/audit.sh "" 1400 500                # themed from a page with its own variables
EXTRA="&dist=1" scripts/audit.sh "" 1400                        # the built file instead of src/
```

The board path is relative to `test/browser/`. On macOS the script uses Google Chrome from
`/Applications`; elsewhere set `CHROME` to the browser's path, and `CHROME_FLAGS` for extra flags.
`scripts/shot.sh <page?query> <width> <height> <out.png>` takes a screenshot the same way.

The audit is the closest thing to looking at the map, but it is not the same: before calling a
visual change done, take screenshots at a few widths, in both themes, and look at them.

## Before you open a pull request

1. `npm test` passes.
2. If you changed `src/`, run `npm run build` and commit `dist/` with it (CI rebuilds and compares).
3. If you changed the public API, update `types/atlas.d.ts`, the docs and `CHANGELOG.md` under
   `[Unreleased]`.
4. For anything visual, the browser audit passes and you have looked at screenshots.

## Releasing

Maintainers only.

1. On a branch `release/vX.Y.Z`: set `version` in `package.json`, move `[Unreleased]` in
   `CHANGELOG.md` to `[X.Y.Z] - date` and add its compare link, update the version in the install
   snippets (`README.md`, `docs/getting-started.md`, `examples/starter/index.html`) and in the
   placeholder of `.github/ISSUE_TEMPLATE/bug_report.yml`, run
   `npm run build` and `npm test`.
2. Open a pull request and merge it when CI is green.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag -a vX.Y.Z -m "Atlas X.Y.Z" && git push origin vX.Y.Z
   ```

   `.github/workflows/release.yml` checks that the tag matches the version and is on `main`, runs
   the tests, rebuilds, and publishes the GitHub release with the built files and their integrity
   hashes.

Versions follow [SemVer](https://semver.org/) as described in
[docs/api.md](docs/api.md#stability). Atlas is not published to the npm registry.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
