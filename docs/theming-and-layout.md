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
  --atlas-in: #2a64a8;         /* wires from what reaches the selected node */
  --atlas-focus: var(--atlas-ink);  /* the keyboard focus ring (its own colour: blue reads as "incoming") */
  --atlas-mark: #ffeeb0;       /* fill of a marked node (mark(), search results) */
  --atlas-mark-dot: #9a6b00;   /* the dot of a marked node and the ring of the current mark */
  --atlas-shadow: rgba(20, 32, 51, .28);  /* shadow of the detail sheet */
  --atlas-radius: 6px;         /* corners of the board and the panel */
  --atlas-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;  /* subtitles, labels */
  --atlas-node-min: 150px;     /* narrowest a lane gets when the flow goes right or left */
  --atlas-panel-width: 300px;  /* width of the panel at the side */
  --atlas-panel-top: 16px;     /* the side panel's distance from the top of the window (below a sticky header) */
  --atlas-sheet-height: min(max(42dvh, 280px), 100dvh - 120px);  /* the open sheet's height at most */
  --atlas-sheet-bottom: max(12px, env(safe-area-inset-bottom));   /* the sheet's distance from the bottom (above a fixed bar) */
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
| `--atlas-mark` | `#3a3112` |
| `--atlas-mark-dot` | `#e0b43a` |
| `--atlas-shadow` | `rgba(0, 0, 0, .55)` |

A variable set by the page wins in both themes. The ones it leaves out follow the system's theme,
so a page that sets its own light colours and has no dark mode should also set `theme="light"`:
otherwise, on a dark system, Atlas's dark secondary text would land on the page's light paper. If
your page has its own dark mode, set the variables inside it:

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
| `selected` | The selected node |
| `marked`, `marked-current` | Marked nodes (`mark()`), and the current one (`nextMark()`) |

A `renderNode` function may add its own parts to a node's `part` attribute; Atlas toggles only its
own (`selected`, `marked`, `marked-current`).

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
| **Panel at the side** | The board at its narrowest, plus `--atlas-panel-width` and a 20 px gap, fits | The board, with the detail panel in a column to its right, sticky while you scroll (and never taller than the window: it scrolls inside) |
| **Panel below** | The side panel does not fit, but the board and the open detail fit the window's height together | The detail under the board, in the page; it covers nothing |
| **Sheet** | Neither | The detail is a sheet at the foot of the window, folded to a 48 px head (lane, title, subtitle, counts of incoming and outgoing nodes). Its head opens it, up to `--atlas-sheet-height`, and so do activating the selected node again and `openDetail()`; open, it keeps the selected node in view above it. It stays open or folded from one selection to the next and folds on `load()`; Escape inside it folds it |
| **Scrolling** | The container is narrower than the board's narrowest, but at least 720 px wide | The board keeps its lanes side by side and scrolls sideways |
| **Stacked** | The container is narrower than 720 px and than the board's narrowest | Lanes one after another in a single column, without wires; the detail opens under the selected node |

The board's narrowest width is measured from the layout itself: the corridors between lanes at the
size the wires need, plus `--atlas-node-min` per lane when the flow goes right or left (with `down`
and `up`, each row slot is at least 120 px wide). Lowering `--atlas-node-min` lets a wide board fit
narrower containers.

In the stacked arrangement the connections of the selected node are listed in its detail, as
buttons that jump to the other node. The two-column bands (before and after the flow) keep two
nodes per row; the selected node and its detail take a whole row, and its neighbour moves to fill
the next gap.

`panel: false` (or `panel="false"` on the element) hides the panel in every arrangement, and
`panel: "side"`, `"below"` or `"sheet"` (or the same values of the attribute) forces one where the
lanes are side by side. `map.arrangement` says which is in use (`{ board, panel, sheet }`), and the
`arrange` event (`atlas-arrange` on the element) fires when it changes. Both are experimental.

When the open detail is wide, its details, incoming and outgoing connections sit side by side.

## Height

The board is as tall as its content; Atlas never adds an inner vertical scroll except in the open
sheet and in a side panel taller than the window. Put the element where the page can grow.

## Forced colours

In Windows contrast themes (and any `forced-colors: active` mode) the browser replaces author
colours and drops shadows. Atlas then shows the selection with a 3 px `Highlight` ring inside the
node, incoming neighbours with a dashed ring and outgoing ones with a solid ring (no node changes
size, so nothing moves), marks with `Mark` and `MarkText`, and wires in system colours; nothing is
dimmed.

## Print

Printing is not tuned yet: the board prints as it is laid out on screen, which may be wider than
the page.
