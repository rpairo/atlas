// Motion planning for edits: pure, so it is tested in Node. The renderer (atlas.js) measures where
// every node was and where it is now, asks for a plan, and plays it with the Web Animations API.
//
// Stages: exit (ghosts of removed nodes fade out) → move → enter (new nodes fade in), each skipped
// when empty. A move lasts as long as its longest travel needs (longer travel, longer move), never
// a fixed time, so an edit and its undo take the same time. When many nodes change lane and many
// change row, the move runs in two parts, along the flow first and then across it (staging, Heer
// and Robertson 2007), instead of every node cutting diagonally through the others at once.

export const MOTION = {
  exit: 150,                            // ms
  enter: 200,                           // ms
  exitEase: "cubic-bezier(.3,0,1,1)",
  enterEase: "cubic-bezier(0,0,0,1)",
  ease: "cubic-bezier(.2,0,0,1)",
  cue: 600,                             // ms: the tint that marks a change under reduced motion
  splitAt: 3,                           // nodes changing lane, and nodes changing row, to split a move
  laneShift: 60,                        // px along the flow that count as changing lane (a gutter that
                                        // widens by a track moves nodes ~11 px: not a lane change)
};

/** Duration of a move whose longest travel is `d` px: 250 ms at least, 700 ms at most. */
export function moveMs(d) {
  return Math.round(Math.min(700, Math.max(250, 150 + 20 * Math.sqrt(Math.max(0, d)))));
}

/**
 * Displacement [along, across] the flow of a screen displacement [dx, dy], for a flow direction.
 */
export function toFlow(direction, dx, dy) {
  switch (direction) {
    case "left": return [-dx, dy];
    case "down": return [dy, dx];
    case "up": return [-dy, dx];
    default: return [dx, dy];
  }
}

/**
 * The plan of a move. `moves` holds, per node that moves, its screen displacement from where it
 * was to where it is now ([dx, dy]). Returns the total duration, the share of it spent along the
 * flow when the move is split (`f`, 1 when it is not), and per node the screen offset it still has
 * after the along-the-flow part (`mid`, or null).
 */
export function planMove(moves, direction) {
  const flow = moves.map(m => ({ ...m, d: toFlow(direction, m.dx, m.dy) }));
  const along = flow.filter(m => Math.abs(m.d[0]) >= MOTION.laneShift).length;
  const across = flow.filter(m => Math.abs(m.d[1]) >= 0.5).length;
  const split = along >= MOTION.splitAt && across >= MOTION.splitAt;
  if (!split) {
    const ms = flow.length ? moveMs(Math.max(...flow.map(m => Math.hypot(m.dx, m.dy)))) : 0;
    return { ms, f: 1, split: false, moves: flow.map(m => ({ id: m.id, dx: m.dx, dy: m.dy, mid: null })) };
  }
  const a = moveMs(Math.max(...flow.map(m => Math.abs(m.d[0]))));
  const c = moveMs(Math.max(...flow.map(m => Math.abs(m.d[1]))));
  const vertical = direction === "down" || direction === "up";
  // After the along part a node is in its new lane and its old row: what is left is the across part.
  return {
    ms: a + c, f: a / (a + c), split: true,
    moves: flow.map(m => ({ id: m.id, dx: m.dx, dy: m.dy, mid: vertical ? [m.dx, 0] : [0, m.dy] })),
  };
}

/**
 * Whether a wire can reshape from `a` to `b` (screen points) by moving its vertices: same number of
 * points, and every segment keeps its orientation and its direction. Moving each vertex in a
 * straight line then keeps every segment horizontal or vertical on the way.
 */
export function sameShape(a, b) {
  if (!a || !b || a.length !== b.length || a.length < 2) return false;
  for (let i = 1; i < a.length; i++) {
    const s = segment(a[i - 1], a[i]), t = segment(b[i - 1], b[i]);
    if (s !== t) return false;
  }
  return true;
}

function segment(p, q) {
  const dx = q.x - p.x, dy = q.y - p.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return "0";
  if (Math.abs(dy) < 0.5) return dx > 0 ? "E" : "W";
  if (Math.abs(dx) < 0.5) return dy > 0 ? "S" : "N";
  return "?";
}
