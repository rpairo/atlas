# Theming and layout

Atlas renders into a shadow root, so page styles do not leak into it and its styles do not leak
out. A page themes it through CSS custom properties, which do cross the shadow boundary, and
through CSS parts.

## Colours, fonts and sizes

Set any of these on the element (or on any ancestor):

```css
atlas-map {
  --atlas-paper: #f1f4f7;      /* board background */
  --atlas-sheet: #ffffff;      /* nodes and detail panel */
  --atlas-ink: #132033;        /* text */
  --atlas-ink-2: #55657c;      /* secondary text: subtitles, lane titles */
  --atlas-rule: #cdd6e1;       /* borders and lane rules */
  --atlas-grid: #e1e7ee;       /* the 24 px grid drawn on the board */
  --atlas-out: #a94e19;        /* wires to what the selected node affects; selection outline */
  --atlas-in: #2a64a8;         /* wires from what reaches the selected node; focus ring */
  --atlas-shadow: rgba(20, 32, 51, .28);  /* shadow of the detail drawer */
  --atlas-radius: 6px;         /* corners of the board and the panel */
  --atlas-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;  /* subtitles, labels */
  --atlas-node-min: 150px;     /* narrowest a lane gets when the flow goes right or left */
  --atlas-panel-width: 300px;  /* width of the panel at the side */
}
```

The values above are the light defaults. The main text font is inherited from the page.

To reuse a page's own design tokens, point the Atlas variables at them:

```css
atlas-map {
  --atlas-paper: var(--paper);
  --atlas-sheet: var(--surface);
  --atlas-ink: var(--text);
  --atlas-out: var(--accent);
}
```

This works even when the page uses the same names as Atlas uses internally (`--paper`, `--ink`…).

## Dark mode

Atlas follows `prefers-color-scheme`. To force a theme, set `theme="dark"` or `theme="light"` on
the element. The dark defaults are:

| Variable | Dark default |
|---|---|
| `--atlas-paper` | `#0c141e` |
| `--atlas-sheet` | `#132030` |
| `--atlas-ink` | `#e3eaf2` |
| `--atlas-ink-2` | `#98a9bd` |
| `--atlas-rule` | `#2a3a4e` |
| `--atlas-grid` | `#152232` |
| `--atlas-out` | `#e88d52` |
| `--atlas-in` | `#6ea8ec` |
| `--atlas-shadow` | `rgba(0, 0, 0, .55)` |

A variable set by the page wins in both themes. If your page has its own dark mode, set the
variables inside it:

```css
@media (prefers-color-scheme: dark) {
  atlas-map { --atlas-paper: #101418; --atlas-sheet: #181d23; }
}
```

## Parts

For anything the variables do not cover, style these parts with `::part()`:

| Part | Element |
|---|---|
| `board` | The board: lanes, nodes and wires |
| `panel` | The detail panel |
| `node` | Every node |
| `node-<type>` | Nodes whose `type` is `<type>` |
| `status-<value>` | Nodes whose live status (from `setState`) is `<value>` |

```css
atlas-map::part(node-service) { border-style: dashed; }
atlas-map::part(status-down) { background: #fde8e8; border-color: #c62828; }
```

The structure inside a part is not part of the public API and may change between minor versions.

## Direction

`meta.direction` (or `setMeta({ direction })`) sets where the flow goes: `right` (the default),
`down`, `left` or `up`. Lanes become rows when the flow goes down or up. Bands always run across
the flow: on top and at the bottom for `right` and `left`, on the left and on the right for `down`
and `up`.

## How the map fits its box

Atlas fills the width of its element and adapts to it. Every time the element is resized, it
picks one of these arrangements:

| Arrangement | When | What you see |
|---|---|---|
| **Panel at the side** | The board at its narrowest, plus `--atlas-panel-width` and a 20 px gap, fits | The board, with the detail panel in a column to its right, sticky while you scroll |
| **Panel below** | The board fits but the side panel does not | The panel is a drawer that sticks to the bottom of the screen, up to 42 % of its height |
| **Scrolling** | The container is narrower than the board's narrowest, but at least 720 px wide | The board keeps its lanes side by side and scrolls sideways |
| **Stacked** | The container is narrower than 720 px and than the board's narrowest | Lanes one after another in a single column, without wires; the detail opens under the selected node |

The board's narrowest width is measured from the layout itself: the corridors between lanes at the
size the wires need, plus `--atlas-node-min` per lane when the flow goes right or left (with `down`
and `up`, each row slot is at least 120 px wide). Lowering `--atlas-node-min` lets a wide board fit
narrower containers.

In the stacked arrangement the connections of the selected node are listed in its detail, as
buttons that jump to the other node. The two-column bands (before and after the flow) keep two
nodes per row, and the detail opens under the pair.

`panel: false` (or `panel="false"` on the element) hides the panel in every arrangement.

## Height

The board is as tall as its content; Atlas never adds an inner vertical scroll except in the
drawer of the panel-below arrangement. Put the element where the page can grow.
