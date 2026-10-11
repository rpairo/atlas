// Motion planning for edits: pure, so it is tested in Node. The renderer (atlas.js) measures where
// every node was and where it is now, and plays the edit with the Web Animations API.
//
// Stages: exit (ghosts of removed nodes fade out) → move → enter (new nodes fade in), each skipped
// when empty. A move lasts as long as its longest travel needs (longer travel, longer move), never
// a fixed time, so an edit and its undo take the same time.

export const MOTION = {
  exit: 150,                            // ms
  enter: 200,                           // ms
  exitEase: "cubic-bezier(.3,0,1,1)",
  enterEase: "cubic-bezier(0,0,0,1)",
  ease: "cubic-bezier(.2,0,0,1)",
  cue: 600,                             // ms: the tint that marks a change under reduced motion
};

/** Duration of a move whose longest travel is `d` px: 250 ms at least, 700 ms at most. */
export function moveMs(d) {
  return Math.round(Math.min(700, Math.max(250, 150 + 20 * Math.sqrt(Math.max(0, d)))));
}

/**
 * Whether a wire can reshape from `a` to `b` (screen points) by moving its vertices: same number of
 * points, and every segment keeps its orientation and its direction. Moving each vertex in a
 * straight line then keeps every segment horizontal or vertical on the way.
 */
export function sameShape(a, b) {
  if (!a || !b || a.length !== b.length || a.length < 2) return false;
  for (let i = 1; i < a.length; i++) if (segment(a[i - 1], a[i]) !== segment(b[i - 1], b[i])) return false;
  return true;
}

function segment(p, q) {
  const dx = q.x - p.x, dy = q.y - p.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return "0";
  if (Math.abs(dy) < 0.5) return dx > 0 ? "E" : "W";
  if (Math.abs(dx) < 0.5) return dy > 0 ? "S" : "N";
  return "?";
}
