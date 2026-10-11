# Accessibility

The DOM is the accessible version of the map. Wires are drawing only (`aria-hidden`); everything
they say is also in the document as text and buttons.

## Structure

- The board is a region named after `meta.title` (or the `board` label) and described by the keys
  it takes (the `keys` label); the detail panel is named by the `detail` label, so screen-reader
  users can jump between them.
- Lanes and bands are sections with their titles as headings: `h2` by default, or the level in the
  `headingLevel` option, so the map fits the page's outline.
- Nodes are native `<button>` elements, in reading order lane by lane. The selected node is
  `aria-current="true"`; nodes are not toggle buttons.
- Each neighbour of the selected node is described by its relation to it, read when keyboard focus
  reaches it: "Incoming 3 of 5 into Triage: silences". The selected node is described by its
  summary, and marked nodes by their place among the marks ("Match 2 of 5").
- The detail panel repeats the node's lane, title, subtitle and details, and lists its incoming
  and outgoing connections, one button per other node in reading order (parallel edges join their
  labels), each moving the selection to that node. When the panel is a sheet at the foot of the
  window, its head is a button inside the heading that folds and unfolds the rest (`aria-expanded`,
  `aria-controls`); folded, the body takes no focus.
- Stacked, the detail sits right under its node; its head, which would repeat the node, is kept for
  screen readers only.
- Group boxes and their legends are drawing (`aria-hidden`).
- Each text follows its own direction (`dir="auto"`), so Arabic or Hebrew titles read right to
  left; the board's geometry stays left to right on a right-to-left page.

## Announcements

A polite live region speaks only after something a person did:

| When | What it says |
|---|---|
| A node is selected by click, Enter or Space, or from the detail | Its summary: "Triage: 5 incoming, 2 outgoing" (other nodes, each counted once), and "Feeds back into itself" when it does |
| Escape clears the selection | "Selection cleared" |
| An Alt step finds nothing that way | "Triage: no outgoing connections" |
| `nextMark()` moves while focus stays outside the map (a search box) | "2 of 5: Triage" |

A selection made by the page's code (`select()`, `meta.selected`, the `selected` attribute) is not
announced unless `select(id, { announce: true })`. `mark()` announces nothing: the page's search
box says how many it found. The same text twice is said twice (the region empties first). All texts
come from `labels`, and the ones with numbers are templates (`{n}`, `{total}`, `{hub}`, `{title}`),
so a page in another language translates whole sentences.

## Keyboard

The nodes are one tab stop (a roving tab index); the buttons of the detail panel come after it in
the tab order. With a node focused:

| Key | Action |
|---|---|
| Arrow keys | Move to the nearest node on screen in that direction, preferring the same row or column |
| `Home`, `End` | First and last node of the current lane |
| `Enter`, `Space` | Select the focused node (again, on a folded sheet: open the detail) |
| `Alt` + `↓` / `↑` | Next / previous connection of the selected node: incoming, then outgoing, in reading order, wrapping |
| `Alt` + `→` | Next outgoing connection (`Alt` + `←` when the flow goes left) |
| `Alt` + `←` | Next incoming connection (`Alt` + `→` when the flow goes left) |
| `Escape` | From a connection, back to the selected node; on it, clear the selection |

The selected node is the hub: Alt steps move focus through its connections without selecting them.
On a node reached some other way (arrows, Tab, a click), an Alt step first selects it. To follow a
connection, select the neighbour (Enter) and step again. Alt with Left or Right never leaves the
page: in Chrome and Edge on Windows and Linux it is Back and Forward, and inside the map Atlas keeps
it. Escape inside the open sheet folds it and returns to the selected node; Escape that Atlas does
not use (no selection) goes on to the page, for example to close a dialog around the map.

The plain arrows follow the screen, so they mean the same in every direction of the flow, in the
bands and in the stacked arrangement. Moving the focus does not select: the wires and the panel
change only when you select. The view scrolls so that the focused node is on screen and clear of
the detail sheet, once it has finished moving if an edit is moving it. When the focused node is
removed, the focus moves to another node of the map instead of the page.

## Contrast and colour

While a node is selected (or nodes are marked), the others step back with a paper background and
the secondary ink, which keeps their text at 4.5:1 or more in both themes (WCAG 1.4.3). Incoming
and outgoing wires differ in colour (blue and copper by default) and also in what they connect, and
the panel names both directions in words. Backward edges are dashed as well as coloured. A marked
node has a fill and a dot, a shape that reads without colour. The focus ring has its own colour
(`--atlas-focus`, the ink by default), so it is not mistaken for an incoming neighbour. Check
contrast if you change the colours: nothing in Atlas enforces a ratio for custom values.

## Forced colours

In Windows contrast themes the selection, its incoming neighbours and its outgoing neighbours differ
by the shape of a ring inside the node (3 px `Highlight`, 2 px dashed, 2 px solid), without changing
any node's size; marks use `Mark` and `MarkText`; nothing is dimmed; wires use system colours.

## Motion

Edits move nodes into place and wires trace when a node is selected. With
`prefers-reduced-motion: reduce` nothing travels: the nodes that moved or changed are marked with a
tint that fades (not an outline, which would hide the focus ring), new nodes fade in, and wires
appear at once. `animate: false` turns all motion off for everyone, including the sheet's folding.

## What has been verified, and how

- **Automated, on every pull request:** the browser audit in Chrome (with real frames, forced
  colours, reduced motion and scale factors 1.25 and 1.5 emulated), in Edge on Windows (with its
  fonts and classic scroll bars), and in Firefox and WebKit. It presses every arrow on every node,
  steps through every connection of a dozen nodes with Alt and checks each step's description, the
  empty directions, Escape, the order of the detail, the announcements, the sheet's toggle and
  focus, and the forced-colour states. axe-core scans of the examples (light, dark and stacked, with
  and without a selection) report no violations.
- **Not verified yet with a screen reader.** The descriptions and announcements are checked in the
  browser's accessibility tree, not as spoken by NVDA, JAWS, Narrator or VoiceOver. Still to check by
  hand: whether NVDA's browse mode and JAWS's virtual cursor pass Alt with Down and Up through to the
  page (in browse mode the screen reader takes the plain arrows; NVDA+Space switches to focus mode),
  whether `aria-current` reads better than the old `aria-pressed`, and whether Alt with Left is kept
  from going Back in Chrome and Edge on Windows. Reports are welcome.
