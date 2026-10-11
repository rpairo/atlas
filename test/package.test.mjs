// The package surface: the same names everywhere (source, builds, type declarations), the version
// stamped in both builds, and every path that package.json promises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import * as source from "../src/index.js";
import * as built from "../dist/atlas.js";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const DIST = ["dist/atlas.js", "dist/atlas.global.js"];
const sorted = names => [...names].sort();

/**
 * Value exports of the declaration file. Only two export forms are allowed, so that this stays
 * a complete reading: `export declare class|function|const Name` (values) and
 * `export interface|type Name` (types only).
 */
function declaredValues(dts) {
  const values = new Set();
  for (const line of dts.split("\n")) {
    if (!line.startsWith("export ")) continue;
    const value = /^export declare (?:class|function|const) (\w+)/.exec(line);
    if (value) values.add(value[1]);
    else assert.match(line, /^export (?:interface|type) \w+/, `unsupported export form in types/atlas.d.ts: ${line}`);
  }
  return values;
}

test("the source, the module build and the type declarations export the same names", () => {
  const names = sorted(Object.keys(source));
  assert.deepEqual(sorted(Object.keys(built).filter(n => n !== "VERSION")), names);
  assert.ok("VERSION" in built, "dist/atlas.js exports VERSION");
  assert.deepEqual(sorted(declaredValues(read("types/atlas.d.ts"))), sorted([...names, "VERSION"]));
});

test("both builds carry the package version", () => {
  assert.equal(built.VERSION, pkg.version);
  // A fresh context with only what the build needs at load time (no DOM: no element is defined).
  const context = vm.createContext({ EventTarget });
  vm.runInContext(read("dist/atlas.global.js"), context, { filename: "atlas.global.js" });
  const Atlas = vm.runInContext("globalThis.Atlas", context);
  assert.equal(typeof Atlas, "function");
  assert.equal(Atlas.VERSION, pkg.version);
  for (const name of Object.keys(source)) assert.ok(name in Atlas, `Atlas.${name} in the global build`);
});

test("both builds start with the banner and can be pasted inside an HTML script element", () => {
  const banner = `/*! Atlas ${pkg.version} | MIT | https://github.com/rpairo/atlas */\n`;
  for (const file of DIST) {
    const code = read(file);
    assert.ok(code.startsWith(banner), `${file} starts with the banner`);
    assert.doesNotMatch(code, /<\/script/i, `${file} contains no closing script tag`);
    assert.ok(!code.includes("<!--"), `${file} contains no HTML comment opener`);
  }
});

test("every path in package.json exists", () => {
  const paths = [];
  const collect = v => {
    if (typeof v === "string") paths.push(v);
    else for (const x of Object.values(v)) collect(x);
  };
  collect(pkg.exports);
  paths.push(...pkg.files, pkg.main, pkg.types);
  for (const path of paths) assert.ok(existsSync(new URL(path, root)), `${path} exists`);
});

test("every version a reader copies is the package version, and the changelog has it", () => {
  const files = ["README.md", "CONTRIBUTING.md", "examples/starter/index.html", ...readdirSync(new URL("docs/", root)).filter(f => f.endsWith(".md")).map(f => `docs/${f}`)];
  for (const file of files) {
    for (const [, v] of read(file).matchAll(/(?:@|#)v(\d+\.\d+\.\d+)\b/g)) assert.equal(v, pkg.version, `${file} points at v${v}`);
  }
  assert.ok(read(".github/ISSUE_TEMPLATE/bug_report.yml").includes(`placeholder: ${pkg.version}\n`), "the bug report's version placeholder is the package version");
  const changelog = read("CHANGELOG.md");
  const unreleased = /^## \[Unreleased\]/m.test(changelog);
  // On a release branch the version has its section and compare link; between releases the next
  // changes gather under [Unreleased] and the package keeps the last released version.
  assert.ok(new RegExp(`^## \\[${pkg.version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}`, "m").test(changelog) || unreleased, `CHANGELOG.md has a section for ${pkg.version}`);
  assert.ok(changelog.includes(`\n[${pkg.version}]: https://github.com/rpairo/atlas/`), `CHANGELOG.md links ${pkg.version}`);
});

test("every public member, option and label of Atlas is documented and declared", () => {
  const api = read("docs/api.md"), dts = read("types/atlas.d.ts");
  const members = Object.getOwnPropertyNames(source.Atlas.prototype).filter(n => n !== "constructor" && !n.startsWith("_"));
  for (const m of members) {
    assert.ok(new RegExp(`\`${m}\\b`).test(api), `docs/api.md documents ${m}`);
    assert.ok(new RegExp(`^\\s+(?:readonly |get )?${m}\\b`, "m").test(dts), `types/atlas.d.ts declares ${m}`);
  }
  const labels = [...read("src/atlas.js").match(/const DEFAULT_LABELS = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
  assert.ok(labels.length >= 6);
  for (const l of labels) {
    assert.ok(new RegExp(`\\b${l}\\b`).test(api), `docs/api.md documents the label ${l}`);
    assert.ok(new RegExp(`^\\s+${l}\\??:`, "m").test(dts), `types/atlas.d.ts declares the label ${l}`);
  }
});

test("the module build stays within its size budget", t => {
  // Not minified (it is read in the browser's devtools and pasted into pages). The budget is
  // here to make growth a decision: raise it in the pull request that needs it.
  const BUDGET = 60 * 1024;
  const size = gzipSync(readFileSync(new URL("dist/atlas.js", root))).length;
  t.diagnostic(`dist/atlas.js: ${(size / 1024).toFixed(1)} KB gzip, budget ${(BUDGET / 1024).toFixed(0)} KB`);
  assert.ok(size <= BUDGET, `dist/atlas.js is ${size} bytes gzip, over the budget of ${BUDGET}`);
});
