// The component's stylesheet. Every colour and size is a custom property of the .atlas wrapper,
// read from an `--atlas-*` variable of the page when it exists, so a host page themes it without
// reaching inside the shadow root. Dark values apply with prefers-color-scheme or theme="dark".
//
// The variables live on .atlas, not on :host: a rule for :host applies to the host element itself,
// where the page's own variables are, so `--paper` there would collide with a page that also has
// `--paper` and sets `--atlas-paper: var(--paper)` (a cycle that leaves both empty). On .atlas
// they only shadow what is inside, and the same rules work without a shadow root.

// The dark defaults, for the system's dark mode and for theme="dark".
const DARK = `--paper: var(--atlas-paper, #0c141e); --surface: var(--atlas-surface, var(--atlas-sheet, #132030)); --ink: var(--atlas-ink, #e3eaf2);
  --ink-2: var(--atlas-ink-2, #98a9bd); --rule: var(--atlas-rule, #2a3a4e); --grid: var(--atlas-grid, #152232);
  --out: var(--atlas-out, #e88d52); --in: var(--atlas-in, #6ea8ec); --shadow: var(--atlas-shadow, rgba(0, 0, 0, .55));
  --mark: var(--atlas-mark, #3a3112); --mark-dot: var(--atlas-mark-dot, #e0b43a);`;

export const STYLES = `
:host {
  display: block;
  container-type: inline-size;
}
.atlas {
  --paper: var(--atlas-paper, #f1f4f7);
  --surface: var(--atlas-surface, var(--atlas-sheet, #ffffff));   /* nodes and panel (--atlas-sheet: before 0.5.0) */
  --ink: var(--atlas-ink, #132033);
  --ink-2: var(--atlas-ink-2, #55657c);
  --rule: var(--atlas-rule, #cdd6e1);
  --grid: var(--atlas-grid, #e1e7ee);
  --out: var(--atlas-out, #a94e19);
  --in: var(--atlas-in, #2a64a8);
  --shadow: var(--atlas-shadow, rgba(20, 32, 51, .28));
  --focus: var(--atlas-focus, var(--ink));   /* its own colour: blue would read as "incoming" */
  --mark: var(--atlas-mark, #ffeeb0);          /* a marked node's fill (search results) */
  --mark-dot: var(--atlas-mark-dot, #9a6b00);  /* and its dot: a shape, not only a colour */
  --radius: var(--atlas-radius, 6px);
  --mono: var(--atlas-font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  --node-min: var(--atlas-node-min, 150px);
  /* The detail as a sheet at the foot of the window: open height, distance from the bottom (raise
     it above a page's own fixed bottom bar), and the side panel's distance from the top. */
  --sheet-height: var(--atlas-sheet-height, min(max(42vh, 280px), 100vh - 120px));
  --sheet-bottom: var(--atlas-sheet-bottom, max(12px, env(safe-area-inset-bottom)));
  --panel-top: var(--atlas-panel-top, 16px);
  color: var(--ink);
  font: inherit;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) .atlas, :not([theme="light"]) > .atlas {
    ${DARK}
  }
}
:host([theme="dark"]) .atlas, [theme="dark"] > .atlas {
  ${DARK}
}
@supports (height: 1dvh) { .atlas { --sheet-height: var(--atlas-sheet-height, min(max(42dvh, 280px), 100dvh - 120px)); } }
*, *::before, *::after { box-sizing: border-box; }
/* The small labels: lane titles, the detail's lane line, its relation headings and the sheet's counts. */
:is(.lane-title, .p-lane, .r-title, .p-counts) { font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

/* Two stacking contexts: nothing of the board (its lanes and wires have z-indexes) paints over the
   detail panel when the panel is a drawer that overlaps it, and nothing of Atlas over the page. */
.atlas { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); align-items: start; isolation: isolate; }
.atlas[data-panel="side"] { grid-template-columns: minmax(0, 1fr) var(--atlas-panel-width, 300px); }

.board {
  position: relative; display: grid; min-width: 0;
  border: 1px solid var(--rule); border-radius: var(--radius);
  background-color: var(--paper);
  background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  padding: 16px;
  /* Fills its box, and never gets narrower than its content can go (gutters and channels at
     their size, every lane at --node-min): below that, the wrapper scrolls sideways. */
  width: auto;
  min-width: min-content;
  /* Nodes in flight (an edit's transforms) never make the box around it scroll: with classic scroll
     bars (Windows) a scroll bar appearing for the length of a move took 15 px and moved every node. */
  overflow: clip;
}
/* The board is geometry: lanes, corridors and wires are measured left to right, so it stays left to
   right on a right-to-left page (each text follows its own direction, see txt() in atlas.js). */
.board-wrap { min-width: 0; overflow-x: auto; overflow-y: hidden; isolation: isolate; direction: ltr; }

/* Bands and lanes */
.lane-title {
  margin: 0; color: var(--ink-2);
  display: flex; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere;
}
.lane-title::after { content: ""; flex: 1; border-top: 1px solid var(--rule); }   /* a border: it prints and survives forced colours */
.lane-title:empty { display: none; }
ol.nodes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; min-width: 0; }
ol.nodes > li { min-width: 0; display: grid; }
ol.nodes > li > .panel { margin-top: 10px; }
.band { display: grid; gap: 10px; min-width: 0; position: relative; z-index: 1; }
.flow { display: grid; min-width: 0; position: relative; z-index: 1; }
.lane { display: grid; min-width: 0; }
/* A group: a dashed box behind its nodes and, when titled, a legend in a grid row of its own that
   the box's top edge runs through (atlas.js sets the rows, margins and nesting insets). */
.group-box { position: relative; border: 1px dashed var(--rule); border-radius: calc(var(--radius) + 2px); pointer-events: none; z-index: 0; }
.group-legend { position: relative; z-index: 1; justify-self: start; align-self: start; min-width: 0; max-width: calc(100% - 20px); margin-bottom: -6px; pointer-events: none; }
.group-legend > span { display: block; padding: 0 6px; background: var(--paper); font: 500 11px/16px var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }

/* Nodes */
.node {
  position: relative; display: block; width: 100%; min-width: 0; text-align: start;
  background: var(--surface); border: 1px solid var(--rule); border-radius: 4px;
  padding: 9px 12px 10px; cursor: pointer;
}
.node .t { display: block; font-weight: 600; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.node .s { display: block; font: 11.5px/1.35 var(--mono); color: var(--ink-2); margin-top: 2px; overflow-wrap: anywhere; }
.node:hover { border-color: var(--ink-2); }
/* Nodes outside the selection step back without losing their text: paper instead of sheet, a faint
   border and the secondary ink, which keeps 4.5:1 on the paper (WCAG 1.4.3). Opacity would not. */
.board:is(.has-selection, .has-marks) .node:not(.on, .near-in, .near-out, .marked) { background: var(--paper); border-color: var(--grid); }
.board:is(.has-selection, .has-marks) .node:not(.on, .near-in, .near-out, .marked) .t { color: var(--ink-2); }   /* colour only: a lighter weight would rewrap titles and move nodes */
/* Hovering a node that stepped back still answers (the rule above outweighed .node:hover). */
.board:is(.has-selection, .has-marks) .node:not(.on, .near-in, .near-out, .marked):hover { border-color: var(--ink-2); }
/* Marks: a fill and a dot (the dot is a shape: the fill alone differs from white mostly in hue), the
   current one ringed with dashes; borders stay free for the selection's relations. */
.node.marked { background: var(--mark); }
.node.marked::after { content: ""; position: absolute; top: 5px; inset-inline-end: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--mark-dot); pointer-events: none; }
.node.marked-current:not(:focus-visible) { outline: 2px dashed var(--mark-dot); outline-offset: 2px; }
.node.on { border-color: var(--out); box-shadow: 0 0 0 1.5px var(--out); transition: box-shadow .12s; }   /* one transition, not one per node and property */
.node.near-out { border-color: var(--out); }
.node.near-in { border-color: var(--in); }

/* Removed nodes fade out here, above the board, where they were. */
.ghosts { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

/* Wires: above the nodes; routing keeps them in the corridors, so they never cover one. */
svg.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
.casing { fill: none; stroke: var(--paper); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.wire { fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.wire.out { stroke: var(--out); } .wire.in { stroke: var(--in); }
.wire.backward { stroke-dasharray: 6 4; }
.arrow.out, .dot.out { fill: var(--out); } .arrow.in, .dot.in { fill: var(--in); }
.dot { stroke: var(--surface); stroke-width: 1.5; }
@media (prefers-reduced-motion: no-preference) {
  .wire.draw, .casing.draw {
    stroke-dasharray: var(--len) var(--len); stroke-dashoffset: var(--len);
    animation: atlas-trace var(--t, .5s) linear var(--d, 0s) forwards;
  }
  .wire.backward.draw { animation-name: atlas-trace-dashed; }
  .arrow.draw { opacity: 0; animation: atlas-appear .14s ease-out var(--d, 0s) forwards; }
  .dot.draw { opacity: 0; animation: atlas-appear .12s ease-out var(--d, 0s) forwards; }
}
@keyframes atlas-trace { to { stroke-dashoffset: 0; } }
@keyframes atlas-trace-dashed { 0% { stroke-dashoffset: var(--len); } 99% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; stroke-dasharray: 6 4; } }
@keyframes atlas-appear { to { opacity: 1; } }

/* Panel */
.panel {
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 18px 18px 20px; display: grid; gap: 12px; min-width: 0;
  grid-template-columns: minmax(0, 1fr);   /* never as wide as a long unbroken title */
}
.atlas[data-panel="side"] .panel { position: sticky; top: var(--panel-top); max-height: calc(100vh - 2 * var(--panel-top)); overflow: auto; }
/* The sheet: sticky at the foot of the window, its head always there, its body only when open. Grid
   rows (not flex) so the body scrolls inside the open sheet in every engine. */
.atlas[data-panel="sheet"] .panel {
  position: sticky; bottom: var(--sheet-bottom); padding: 0; gap: 0;
  grid-template-rows: auto minmax(0, 1fr); max-height: var(--sheet-height); overflow: hidden; container-type: inline-size;
  box-shadow: 0 -1px 2px var(--shadow), 0 -12px 32px -16px var(--shadow);
}
.atlas[data-panel="sheet"] .p-title { font-size: inherit; margin: 0; }
.atlas[data-panel="sheet"] .p-body { overflow: auto; overscroll-behavior: contain; padding: 14px 18px 18px; border-top: 1px solid var(--grid); }
.panel[data-sheet="peek"] .p-body { height: 0; padding-block: 0; border-top-width: 0; visibility: hidden; }   /* hidden also leaves the tab order */
.p-toggle {
  display: flex; flex-wrap: nowrap; align-items: baseline; gap: 4px 12px; width: 100%; min-height: 48px; padding: 13px 18px;
  border: 0; border-radius: var(--radius) var(--radius) 0 0; background: none; text-align: start; cursor: pointer;
}
.p-toggle:hover { background: color-mix(in srgb, var(--paper) 55%, var(--surface)); }
.p-toggle:focus-visible { outline-offset: -2px; }
.p-toggle .p-lane { flex: none; }
.p-toggle .p-name { flex: 0 1 auto; min-width: 0; font-size: 1.05rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-toggle .p-sub { flex: 1 1 0; min-width: 0; font: 12.5px/1.4 var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-counts { flex: none; display: flex; gap: 14px; margin-inline-start: auto; }
.p-counts > span { display: inline-flex; align-items: center; gap: 6px; }
.p-counts > span::before { content: ""; width: 12px; border-top: 2px solid; }
.p-counts [data-dir="in"] { color: var(--in); } .p-counts [data-dir="out"] { color: var(--out); }
.p-chev { flex: none; align-self: center; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75; }
.panel[data-sheet="open"] .p-chev { rotate: 180deg; }
@container (max-width: 560px) { .p-toggle { flex-wrap: wrap; } .p-toggle .p-sub { display: none; } .p-counts { margin-inline-start: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .atlas[data-panel="sheet"] { interpolate-size: allow-keywords; }      /* Chrome and Edge 129+; instant elsewhere */
  .atlas[data-panel="sheet"] .p-body { transition: height .22s cubic-bezier(.2,0,0,1), padding .22s, visibility 0s; }
  .panel[data-sheet="peek"] .p-body { transition: height .18s, padding .18s, visibility 0s .18s; }
  .p-chev { transition: rotate .2s; }
}
.atlas[data-motion="off"] :is(.p-body, .p-chev) { transition: none !important; }   /* animate: false */
/* The detail's body: details, incoming, outgoing, side by side when the panel is wide. */
.p-body { display: grid; gap: 14px 28px; align-items: start; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); min-width: 0; }
/* Inline (stacked), the detail sits right under its node: its head would repeat the node, so it is
   kept for screen readers only. */
.atlas[data-panel="inline"] .panel > :is(.p-lane, .p-title, .p-sub) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.p-lane { margin: 0; color: var(--ink-2); }
.panel .p-title { margin: 0; font-size: 1.4rem; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
.panel .p-sub { margin: 0; font: 12.5px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
.panel li { overflow-wrap: anywhere; }
.panel ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; list-style: disc; } /* inline, the panel sits in a lane's list */
.rel { display: grid; gap: 6px; }
.rel .r-title { margin: 4px 0 0; display: flex; align-items: center; gap: 8px; }
.rel .r-title::before { content: ""; width: 16px; border-top: 2px solid; }
.rel[data-dir="in"] .r-title { color: var(--in); }
.rel[data-dir="out"] .r-title { color: var(--out); }
.rel ul { list-style: none; padding: 0; }
.rel button { display: grid; gap: 1px; width: 100%; min-width: 0; text-align: start; background: transparent; border: 1px solid var(--rule); border-radius: 4px; padding: 7px 10px; cursor: pointer; }
.rel button:hover { border-color: var(--ink-2); }
.rel .rt { font-weight: 600; font-size: 13.5px; }
.rel .rd { font-size: 12px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.rel .rw { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Forced colours (Windows contrast themes): author colours and shadows are gone, so the selection,
   its incoming and its outgoing neighbours differ by the shape of a ring inside the node (no size
   changes: selecting never moves a node), nothing is dimmed, and wires use system colours. */
@media (forced-colors: active) {
  .board:is(.has-selection, .has-marks) .node:not(.on, .near-in, .near-out, .marked) { border-color: GrayText; }
  .node.marked, .node.marked :is(.t, .s) { forced-color-adjust: none; background: Mark; color: MarkText; }
  .node.marked { border-color: CanvasText; }   /* out of forced colours, its own border would be the author's faint rule */
  .node.marked::after { forced-color-adjust: none; background: MarkText; }
  .node.marked-current:not(:focus-visible) { outline: 2px dashed CanvasText; }
  .node.on::before, .node.near-in::before, .node.near-out::before { content: ""; position: absolute; inset: 2px; border-radius: 2px; pointer-events: none; }
  .node.on::before { border: 3px solid Highlight; }
  .node.near-out::before { border: 2px solid CanvasText; }
  .node.near-in::before { border: 2px dashed CanvasText; }
  :focus-visible { outline: 2px solid Highlight; outline-offset: 3px; }
  .casing { stroke: Canvas; }
  .wire.out { stroke: CanvasText; } .wire.in { stroke: LinkText; }
  .arrow.out, .dot.out { fill: CanvasText; } .arrow.in, .dot.in { fill: LinkText; }
  .dot { stroke: Canvas; }
  .group-box { border-color: GrayText; }
}

/* Stacked: lanes one after another, no wires, the detail opens under the node. Every grid of the
   flow layout sets its tracks and positions inline; here they all go back to one column, and the
   parts that only exist for wires (gutters, channels) leave the grid, or their explicit positions
   would open implicit columns. */
.atlas[data-mode="stack"] .board { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .board > * { grid-column: auto !important; grid-row: auto !important; }
.atlas[data-mode="stack"] .gutter, .atlas[data-mode="stack"] .channel { display: none; }
.atlas[data-mode="stack"] .band { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .band > * { grid-column: auto !important; grid-row: auto !important; }
.atlas[data-mode="stack"] .band.after .lane-title { order: -1 !important; }
.atlas[data-mode="stack"] ol.nodes { margin: 0 !important; }
.atlas[data-mode="stack"] .lane ol.nodes { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .node { min-height: 0 !important; min-width: 0 !important; }
.atlas[data-mode="stack"] .flow { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; gap: 26px; }
.atlas[data-mode="stack"] .lane { grid-column: auto !important; grid-row: auto !important; grid-template-rows: none !important; grid-template-columns: none !important; gap: 10px; }
.atlas[data-mode="stack"] .lane > * { grid-row: auto !important; grid-column: auto !important; }
.atlas[data-mode="stack"] ol.nodes > li { grid-row: auto !important; grid-column: auto !important; }
.atlas[data-mode="stack"] .band ol.nodes { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; grid-template-rows: none !important; grid-auto-flow: row dense; }
/* The detail sits inside the selected node's item; in a two-column band that item takes the whole
   row (or its height would stretch the node beside it), and dense placement fills the gap. */
.atlas[data-mode="stack"] .band ol.nodes > li.with-detail { grid-column: 1 / -1 !important; }
.atlas[data-mode="stack"] svg.wires { display: none; }
.atlas[data-mode="stack"] .board { gap: 26px !important; width: auto; min-width: 0; }
.atlas[data-mode="stack"] .group-box, .atlas[data-mode="stack"] .group-legend { display: none !important; }
.atlas[data-mode="stack"] .lane-gap { display: none; }
`;
