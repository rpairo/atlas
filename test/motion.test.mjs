import { test } from "node:test";
import assert from "node:assert/strict";
import { moveMs, planMove, sameShape, toFlow } from "../src/motion.js";

test("a move lasts as long as its longest travel needs, between 250 and 700 ms", () => {
  assert.deepEqual([0, 10, 50, 200, 412, 600, 756, 2000].map(moveMs), [250, 250, 291, 433, 556, 640, 700, 700]);
});

test("a rigid shift, and one node moving alone, move in one stage", () => {
  const shift = Array.from({ length: 40 }, (_, i) => ({ id: "n" + i, dx: -180, dy: 0 }));
  assert.deepEqual(pick(planMove(shift, "right")), { split: false, f: 1, ms: moveMs(180) });
  const one = [{ id: "a", dx: -600, dy: 120 }, { id: "b", dx: 0, dy: -49 }, { id: "c", dx: 0, dy: -49 }];
  assert.equal(planMove(one, "right").split, false);
});

test("many nodes changing lane and row move along the flow first, then across", () => {
  const moves = [{ id: "a", dx: -412, dy: 49 }, { id: "b", dx: -412, dy: -98 }, { id: "c", dx: -412, dy: 0 }, { id: "d", dx: 0, dy: 196 }];
  const p = planMove(moves, "right");
  assert.equal(p.split, true);
  assert.equal(p.ms, moveMs(412) + moveMs(196));
  assert.ok(Math.abs(p.f - moveMs(412) / p.ms) < 1e-9);
  // After the along part, a node keeps only its across offset (right/left: y; down/up: x).
  assert.deepEqual(p.moves.find(m => m.id === "a").mid, [0, 49]);
  const down = planMove(moves.map(m => ({ ...m, dx: m.dy, dy: m.dx })), "down");
  assert.deepEqual(down.moves.find(m => m.id === "a").mid, [49, 0]);
});

test("a few pixels along the flow (a gutter widening by a track) is not a lane change", () => {
  const nudge = Array.from({ length: 8 }, (_, i) => ({ id: "n" + i, dx: -11, dy: i < 4 ? 49 : 0 }));
  assert.equal(planMove(nudge, "right").split, false);
});

test("an edit and its undo take the same time", () => {
  const there = [{ id: "a", dx: -300, dy: 40 }, { id: "b", dx: -300, dy: -80 }, { id: "c", dx: -300, dy: 10 }, { id: "d", dx: 5, dy: 120 }];
  const back = there.map(m => ({ ...m, dx: -m.dx, dy: -m.dy }));
  for (const dir of ["right", "left", "down", "up"]) assert.equal(planMove(there, dir).ms, planMove(back, dir).ms);
});

test("flow coordinates follow the direction", () => {
  assert.deepEqual(toFlow("right", 3, 4), [3, 4]);
  assert.deepEqual(toFlow("left", 3, 4), [-3, 4]);
  assert.deepEqual(toFlow("down", 3, 4), [4, 3]);
  assert.deepEqual(toFlow("up", 3, 4), [-4, 3]);
});

test("a wire reshapes only when every segment keeps its orientation and direction", () => {
  const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
  const a = P([0, 0], [40, 0], [40, 80], [100, 80]);
  assert.equal(sameShape(a, P([0, 10], [60, 10], [60, 50], [130, 50])), true);
  assert.equal(sameShape(a, P([0, 0], [40, 0], [40, -80], [100, -80])), false);   // the middle turns up
  assert.equal(sameShape(a, P([0, 0], [40, 0], [100, 0])), false);                 // fewer points
  assert.equal(sameShape(a, null), false);
});

function pick(p) { return { split: p.split, f: p.f, ms: p.ms }; }
