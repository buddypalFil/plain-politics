import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseRoute } from "../src/route.ts";
import { renderMarkdown, escapeHtml, firstLine } from "../src/markdown.ts";
import { buildPrompt, HEADINGS } from "../src/prompt.ts";

const base = { choice: "auto", chars: 1000, deviceCharLimit: 20000, deviceStatus: "available" } as const;

test("auto + device ready -> device first", () => {
  const r = chooseRoute({ ...base });
  assert.equal(r.ok && r.mode, "prefer_on_device");
});

test("cloud choice always goes to the cloud", () => {
  const r = chooseRoute({ ...base, choice: "cloud" });
  assert.equal(r.ok && r.mode, "only_in_cloud");
});

test("long text goes to the cloud on auto, errors on device-only", () => {
  const auto = chooseRoute({ ...base, chars: 50000 });
  assert.equal(auto.ok && auto.mode, "only_in_cloud");
  const dev = chooseRoute({ ...base, choice: "device", chars: 50000 });
  assert.equal(dev.ok, false);
});

test("no on-device model: auto uses cloud, device-only errors", () => {
  const auto = chooseRoute({ ...base, deviceStatus: "unavailable" });
  assert.equal(auto.ok && auto.mode, "only_in_cloud");
  const dev = chooseRoute({ ...base, choice: "device", deviceStatus: "unavailable" });
  assert.equal(dev.ok, false);
});

test("model still downloading: auto stays device-first (Firebase falls back itself)", () => {
  const r = chooseRoute({ ...base, deviceStatus: "downloadable" });
  assert.equal(r.ok && r.mode, "prefer_on_device");
});

test("markdown renderer escapes HTML from the model", () => {
  const html = renderMarkdown('## Title\n- <img src=x onerror=alert(1)> **bold**');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<h3>Title</h3>"));
});

test("markdown renderer groups bullets into one list per section", () => {
  const html = renderMarkdown("## A\n- one\n- two\n## B\nplain line");
  assert.equal((html.match(/<ul>/g) || []).length, 1);
  assert.equal((html.match(/<section/g) || []).length, 2);
  assert.ok(html.includes("<p>plain line</p>"));
});

test("escapeHtml covers quotes", () => {
  assert.equal(escapeHtml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("firstLine skips headings", () => {
  assert.equal(firstLine("## In one sentence\nThe council will build homes."), "The council will build homes.");
});

test("prompt uses the headings of the chosen language", () => {
  const p = buildPrompt("Some text", "it", "full");
  for (const h of HEADINGS.it) assert.ok(p.includes(`## ${h}`));
  assert.ok(p.includes("Italian"));
});
