// The browser audit (test/browser/audit.html) in other engines, through Playwright: the same
// combinations as scripts/audit.sh in CI, and also any page error.
//   npm install --no-save playwright@1.63.0 && npx playwright install firefox webkit
//   node scripts/audit-browsers.mjs [firefox] [webkit] [chromium]
// Playwright is not a dependency of Atlas; CI installs it only for this job.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { firefox, webkit, chromium } from "playwright";

const REPO = fileURLToPath(new URL("..", import.meta.url));
// chrome and msedge are the installed browsers (Playwright channels); chromium is Playwright's own.
const engines = { firefox, webkit, chromium, chrome: chromium, msedge: chromium };
const channel = { chrome: "chrome", msedge: "msedge" };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ["firefox", "webkit"];
const chromiumBased = name => ["chromium", "chrome", "msedge"].includes(name);
const KEYS = ["missing", "underNode", "crossings", "close", "shortTip", "outside", "moved", "unpainted", "covered", "stack", "groups", "motion", "behaviour", "hidden", "loops"];

const runs = [];
for (const b of ["incident-response", "dependencies", "state-machine", "org-chart"]) for (const w of [1400, 900, 500]) runs.push({ board: `../../examples/${b}/board.json`, w });
for (const d of ["left", "up", "down"]) for (const w of [1400, 600]) runs.push({ extra: `&direction=${d}`, w });
for (const w of [1400, 500]) runs.push({ extra: "&rtl=1", w });
for (const w of [1100, 500]) runs.push({ w, h: 800 });
for (const w of [1400, 900, 500]) runs.push({ extra: "&dist=1&hostvars=1", w });
for (const w of [1400, 900, 500]) runs.push({ board: "../fixtures/groups.json", w });
for (const d of ["left", "down"]) runs.push({ board: "../fixtures/groups.json", extra: `&direction=${d}`, w: 1400 });
// Forced colours (Windows contrast themes) are emulated by Chromium only; a dark system theme everywhere.
runs.push({ w: 1400, forced: true, only: chromiumBased }, { w: 900, forced: true, only: chromiumBased });
runs.push({ w: 1400, dark: true }, { board: "../fixtures/groups.json", w: 900, dark: true });

const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
await new Promise(r => setTimeout(r, 700));
let failures = 0;
try {
  for (const name of wanted) {
    const browser = await engines[name].launch(channel[name] ? { channel: channel[name] } : {});
    let clean = 0;
    const mine = runs.filter(r => !r.only || r.only(name));
    for (const run of mine) {
      const ctx = await browser.newContext({ viewport: { width: run.w, height: run.h ?? 2400 }, forcedColors: run.forced ? "active" : "none", colorScheme: run.dark ? "dark" : "light" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
      page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
      const url = `http://127.0.0.1:${port}/test/browser/audit.html?board=${run.board ?? "../../examples/incident-response/board.json"}${run.extra ?? ""}`;
      const label = `${name} ${run.w}x${run.h ?? 2400} ${(run.board ?? "incident-response").replace(/^(\.\.\/)+(examples\/)?/, "").replace(/(\/board)?\.json$/, "")}${run.extra ?? ""}${run.forced ? " forced-colors" : ""}${run.dark ? " dark" : ""}`;
      try {
        await page.goto(url);
        await page.waitForSelector("pre#audit", { state: "attached", timeout: 180000 });
        const r = JSON.parse(await page.textContent("pre#audit"));
        if (r.error) { console.log(`${label}: ERROR ${r.error.slice(0, 600)}`); failures++; }
        else {
          const bad = Object.fromEntries(KEYS.filter(k => r[k]?.length).map(k => [k, r[k]]));
          const editsBad = r.edits.filter(e => /DIFFERENT|MOVED|missing/.test(e));
          const errs = errors.filter(e => !e.includes("favicon"));
          if (Object.keys(bad).length || editsBad.length || errs.length) {
            failures++;
            console.log(`${label}: mode=${r.mode} nodes=${r.nodes} wires=${r.wires}`);
            for (const [k, v] of Object.entries(bad)) console.log(`   ${k}: ${v.length}  ${JSON.stringify(v.slice(0, 4)).slice(0, 500)}`);
            if (editsBad.length) console.log(`   edits: ${JSON.stringify(editsBad)}`);
            for (const e of errs.slice(0, 4)) console.log(`   ${e.slice(0, 300)}`);
          } else clean++;
        }
      } catch (e) { console.log(`${label}: RUNNER ${String(e.message).split("\n")[0]}`); failures++; }
      await ctx.close();
    }
    console.log(`== ${name}: ${clean} of ${mine.length} runs clean`);
    await browser.close();
  }
} finally { server.kill(); }
process.exit(failures ? 1 : 0);
