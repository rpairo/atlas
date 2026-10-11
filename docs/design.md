# Design

Atlas came out of a home-automation map that needed to grow by hand without falling apart. Seven
independent research passes (layered placement, mental-map stability, orthogonal routing, existing
engines, information design, architecture, animation) and a critical review shaped it. This page keeps
the decisions and their reasons.

## Where a node goes

Engines that place nodes from relations alone (dagre, plain Sugiyama) redraw the whole map when an
edge changes, and with cycles they invent an order nobody chose. Mature engines put declared
structure first: ELK partitions and layer constraints, Graphviz `rank`, yFiles layer and sequence
constraints and its from-sketch incremental mode. Atlas follows that order:

1. **Declared lane** (a hard constraint, like an ELK partition). Without lanes, layers come from the
   relations: the first time, cycles broken by depth-first search in document order and layers by
   longest path. Atlas then saves each node's layer in the board and keeps it through edits, like
   ELK's interactive layerer and yFiles' incremental mode: only edges inside a strongly connected
   component that go against the saved order are reversed, and when an edit makes the saved layers
   impossible the nodes after the conflict are pushed forward or the ones before it pulled back,
   whichever moves fewer (new nodes take the column after their inputs, or a new column between).
   A graph-drawing review measured it on 800 random boards and 6,000 edits: edits that reorder some
   pair of columns fall from about 50% to 22%, within a point of what any honest layering must
   reorder (network simplex from scratch and minimum-width layering did no better than longest
   path, because they recompute everything from the edges).
2. **Constraints**: groups contiguous, then `before`, `first`, `last` by a stable topological sort, so
   constraints win while moving as little as possible. Contradictions are rejected by validation.
3. **The sketch**: the document order. Studies on the mental map (Misue, Eades, Lai, Sugiyama 1995;
   Archambault & Purchase 2012) find preserved order helps exactly the tasks a map is used for:
   finding a place and following a path. Adding never inverts an existing pair; reordering is explicit.
4. **Relations**: inside a lane, median sweeps and local transposition (Gansner et al. 1993), counting
   crossings locally; same-lane edges prefer origin before destination.
5. **Balance**: one grid of row slots as tall as the longest lane; each shorter lane places its nodes
   (keeping their order) at the median slot of their neighbours with an O(n·R) dynamic programme.
   Rows depend on the board alone, so undo, rename and redraw are exact.

## Wires

Crossings matter most to readers, then path continuity and bends (Purchase 1997; Ware et al. 2002).
Wires are orthogonal and run only through free corridors (gutters between lanes and channels beside
the bands), drawn above the nodes, so none can pass under or over one. Wires of the selected node
that share sides and corridors travel as a bundle (a hyperedge, as in ELK and Sander 2003) that
branches at the end. Loops, wires that come back to the side they left (within a lane or a band),
never bundle: nested loops on one track always cross, so each gets its own track. Ports spread along
each side; tracks get one lane each in every corridor; their order comes from exhaustive search over
small permutations, then a joint pass over a side's ports and the tracks of the corridor next to it;
when there are too many orders to try at once, sets of wires that share no corridor or side are
searched separately. Separation below 6 px counts as a defect, not a cost. Corridors are sized for
the busiest possible selection, so selecting never moves a node. Backward edges are dashed.

Known limit: the permutation search is meant for the wires of one node (tens). Drawing every wire at
once would need the polynomial ordering of Wybrow et al. (2009) or Hegemann & Wolff (2023).

## Animation

Edits animate in stages, exit → move → enter (Bach et al., GraphDiaries; Crnovrsanin et al. 2020),
each skipped when empty, with FLIP on the Web Animations API (`src/motion.js` plans, `atlas.js`
plays). Every position is read before any animation starts: reading after a write makes the browser
lay the page out again, once per node, which froze Chrome for 200 ms on 300 nodes. The exit takes
150 ms and the enter 200 ms (Material: exits shorter than entrances); a move lasts
`clamp(250, 150 + 20·√D, 700)` ms for its longest travel D, so longer travel takes longer and an edit
and its undo take the same time. When at least three nodes change lane and three change row, the
move runs along the flow first, then across it (staging, Heer and Robertson 2007), instead of every
node cutting diagonally through the others. There is no per-node stagger: Chevalier, Dragicevic and
Franconeri (2014) found it of no help for tracking. Lane titles and group boxes move with their
nodes. A move cut by another edit continues from where the nodes are seen.

Wires that keep their shape (same points, every segment keeping its orientation) reshape with the
nodes by animating the path's `d` where the browser can (Chrome, Edge, Firefox): moving each vertex
in a straight line keeps every segment straight. Unchanged wires stay; the others fade out and trace
again once the nodes are in place, at constant speed (1,150 px/s, bundles 90 ms apart, merging
inputs timed to arrive together). View Transitions were measured and rejected again: scoped to the
board they cost 50-100 ms long tasks throughout, clicks during them land on the page, a second edit
skips the first, and wires are snapshots. Under reduced motion nothing travels (Apple's guidance:
removing animation entirely hurts usability): changed nodes get a tint that fades, new ones fade in,
wires appear at once. `animate: false` turns all motion off.

## Architecture

model (format, validation, operations) → layout (pure) → corridor demand (pure) → DOM on a CSS grid
with subgrid → one measuring pass → route (pure, flow coordinates: every direction is the same problem
rotated) → SVG in three layers (halos, wires, marks). Undo keeps snapshots, so it is exact. The custom
element is a thin wrapper. No Worker: placement and routing take milliseconds on boards like the
examples (the incident-response example, 35 nodes and 66 edges, routes its busiest selection in under
10 ms in Node; run `node test/bench-route.mjs` to measure a board). The search for the order of
wires has a budget, `ROUTE.budget`, counted in work rather than time so every machine draws the
same: a node with dozens of wires whose crossings cannot all be avoided stops at a few hundred
milliseconds with the best order found, instead of trying every order.

## References

- Sugiyama, Tagawa, Toda (1981). Methods for visual understanding of hierarchical system structures.
- Gansner, Koutsofios, North, Vo (1993). A technique for drawing directed graphs. IEEE TSE.
- Eades, Lin, Smyth (1993). A fast and effective heuristic for the feedback arc set problem.
- Misue, Eades, Lai, Sugiyama (1995). Layout adjustment and the mental map. JVLC.
- Diehl, Görg (2002). Graphs, they are changing. GD.
- Archambault, Purchase (2012). The mental map and memorability in dynamic graphs.
- Purchase (1997). Which aesthetic has the greatest effect on human understanding? GD.
- Ware, Purchase, Colpoys, McGill (2002). Cognitive measurements of graph aesthetics.
- Wybrow, Marriott, Stuckey (2009). Orthogonal connector routing. GD.
- Hegemann, Wolff (2023). A simple pipeline for orthogonal graph drawing. GD.
- Heer, Robertson (2007). Animated transitions in statistical data graphics. InfoVis.
- Crnovrsanin et al. (2020). Staged animation strategies for online dynamic networks.
- Chevalier, Dragicevic, Franconeri (2014). The not-so-staggering effect of staggered animated transitions.
- North (1995). Incremental layout in DynaDAG. GD.
- Eclipse Layout Kernel, Layered algorithm reference; yFiles incremental hierarchical layout.
