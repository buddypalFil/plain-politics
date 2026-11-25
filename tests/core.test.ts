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

test("offline + device ready -> device only, even if cloud was chosen", () => {
  assert.equal(chooseRoute({ ...base, offline: true }).ok && chooseRoute({ ...base, offline: true }).mode, "only_on_device");
  const c = chooseRoute({ ...base, choice: "cloud", offline: true });
  assert.equal(c.ok && c.mode, "only_on_device");
});

test("offline without a device model, or text too long -> clear error, nothing sent", () => {
  const none = chooseRoute({ ...base, deviceStatus: "unavailable", offline: true });
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.reason : "", /offline/);
  const long = chooseRoute({ ...base, chars: 50000, offline: true });
  assert.equal(long.ok, false);
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

test("markdown renderer: a note in italics written twice (*_like this_*) shows no underscores", () => {
  const html = renderMarkdown("*_From the AI's general knowledge, not from the text. Check it._*");
  assert.ok(!html.includes("_"), html);
  assert.match(html, /<em>/);
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
  const p = buildPrompt("Some text", "it");
  for (const h of HEADINGS.it) assert.ok(p.includes(`## ${h}`));
  assert.ok(p.includes("Italian"));
});

test("speed vs detail changes the length, never the six sections", () => {
  const quick = buildPrompt("Some text", "en", "quick");
  const balanced = buildPrompt("Some text", "en", "balanced");
  const detailed = buildPrompt("Some text", "en", "detailed");
  for (const p of [quick, balanced, detailed]) for (const h of HEADINGS.en) assert.ok(p.includes(`## ${h}`));
  assert.ok(quick.includes("under 12 words") && quick.includes("Exactly 1 bullet point"));
  assert.ok(balanced.includes("under 20 words") && balanced.includes("2 to 4 bullet points"));
  assert.ok(detailed.includes("3 to 6 bullet points"));
  assert.ok(!detailed.includes("under 12 words") && !detailed.includes("under 20 words"));
});

test("History mode adds persuasion and a clearly labelled context section", () => {
  const today = buildPrompt("Some text", "en");
  const hist = buildPrompt("Some text", "it", "balanced", "history");
  assert.ok(!today.includes("Historical context") && !today.includes("persuade"));
  assert.ok(hist.includes("## Come cerca di convincere"));
  assert.ok(hist.includes("## Contesto storico"));
  assert.ok(hist.includes("eight sections"));
  assert.ok(hist.includes("non dal testo"));
  assert.ok(hist.includes("do not judge whether the cause was right"));
});

test("italics render safely and leave snake_case words alone", () => {
  assert.ok(renderMarkdown("_From general knowledge. Check it._").includes("<em>From general knowledge. Check it.</em>"));
  assert.ok(renderMarkdown("a *quiet* word").includes("<em>quiet</em>"));
  assert.ok(!renderMarkdown("snake_case_name here").includes("<em>"));
  assert.ok(renderMarkdown("**bold** stays").includes("<strong>bold</strong>"));
  assert.ok(!renderMarkdown("_<script>x</script>_").includes("<script>"));
});

test("reading age: plain text scores lower than dense official text", async () => {
  const { readingAge } = await import("../src/readability.ts");
  const plain = "The council will build new homes. Some will be cheap to rent. It will take five years. The money comes from a loan. People near the river may see tall buildings. Shops may lose some car parks. The plan starts next year.";
  const dense = "Notwithstanding the aforementioned considerations, the administration's comprehensive infrastructure investment programme necessitates substantial intergovernmental coordination, particularly regarding environmental sustainability obligations and the corresponding fiscal implications for municipal authorities operating within constrained budgetary frameworks.";
  const a = readingAge(plain)!, b = readingAge(dense + " " + dense)!;
  assert.ok(a.age < b.age, `${a.age} < ${b.age}`);
  assert.ok(a.age >= 5 && b.age <= 20);
  assert.equal(readingAge("Too short."), null);
});

test("compare prompt: both texts, six compare sections, neutral rules", async () => {
  const { buildComparePrompt, COMPARE_HEADINGS } = await import("../src/prompt.ts");
  const p = buildComparePrompt("First text about buses.", "Second text about buses.", "en", "balanced");
  assert.ok(p.includes("TEXT A:") && p.includes("First text about buses."));
  assert.ok(p.includes("TEXT B:") && p.includes("Second text about buses."));
  for (const h of COMPARE_HEADINGS.en) assert.ok(p.includes(`## ${h}`), h);
  assert.match(p, /Never say which text is better/);
  assert.match(p, /under 30 words/);
  assert.match(buildComparePrompt("a", "b", "en", "quick"), /under 20 words/);
  assert.doesNotMatch(buildComparePrompt("a", "b", "en", "detailed"), /under \d+ words/);
  assert.match(buildComparePrompt("a", "b", "it"), /## Dove sono diversi/);
});

test("compare samples: fictional pairs with two real texts each", async () => {
  const { COMPARE_SAMPLES } = await import("../src/samples.ts");
  assert.ok(COMPARE_SAMPLES.length >= 2);
  for (const s of COMPARE_SAMPLES) {
    assert.ok(s.a.length > 200 && s.b.length > 200, s.label);
    assert.match(s.a, /fictional/);
    assert.match(s.b, /fictional/);
  }
});

test("spot the spin: finds loaded words by kind, longer phrase wins, no overlaps", async () => {
  const { findSpin, countByKind } = await import("../src/spin.ts");
  const t = "For too long we were forgotten. My opponents say nothing. I will fight for you. We can’t afford to wait: it's time.";
  const m = findSpin(t);
  const got = m.map((x) => `${x.text.toLowerCase()}:${x.kind}`);
  assert.deepEqual(got, ["for too long:emotion", "forgotten:emotion", "my opponents:sides", "nothing:sweeping", "fight for:soft", "can’t afford:pressure", "it's time:pressure"]);
  for (let i = 1; i < m.length; i++) assert.ok(m[i].start >= m[i - 1].end);
  assert.equal(t.slice(m[0].start, m[0].end), "For too long");
  assert.deepEqual(countByKind(m), { emotion: 2, sides: 1, sweeping: 1, soft: 1, pressure: 2 });
});

test("spot the spin: whole words only, wildcard endings, plain text finds nothing", async () => {
  const { findSpin } = await import("../src/spin.ts");
  assert.equal(findSpin("Nevertheless the alwaysOn setting is fine.").length, 0);
  assert.deepEqual(findSpin("They betrayed us. A betrayal.").map((x) => x.text), ["betrayed", "betrayal"]);
  assert.equal(findSpin("The council will build 800 homes over four years.").length, 0);
});

test("spot the spin: highlighted HTML is escaped", async () => {
  const { findSpin, highlightHtml } = await import("../src/spin.ts");
  const t = "<b>Never</b> & always";
  const html = highlightHtml(t, findSpin(t));
  assert.ok(html.startsWith("&lt;b&gt;<mark class=\"k-sweeping\""));
  assert.ok(html.includes("&amp; <mark"));
  assert.ok(!html.includes("<b>"));
});

test("youtube links: common forms become the standard address, others are refused", async () => {
  const { youtubeUrl } = await import("../src/youtube.ts");
  const want = "https://www.youtube.com/watch?v=CHAyepp7ypY";
  for (const u of [
    "https://www.youtube.com/watch?v=CHAyepp7ypY",
    "youtube.com/watch?v=CHAyepp7ypY&t=30s",
    "https://www.youtube.com/watch?feature=share&v=CHAyepp7ypY",
    "https://youtu.be/CHAyepp7ypY?si=abc",
    "https://m.youtube.com/watch?v=CHAyepp7ypY",
    "https://www.youtube.com/shorts/CHAyepp7ypY",
    "  https://www.youtube.com/live/CHAyepp7ypY  ",
  ]) assert.equal(youtubeUrl(u), want, u);
  for (const u of ["https://vimeo.com/123", "https://www.youtube.com/@channel", "not a link", "https://evil.com/youtube.com/watch?v=CHAyepp7ypY"]) assert.equal(youtubeUrl(u), null, u);
});

test("error messages: plain advice, and on-device advice only where it can run", async () => {
  const { friendlyMessage } = await import("../src/errors.ts");
  const on = { deviceReady: true, online: true, dev: false };
  const off = { deviceReady: false, online: true, dev: false };
  assert.match(friendlyMessage("AppCheck: ReCAPTCHA error", off), /anti-abuse check/);
  assert.doesNotMatch(friendlyMessage("AppCheck: ReCAPTCHA error", off), /debug token|This device only/);
  assert.match(friendlyMessage("AppCheck: ReCAPTCHA error", on), /This device only/);
  assert.match(friendlyMessage("Failed to fetch", off), /connection dropped/);
  assert.match(friendlyMessage("anything", { ...off, online: false }), /connection dropped/);
  assert.match(friendlyMessage("Response was blocked due to SAFETY", off), /safety filters/);
  assert.match(friendlyMessage("[400] Cannot access youtube fileUri: video is private", off), /YouTube video couldn't be opened/);
  assert.match(friendlyMessage("[429] RESOURCE_EXHAUSTED", off), /limit/);
  assert.match(friendlyMessage("[503] The model is overloaded", off), /overloaded/);
  assert.match(friendlyMessage("weird", off), /Something went wrong: weird/);
  // A missing YouTube video comes back as a plain 403; it must not read like an App Check failure.
  assert.match(friendlyMessage("[403] The caller does not have permission", { ...off, youtube: true }), /YouTube video couldn't be opened/);
  assert.match(friendlyMessage("AppCheck: ReCAPTCHA error", { ...off, youtube: true }), /anti-abuse check/);
});

test("every language has every heading, and prompts use them", async () => {
  const p = await import("../src/prompt.ts");
  for (const lang of Object.keys(p.LANGUAGE_NAMES) as (keyof typeof p.LANGUAGE_NAMES)[]) {
    assert.equal(p.HEADINGS[lang].length, 6, lang);
    assert.equal(p.COMPARE_HEADINGS[lang].length, 6, lang);
    assert.ok(p.PERSUADES_HEADING[lang] && p.CONTEXT_HEADING[lang], lang);
    assert.ok(p.buildPrompt("Some text here.", lang).includes(`## ${p.HEADINGS[lang][1]}`), lang);
    assert.ok(p.buildPrompt("Some text here.", lang).includes(`in ${p.LANGUAGE_NAMES[lang]}`), lang);
  }
  assert.ok(p.buildComparePrompt("a", "b", "de").includes("## Worin sie sich unterscheiden"));
});

test("stall limit: passes a healthy stream through, gives up on a silent one and cancels it", async () => {
  const { withStallLimit, StalledError } = await import("../src/stream.ts");
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function* steady() { yield "a"; await wait(10); yield "b"; await wait(10); yield "c"; }
  const got: string[] = [];
  for await (const x of withStallLimit(steady(), 200, 100)) got.push(x);
  assert.deepEqual(got, ["a", "b", "c"]);

  // Sends one piece, then goes silent (like a stalled connection).
  async function* silent() { yield "a"; await new Promise(() => {}); }
  let cancelled = false;
  const partial: string[] = [];
  await assert.rejects(async () => {
    for await (const x of withStallLimit(silent(), 200, 40, () => { cancelled = true; })) partial.push(x);
  }, (e: unknown) => e instanceof StalledError && /stream stalled/.test((e as Error).message));
  assert.deepEqual(partial, ["a"]);
  assert.equal(cancelled, true);

  // Nothing at all before the first-piece limit.
  await assert.rejects(async () => { for await (const _ of withStallLimit(silent2(), 30, 1000)) { /* never */ } }, StalledError);
  async function* silent2() { await new Promise(() => {}); yield "never"; }
});

test("stall error gets a plain message", async () => {
  const { friendlyMessage } = await import("../src/errors.ts");
  const m = friendlyMessage("stream stalled: no new text for 25 s", { deviceReady: false, online: true, dev: false });
  assert.match(m, /stopped answering partway through/);
  assert.match(friendlyMessage("Timeout has expired.", { deviceReady: false, online: true, dev: false }), /stopped answering/);
});
