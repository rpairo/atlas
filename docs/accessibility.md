# Accessibility

The DOM is the accessible version of the map. Wires are drawing only (`aria-hidden`); everything
they say is also in the document as text and buttons.

## Structure

- The board is a region named after `meta.title` (or the `board` label), and the detail panel is
  named by the `detail` label, so screen-reader users can jump between them.
- Lanes and bands are sections with their titles as headings: `h2` by default, or the level in the
  `headingLevel` option, so the map fits the page's outline. An axe-core scan of the examples (light,
  dark and stacked, with and without a selection, in Chrome and WebKit) reports no violations.
- Nodes are native `<button>` elements, in reading order lane by lane. The selected node has
  `aria-pressed="true"`.
- The detail panel repeats the node's lane, title, subtitle and details, and lists its incoming
  and outgoing connections (with their label and details) as buttons that move the selection to
  the other node.
- Each text follows its own direction (`dir="auto"`), so Arabic or Hebrew titles read right to
  left; the board's geometry stays left to right on a right-to-left page.
- When a node is selected, a polite live region announces its title and how many connections it
  has in each direction, using the `labels` of the map (for example "Triage: 5 incoming,
  2 outgoing").

## Keyboard

The nodes are one tab stop (a roving tab index); the buttons of the detail panel come after it in
the tab order. With a node focused:

| Key | Action |
|---|---|
| Arrow keys | Move to the nearest node on screen in that direction, preferring the same row or column |
| `Home`, `End` | First and last node of the current lane |
| `Alt` + `→` / `↓` | Follow the first outgoing connection |
| `Alt` + `←` / `↑` | Follow the first incoming connection |
| `Enter`, `Space` | Select the focused node |
| `Escape` | Clear the selection |

The arrows follow the screen, so they mean the same in every direction of the flow, in the bands
and in the stacked arrangement. The browser audit presses every arrow on every node and checks that
the focus always moves the way of the arrow.

Moving the focus does not select: the wires and the panel change only when you select. The view
scrolls so that the focused node is on screen and clear of the detail panel when it sits below
the board. When the focused node is removed, the focus moves to another node of the map instead of
the page.

## Contrast

While a node is selected, the others step back with a paper background and the secondary ink,
which keeps their text at 4.5:1 or more in both themes (WCAG 1.4.3) and keeps them usable.

## Motion

With `prefers-reduced-motion: reduce`, wires appear at once instead of tracing, and edits do not
animate. The `animate: false` option turns off the tracing for everyone.

## Colour

Incoming and outgoing wires differ in colour (blue and copper by default) and also in what they
connect, and the panel names both directions in words. Backward edges are dashed as well as
coloured. Check contrast if you change the colours: the defaults were chosen for both themes, but
nothing in Atlas enforces a contrast ratio for custom values.

## Not verified yet

Beyond the arrow keys, the automated audit does not cover the keyboard or assistive technology.
No screen reader (VoiceOver, NVDA, JAWS) has been tested yet, and the keyboard model has not been
reviewed by an accessibility specialist. Reports are welcome.
