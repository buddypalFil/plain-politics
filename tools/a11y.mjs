// Accessibility check with axe-core over the screens a visitor actually sees (Lighthouse only tests the empty
// front page): the front page, a Today explainer, the claim drawer with Spot the spin filtered, large and easy
// reading, History, Compare and the privacy guard, each in light and dark, on a laptop and (front page and Today)
// a phone. Needs the dev server with App Check set up (see Run it yourself in the README), Chrome and axe-core.
//
// Usage:  npm i --no-save axe-core        (once; it is not one of the app's own dependencies)
//         node tools/a11y.mjs [site URL, default http://localhost:5173/]
//         AXE_PATH=/path/to/axe.min.js CHROME_PATH=/path/to/chrome node tools/a11y.mjs   (other places)
// Prints every problem found (rule, element, where) and exits with code 1 if there is any.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const SITE = process.argv[2] || "http://localhost:5173/";
const CHROME = process.env.CHROME_PATH || {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
}[process.platform] || "/usr/bin/google-chrome";
let AXE = process.env.AXE_PATH;
try { AXE ??= createRequire(import.meta.url).resolve("axe-core/axe.min.js"); } catch {
  console.error("This check needs axe-core. Install it first: npm i --no-save axe-core");
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pp-a11y-"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile });
const page = await browser.newPage();
const $eval = (fn, ...a) => page.evaluate(fn, ...a);
const waitResult = () => page.waitForFunction(() => !document.getElementById("actions").hidden || !document.getElementById("error").hidden, { timeout: 60000 });
async function explainSample(mode, match) {
  await $eval((mode, match) => {
    document.querySelector(`[data-mode=${mode}]`).click();
    document.querySelector("[data-level=balanced]").click();
    [...document.querySelectorAll(".chip")].find((c) => c.textContent.includes(match)).click();
    document.getElementById("explain").click();
  }, mode, match);
  await waitResult();
  const err = await $eval(() => (document.getElementById("error").hidden ? null : document.getElementById("error").innerText));
  if (err) throw new Error(`${match}: ${err}`);
}

const found = new Map(); // rule + element -> { rule, impact, help, target, summary, states:Set }
let runs = 0;
async function audit(state) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await new Promise((r) => setTimeout(r, 350)); // let transitions settle before measuring colours
    if (!(await $eval(() => !!window.axe))) await page.addScriptTag({ path: AXE });
    const v = await $eval(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
      return r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary || "").split("\n").slice(1, 3).join(" ").trim() })) }));
    });
    runs++;
    for (const x of v) for (const n of x.nodes) {
      const key = `${x.id} | ${n.target}`;
      if (!found.has(key)) found.set(key, { rule: x.id, impact: x.impact, help: x.help, target: n.target, summary: n.summary, states: new Set() });
      found.get(key).states.add(`${state}/${scheme}`);
    }
  }
}

for (const [label, w, h] of [["laptop", 1280, 900], ["phone", 390, 844]]) {
  await page.setViewport({ width: w, height: h, isMobile: label === "phone", hasTouch: label === "phone" });
  await page.goto(SITE, { waitUntil: "networkidle0" });
  await audit(`${label} front page`);
  await explainSample("today", "Council");
  await audit(`${label} Today`);
  if (label === "laptop") {
    await $eval(() => document.querySelector("#spin-kinds [data-kind=pressure]")?.click());
    await $eval(() => document.querySelector(".check-claim")?.click());
    await page.waitForFunction(() => document.querySelector(".check-claim.done") || /Couldn/.test(document.querySelector(".claim-drawer")?.innerText ?? ""), { timeout: 45000 }).catch(() => {});
    await audit(`${label} claim drawer + spin filter`);
    await $eval(() => { const s = document.getElementById("reading"); s.value = "large easy"; s.dispatchEvent(new Event("change")); });
    await audit(`${label} large + easy reading`);
    await $eval(() => { const s = document.getElementById("reading"); s.value = "normal"; s.dispatchEvent(new Event("change")); });
    await explainSample("history", "Lincoln");
    await audit(`${label} History`);
    await explainSample("compare", "Two bus plans");
    await audit(`${label} Compare`);
    await $eval(async () => {
      document.querySelector("[data-mode=today]").click();
      document.getElementById("run").value = "cloud";
      const i = document.getElementById("input");
      i.value = "Dear MP, my name is Jordan Patel. Please write to jordan.patel@example.com or call 07700 900123 about the bus cuts in Northvale.";
      i.dispatchEvent(new Event("input"));
      document.getElementById("explain").click();
      await new Promise((r) => setTimeout(r, 1500));
    });
    await audit(`${label} privacy guard`);
    await $eval(() => { document.getElementById("run").value = "auto"; });
  }
}
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const list = [...found.values()].sort((a, b) => order[a.impact] - order[b.impact] || a.rule.localeCompare(b.rule));
console.log(`${runs} axe runs, ${list.length} problems (rule + element)`);
for (const f of list) console.log(`${f.impact.toUpperCase()} ${f.rule}: ${f.target}\n   ${f.help}. ${f.summary}\n   in: ${[...f.states].join(", ")}`);
process.exitCode = list.length ? 1 : 0;
