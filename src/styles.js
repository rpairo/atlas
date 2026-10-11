// The component's stylesheet. Every colour and size is a custom property of the .atlas wrapper,
// read from an `--atlas-*` variable of the page when it exists, so a host page themes it without
// reaching inside the shadow root. Dark values apply with prefers-color-scheme or theme="dark".
//
// The variables live on .atlas, not on :host: a rule for :host applies to the host element itself,
// where the page's own variables are, so `--paper` there would collide with a page that also has
// `--paper` and sets `--atlas-paper: var(--paper)` (a cycle that leaves both empty). On .atlas
// they only shadow what is inside, and the same rules work without a shadow root.

export const STYLES = `
:host {
  display: block;
  container-type: inline-size;
}
.atlas {
  --paper: var(--atlas-paper, #f1f4f7);
  --sheet: var(--atlas-sheet, #ffffff);
  --ink: var(--atlas-ink, #132033);
  --ink-2: var(--atlas-ink-2, #55657c);
  --rule: var(--atlas-rule, #cdd6e1);
  --grid: var(--atlas-grid, #e1e7ee);
  --out: var(--atlas-out, #a94e19);
  --in: var(--atlas-in, #2a64a8);
  --shadow: var(--atlas-shadow, rgba(20, 32, 51, .28));
  --radius: var(--atlas-radius, 6px);
  --mono: var(--atlas-font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  --node-min: var(--atlas-node-min, 150px);
  color: var(--ink);
  font: inherit;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) .atlas, :not([theme="light"]) > .atlas {
    --paper: var(--atlas-paper, #0c141e); --sheet: var(--atlas-sheet, #132030); --ink: var(--atlas-ink, #e3eaf2);
    --ink-2: var(--atlas-ink-2, #98a9bd); --rule: var(--atlas-rule, #2a3a4e); --grid: var(--atlas-grid, #152232);
    --out: var(--atlas-out, #e88d52); --in: var(--atlas-in, #6ea8ec); --shadow: var(--atlas-shadow, rgba(0, 0, 0, .55));
  }
}
:host([theme="dark"]) .atlas, [theme="dark"] > .atlas {
  --paper: var(--atlas-paper, #0c141e); --sheet: var(--atlas-sheet, #132030); --ink: var(--atlas-ink, #e3eaf2);
  --ink-2: var(--atlas-ink-2, #98a9bd); --rule: var(--atlas-rule, #2a3a4e); --grid: var(--atlas-grid, #152232);
  --out: var(--atlas-out, #e88d52); --in: var(--atlas-in, #6ea8ec); --shadow: var(--atlas-shadow, rgba(0, 0, 0, .55));
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--in); outline-offset: 2px; }

/* Two stacking contexts: nothing of the board (its lanes and wires have z-indexes) paints over the
   detail panel when the panel is a drawer that overlaps it, and nothing of Atlas over the page. */
.atlas { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); align-items: start; isolation: isolate; }
.atlas[data-panel="side"] { grid-template-columns: minmax(0, 1fr) var(--atlas-panel-width, 300px); }
.atlas[data-panel="none"] .panel { display: none; }

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
}
/* The board is geometry: lanes, corridors and wires are measured left to right, so it stays left to
   right on a right-to-left page (each text follows its own direction, see txt() in atlas.js). */
.board-wrap { min-width: 0; overflow-x: auto; isolation: isolate; direction: ltr; }

/* Bands and lanes */
.lane-title {
  margin: 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-2);
  display: flex; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere;
}
.lane-title::after { content: ""; flex: 1; height: 1px; background: var(--rule); }
.lane-title:empty { display: none; }
ol.nodes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; min-width: 0; }
ol.nodes > li { min-width: 0; display: grid; }
ol.nodes > li > .panel { margin-top: 10px; }
.band { display: grid; gap: 10px; min-width: 0; position: relative; z-index: 1; }
.band.after .lane-title { order: 2; }
.flow { display: grid; min-width: 0; position: relative; z-index: 1; }
.lane { display: grid; min-width: 0; }
.group-box {
  position: relative; border: 1px dashed var(--rule); border-radius: calc(var(--radius) + 2px);
  margin: -6px; pointer-events: none; z-index: 0;
}
.group-box > span {
  position: absolute; top: -9px; left: 10px; max-width: calc(100% - 20px); padding: 0 6px; background: var(--paper);
  font: 500 11px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere;
}

/* Nodes */
.node {
  position: relative; display: block; width: 100%; min-width: 0; text-align: start;
  background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px;
  padding: 9px 12px 10px; cursor: pointer;
  transition: opacity .2s, border-color .2s, box-shadow .2s;
}
.node .t { display: block; font-weight: 600; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.node .s { display: block; font: 11.5px/1.35 var(--mono); color: var(--ink-2); margin-top: 2px; overflow-wrap: anywhere; }
.node:hover { border-color: var(--ink-2); }
/* Nodes outside the selection step back without losing their text: paper instead of sheet, a faint
   border and the secondary ink, which keeps 4.5:1 on the paper (WCAG 1.4.3). Opacity would not. */
.board.has-selection .node:not(.on, .near-in, .near-out) { background: var(--paper); border-color: var(--grid); }
.board.has-selection .node:not(.on, .near-in, .near-out) .t { color: var(--ink-2); }   /* colour only: a lighter weight would rewrap titles and move nodes */
.node.on { border-color: var(--out); box-shadow: 0 0 0 1.5px var(--out); }
.node.near-out { border-color: var(--out); }
.node.near-in { border-color: var(--in); }

/* Wires: above the nodes; routing keeps them in the corridors, so they never cover one. */
svg.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
.casing { fill: none; stroke: var(--paper); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.wire { fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.wire.out { stroke: var(--out); } .wire.in { stroke: var(--in); }
.wire.backward { stroke-dasharray: 6 4; }
.arrow.out, .dot.out { fill: var(--out); } .arrow.in, .dot.in { fill: var(--in); }
.dot { stroke: var(--sheet); stroke-width: 1.5; }
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
  background: var(--sheet); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 18px 18px 20px; display: grid; gap: 12px; min-width: 0;
}
.atlas[data-panel="side"] .panel { position: sticky; top: 16px; }
.atlas[data-panel="below"] .panel { position: sticky; bottom: 12px; max-height: 42vh; overflow: auto; box-shadow: 0 12px 32px -8px var(--shadow); }
.panel .p-lane { margin: 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-2); }
.panel .p-title { margin: 0; font-size: 1.4rem; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
.panel .p-sub { margin: 0; font: 12.5px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
.panel li { overflow-wrap: anywhere; }
.panel ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; list-style: disc; } /* inline, the panel sits in a lane's list */
.rel { display: grid; gap: 6px; }
.rel .r-title { margin: 4px 0 0; font: 500 11.5px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .09em; display: flex; align-items: center; gap: 8px; }
.rel .r-title::before { content: ""; width: 16px; height: 2px; }
.rel[data-dir="in"] .r-title { color: var(--in); } .rel[data-dir="in"] .r-title::before { background: var(--in); }
.rel[data-dir="out"] .r-title { color: var(--out); } .rel[data-dir="out"] .r-title::before { background: var(--out); }
.rel ul { list-style: none; padding: 0; }
.rel button { display: grid; gap: 1px; width: 100%; min-width: 0; text-align: start; background: transparent; border: 1px solid var(--rule); border-radius: 4px; padding: 7px 10px; cursor: pointer; }
.rel button:hover { border-color: var(--ink-2); }
.rel .rt { font-weight: 600; font-size: 13.5px; }
.rel .rd { font-size: 12px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.rel .rw { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; overflow-wrap: anywhere; }
.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Stacked: lanes one after another, no wires, the detail opens under the node. Every grid of the
   flow layout sets its tracks and positions inline; here they all go back to one column, and the
   parts that only exist for wires (gutters, channels) leave the grid, or their explicit positions
   would open implicit columns. */
.atlas[data-mode="stack"] .board { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .board > * { grid-column: auto !important; grid-row: auto !important; }
.atlas[data-mode="stack"] .gutter, .atlas[data-mode="stack"] .channel { display: none; }
.atlas[data-mode="stack"] .band { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }
.atlas[data-mode="stack"] .band > * { grid-column: auto !important; grid-row: auto !important; order: 0 !important; }
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
.atlas[data-mode="stack"] .group-box { display: none; }
.atlas[data-mode="stack"] .lane-gap { display: none; }
`;
