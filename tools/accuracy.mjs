// Accuracy check: does every number in an explainer appear in the original text?
// The prompt's own rule says "Copy every number, percentage and amount exactly as the text writes it",
// so a number the original never wrote is a mistake we can count.
//
// It opens the site in headless Chrome, explains each built-in sample, finds every number in the explainer and
// looks it up in the original. It also checks that every section is there. "Historical context" is skipped: it is
// the one section allowed to use knowledge from outside the text. Headless Chrome has no Gemini Nano, so this
// measures the cloud model.
//
// Usage:  node tools/accuracy.mjs [site URL, default http://localhost:5173/]
//         CHROME_PATH=/path/to/chrome node tools/accuracy.mjs   (if Chrome is not in the usual place)
// Prints one line per explainer and a total, writes accuracy-results.json (every explainer in full),
// and exits with code 1 if any number is not in the original or a section is missing.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE = process.argv[2] || "http://localhost:5173/";
const CHROME = process.env.CHROME_PATH || {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
}[process.platform] || "/usr/bin/google-chrome";

// Each sample on the page, how often to run it, and how many sections its explainer has.
const RUNS = [
  { mode: "today", match: "Council", times: 2, sections: 6 },
  { mode: "today", match: "Campaign", times: 2, sections: 6 },
  { mode: "today", match: "Bill summary", times: 2, sections: 6 },
  { mode: "today", match: "Minimum wage", times: 1, sections: 6 },
  { mode: "history", match: "Lincoln", times: 1, sections: 8 },
  { mode: "history", match: "Pankhurst", times: 1, sections: 8 },
  { mode: "history", match: "Roosevelt", times: 1, sections: 8 },
  { mode: "compare", match: "Two bus plans", times: 1, sections: 6 },
  { mode: "compare", match: "Two housing pledges", times: 1, sections: 6 },
];

// "£40 million" -> "40", "1,200" -> "1200", "35%" -> "35"; years and decimals are kept as written.
const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const nums = (s) => (s.match(NUM) || []).map((n) => n.replace(/,/g, ""));
const CONTEXT = /Historical context|Contesto storico|Contexte historique|Contexto histórico|Historischer Kontext/i;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pp-accuracy-"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(SITE, { waitUntil: "networkidle0" });

const out = [];
for (const r of RUNS) {
  for (let i = 0; i < r.times; i++) {
    let res = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      await page.evaluate((mode, match) => {
        document.querySelector(`[data-mode=${mode}]`).click();
        document.querySelector("[data-level=balanced]").click();
        [...document.querySelectorAll(".chip")].find((c) => c.textContent.includes(match)).click();
        document.getElementById("explain").click();
      }, r.mode, r.match);
      await page.waitForFunction(() => !document.getElementById("actions").hidden || !document.getElementById("error").hidden, { timeout: 90000 });
      const got = await page.evaluate(() => ({
        error: document.getElementById("error").hidden ? null : document.getElementById("error").innerText,
        source: [...document.querySelectorAll("textarea")].map((t) => t.value).join("\n\n"),
        badge: document.getElementById("badge").innerText.replace(/\s+/g, " ").trim(),
        cards: [...document.querySelectorAll("#output .card")].map((c) => ({ h: c.querySelector("h3")?.innerText.trim() ?? "", t: c.innerText })),
      }));
      if (got.error) { console.log(`retry ${r.match}: ${got.error.slice(0, 80)}`); await new Promise((s) => setTimeout(s, 8000)); continue; }
      res = got;
    }
    if (!res) { out.push({ sample: r.match, run: i + 1, failed: true }); console.log(`${r.match} #${i + 1}: FAILED after 3 tries`); continue; }
    const inOriginal = new Set(nums(res.source));
    const checked = res.cards.filter((c) => !CONTEXT.test(c.h));
    const found = checked.flatMap((c) => nums(c.t).map((n) => ({ n, section: c.h })));
    const missing = found.filter((f) => !inOriginal.has(f.n));
    out.push({ sample: r.match, mode: r.mode, run: i + 1, ranOn: res.badge, sections: res.cards.length, sectionsOk: res.cards.length === r.sections,
      numbers: found.length, matched: found.length - missing.length, missing, cards: res.cards });
    console.log(`${r.match} #${i + 1}: ${found.length - missing.length}/${found.length} numbers in the original, ${res.cards.length} sections, ${res.badge}`);
  }
}
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
fs.writeFileSync("accuracy-results.json", JSON.stringify(out, null, 2));

const ok = out.filter((o) => !o.failed);
const total = ok.reduce((a, o) => a + o.numbers, 0), matched = ok.reduce((a, o) => a + o.matched, 0);
const complete = ok.filter((o) => o.sectionsOk).length;
console.log(`\nTOTAL: ${ok.length} explainers, ${matched}/${total} numbers found in the original, sections complete in ${complete}/${ok.length}`);
for (const o of ok) for (const m of o.missing) console.log(`NOT IN THE ORIGINAL: ${o.sample} #${o.run}, ${m.section}: ${m.n}`);
process.exitCode = matched === total && complete === ok.length && ok.length === out.length ? 0 : 1;
