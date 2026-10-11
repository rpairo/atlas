// Builds the single-file distributions from src/, without any bundler:
//   dist/atlas.js         ES module:      import { Atlas } from "./atlas.js"
//   dist/atlas.global.js  classic script: <script src="atlas.global.js"></script> → window.Atlas
// Each source module becomes a function scope that returns its exports; imports become reads of
// the modules already evaluated. The sources keep to simple single-line import/export forms.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ORDER = ["model", "layout", "route", "styles", "motion", "atlas", "element", "index"];
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;

function transform(name, code) {
  const exported = [];
  const lines = code.split("\n").map(line => {
    let m;
    if ((m = /^import \* as (\w+) from "\.\/(\w+)\.js";$/.exec(line))) return `const ${m[1]} = __modules.${m[2]};`;
    if ((m = /^import \{ ([^}]+) \} from "\.\/(\w+)\.js";$/.exec(line))) return `const { ${renames(m[1])} } = __modules.${m[2]};`;
    if ((m = /^import "\.\/(\w+)\.js";$/.exec(line))) return "";
    if ((m = /^export \{ ([^}]+) \} from "\.\/(\w+)\.js";$/.exec(line))) {
      for (const part of m[1].split(",")) exported.push(part.trim().split(/\s+as\s+/).pop());
      return `const { ${renames(m[1])} } = __modules.${m[2]};`;
    }
    if ((m = /^export \{ ([^}]+) \};$/.exec(line))) {
      for (const part of m[1].split(",")) {
        const [local, as] = part.trim().split(/\s+as\s+/);
        exported.push(as ? `${as}: ${local}` : local);
      }
      return "";
    }
    if ((m = /^export (async function|function|class|const|let) (\w+)/.exec(line))) {
      exported.push(m[2]);
      return line.replace(/^export /, "");
    }
    if (/^(import|export)\b/.test(line)) throw new Error(`${name}: unsupported module syntax: ${line}`);
    return line;
  });
  return `__modules.${name} = (() => {\n${lines.join("\n")}\nreturn { ${exported.join(", ")} };\n})();\n`;
}

/** `{ a, b as c }` in an import becomes `{ a, b: c }` in a destructuring. */
function renames(list) {
  return list.split(",").map(p => p.trim()).filter(Boolean).map(p => {
    const [orig, as] = p.split(/\s+as\s+/);
    return as ? `${orig}: ${as}` : orig;
  }).join(", ");
}

const body = ORDER.map(n => transform(n, readFileSync(new URL(`../src/${n}.js`, import.meta.url), "utf8"))).join("\n");
const banner = `/*! Atlas ${version} | MIT | https://github.com/rpairo/atlas */\n`;
// The package's names are the ones src/index.js exports.
const names = [...readFileSync(new URL("../src/index.js", import.meta.url), "utf8").matchAll(/^export \{ ([^}]+) \} from/gm)]
  .flatMap(m => m[1].split(",").map(n => n.trim().split(/\s+as\s+/).pop()));

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/atlas.js", import.meta.url),
  `${banner}const __modules = {};\n${body}\nexport const { ${names.join(", ")} } = __modules.index;\nexport const VERSION = ${JSON.stringify(version)};\n`);
writeFileSync(new URL("../dist/atlas.global.js", import.meta.url),
  `${banner}(function () {\n"use strict";\nconst __modules = {};\n${body}\nglobalThis.Atlas = Object.assign(__modules.index.Atlas, { ...__modules.index, VERSION: ${JSON.stringify(version)} });\n})();\n`);
console.log(`dist/atlas.js and dist/atlas.global.js (${version})`);
