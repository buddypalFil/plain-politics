// Key facts kept: does each explainer still contain the facts a reader must not lose? The facts for each built-in
// sample are listed in tools/key-facts.json (written before any explainer was checked). It reads the results file of
// tools/accuracy.mjs (cloud, web) or tools/ondevice-accuracy.swift (Apple's on-device model) and counts the facts kept.
//   node tools/key-facts.mjs accuracy-results.json      or      node tools/key-facts.mjs ondevice-results.json
import fs from "node:fs";

const FACTS = JSON.parse(fs.readFileSync(new URL("./key-facts.json", import.meta.url), "utf8"));
const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const CONTEXT = /Historical context|Contesto storico|Contexte historique|Contexto histórico|Historischer Kontext/i;

// The explainer's text without the Historical context section (the one section allowed outside knowledge).
function explainerText(r) {
  if (r.cards) return r.cards.filter((c) => !CONTEXT.test(c.h)).map((c) => c.t).join("\n");
  return (r.markdown ?? "").split(/^##\s+/m).filter((part) => !CONTEXT.test(part.split("\n")[0])).join("\n");
}

let kept = 0, total = 0;
const lost = [];
for (const r of results) {
  if (r.failed || r.error) continue;
  const label = Object.keys(FACTS).find((k) => k !== "_about" && (k === r.sample || k.startsWith(r.sample)));
  if (!label) continue;
  const text = explainerText(r);
  const facts = FACTS[label];
  const missing = facts.filter((f) => !f.any.some((p) => new RegExp(p, "i").test(text)));
  kept += facts.length - missing.length;
  total += facts.length;
  console.log(`${label} #${r.run}: ${facts.length - missing.length}/${facts.length} key facts kept`);
  for (const m of missing) lost.push(`${label} #${r.run}: ${m.fact}`);
}
console.log(`\nTOTAL: ${kept}/${total} key facts kept (${total ? Math.round((100 * kept) / total) : 0}%)`);
for (const l of lost) console.log(`LOST: ${l}`);
