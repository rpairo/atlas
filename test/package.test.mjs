// The package surface: the same names everywhere (source, builds, type declarations), the version
// stamped in both builds, and every path that package.json promises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
