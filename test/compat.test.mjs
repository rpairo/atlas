// Boards without saved layers are placed and routed exactly as by v0.3.2: the fingerprints of
// test/compat/v0.3.2.json, made by test/compat/fingerprint.mjs from that release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fingerprints } from "./compat/fingerprint.mjs";

const saved = JSON.parse(readFileSync(new URL("./compat/v0.3.2.json", import.meta.url), "utf8"));
const repo = fileURLToPath(new URL("..", import.meta.url));

test(`layout() and route() give what ${saved.release} gave, on ${saved.boards.length} boards`, async () => {
  const now = await fingerprints(repo, saved.boards);
  const changed = saved.boards.filter((b, i) => b.layout !== now[i].layout || b.routes.horizontal !== now[i].routes.horizontal || b.routes.vertical !== now[i].routes.vertical).map(b => b.name);
  assert.deepEqual(changed, []);
});
