import { test } from "node:test";
import assert from "node:assert/strict";
import { moveMs, sameShape } from "../src/motion.js";

test("a move lasts as long as its longest travel needs, between 250 and 700 ms", () => {
  assert.deepEqual([0, 10, 50, 200, 412, 600, 756, 2000].map(moveMs), [250, 250, 291, 433, 556, 640, 700, 700]);
});

test("a wire reshapes only when every segment keeps its orientation and direction", () => {
  const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
  const a = P([0, 0], [40, 0], [40, 80], [100, 80]);
  assert.equal(sameShape(a, P([0, 10], [60, 10], [60, 50], [130, 50])), true);
  assert.equal(sameShape(a, P([0, 0], [40, 0], [40, -80], [100, -80])), false);   // the middle turns up
  assert.equal(sameShape(a, P([0, 0], [40, 0], [100, 0])), false);                 // fewer points
  assert.equal(sameShape(a, null), false);
});

