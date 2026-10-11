# Examples

All boards are fictional. Open them in the [live demo](https://rpairo.github.io/atlas/), or serve
the repository (`python3 -m http.server`) and open `examples/viewer.html?board=<name>/board.json`.

| Example | What it shows |
|---|---|
| [`incident-response/`](incident-response/board.json) | The full format at real-world size: a band before and after the flow, four declared lanes, 35 nodes with details, 66 labelled edges, same-lane and backward edges. The browser audit and the Node tests use it by default. |
| [`dependencies/`](dependencies/board.json) | A module dependency graph with no declared lanes: Atlas derives the lanes from the edges. |
| [`state-machine/`](state-machine/board.json) | A state machine with automatic lanes and cycles, so some edges are drawn backward. |
| [`org-chart/`](org-chart/board.json) | An organisation chart drawn top to bottom (`"direction": "down"`). |
| [`starter/`](starter/index.html) | A complete page with an inline board, to copy and adapt. |

`viewer.html` is a development page that loads the sources (`src/`) instead of the build. It takes
`?board=` (a path relative to it), `?direction=right|down|left|up` and `?theme=light|dark`.
