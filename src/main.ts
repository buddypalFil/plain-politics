// The page: reads the text, picks where to run, streams the explainer,
// and saves it to the library on request.

import "@fontsource/unifrakturmaguntia/latin-400.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/libre-franklin/wght.css";
import "./style.css";
import { buildPrompt, buildComparePrompt, HEADINGS, COMPARE_HEADINGS, LANGUAGE_NAMES, PERSUADES_HEADING, CONTEXT_HEADING, type Lang, type Level, type Mode } from "./prompt.ts";
import { chooseRoute, shouldFallBackToCloud, deviceModelName, type DeviceStatus, type RunChoice } from "./route.ts";
import { compareName } from "./compare.ts";
import { renderMarkdown, firstLine, escapeHtml } from "./markdown.ts";
import { getDeviceStatus, getImageDeviceStatus, hasPromptApi, warmUpDevice } from "./device.ts";
import { readingAge, looksEnglish } from "./readability.ts";
import { SAMPLES, COMPARE_SAMPLES } from "./samples.ts";
import { drawFrontPage } from "./share.ts";
import { youtubeUrl } from "./youtube.ts";
import { friendlyMessage } from "./errors.ts";
import { withStallLimit } from "./stream.ts";
import { findSpin, countByKind, highlightHtml, SPIN_KINDS, type SpinKind } from "./spin.ts";
import { findPersonalData, describeFindings, listFindings, redact, redactKnown, type Finding } from "./privacy.ts";
import { sectionHints } from "./hints.ts";
import {
  isConfigured,
  loadSettings,
  makeModel,
  saveExplainer,
  listExplainers,
  deleteExplainer,
  hasLibraryUser,
  checkClaim,
  readPhoto,
  readMedia,
  type MediaSource,
  type Settings,
  type SavedExplainer,
} from "./firebase.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const input2 = $<HTMLTextAreaElement>("input2"); // Text B, only in Compare mode
const charCount = $("char-count");
const langSel = $<HTMLSelectElement>("lang");
const runSel = $<HTMLSelectElement>("run");
const readingSel = $<HTMLSelectElement>("reading");
const explainBtn = $<HTMLButtonElement>("explain");
const setupBtn = $<HTMLButtonElement>("setup-device");
const deviceHelp = $("device-help");
const pill = $("device-pill");
const badge = $("badge");
const routeNote = $("route-note");
const errorBox = $("error");
const output = $("output");
// One short announcement at the start and end of a run, for screen readers (the streaming text itself isn't announced).
const srStatus = $("sr-status");
const actions = $("actions");
const saveBtn = $<HTMLButtonElement>("save");
const copyBtn = $<HTMLButtonElement>("copy");
const libraryList = $("library");
const privacyBox = $("privacy");
const privacyText = $("privacy-text");
const redactBtn = $<HTMLButtonElement>("redact");
const redactSendBtn = $<HTMLButtonElement>("redact-send");
// The explainer area as the page first shows it, so "Explain another text" can put it back.
const EMPTY_OUTPUT = $("output").innerHTML;
const sourceNote = $("source-note");

let settings: Settings = { cloudModel: "gemini-3.5-flash-lite", deviceCharLimit: 20000, claimGrounding: false };
let deviceStatus: DeviceStatus = "unavailable";
let lastResult: { markdown: string; source: "on_device" | "in_cloud"; lang: Lang; text: string; findings: Finding[]; seconds: string } | null = null;

// ---------- Mode (Today / History) and speed vs detail ----------
const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* private window: fine */ }
  },
};
// Compare needs two text boxes, so it isn't offered in the extension's side panel.
const inPanel = new URLSearchParams(location.search).get("embed") === "1";
let mode: Mode = (["history", ...(inPanel ? [] : ["compare"])] as Mode[]).find((m) => m === store.get("pp-mode")) ?? "today";
const comparing = () => mode === "compare";
// Everything the privacy guard and the router look at: both texts when comparing.
const allText = () => (comparing() ? `${input.value}\n\n${input2.value}` : input.value);
let level: Level = (["quick", "balanced", "detailed"] as const).find((l) => l === store.get("pp-level")) ?? "balanced";

// Typical times on the device (MacBook, a page-long text). The cloud takes a few seconds either way.
const DEVICE_SECONDS: Record<Level, string> = { quick: "about 8 s", balanced: "about 15 s", detailed: "about 25 s" };
const LEVEL_TEXT: Record<Level, string> = {
  quick: "Quick: the key points in very short bullets.",
  balanced: "Balanced: the main points in short bullets.",
  detailed: "Detailed: every section in full.",
};

function sectionNames(): string[] {
  const lang = langSel.value as Lang;
  if (comparing()) return COMPARE_HEADINGS[lang];
  return [...HEADINGS[lang], ...(mode === "history" ? [PERSUADES_HEADING[lang], CONTEXT_HEADING[lang]] : [])];
}
// While the answer streams in, the sections still to come stay as faint outlines.
function pendingSections(md: string, names: string[] = sectionNames()): string {
  const done = (md.match(/^#{1,3}\s/gm) ?? []).length;
  const start = Math.max(done, 1); // section 0 is "In one sentence" (unnumbered); section n is numbered n
  const rest = names.slice(start);
  return rest.length
    ? `<ol class="ghost pending" style="counter-reset: g ${start - 1}">${rest.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ol>`
    : "";
}

// ---------- Where it ran: Your text -> Privacy guard -> Your device / Cloud ----------
function setRoute(where: "device" | "cloud", running: boolean): void {
  const route = $("route");
  route.hidden = false;
  const state: Record<string, string> = { text: "on", guard: "on", device: where === "device" ? "on" : "off", cloud: where === "cloud" ? "on" : "off" };
  for (const n of route.querySelectorAll<HTMLElement>(".n")) {
    const st = state[n.dataset.n!];
    n.className = `n ${st}${running && n.dataset.n === where ? " active" : ""}`;
  }
  const lines = route.querySelectorAll<HTMLElement>(".l");
  lines[0].className = "l on";
  lines[1].className = `l ${where === "device" ? "on" : "skip"}`;
  lines[2].className = `l ${where === "cloud" ? "on" : "skip"}`;
}

// ---------- Compare: "Where they differ" as A and B lines ----------
// The model writes "**Topic**: Text A: ... Text B: ...". Each side gets its own line with an A or B mark.
// If a line doesn't follow that pattern (another language, a different wording), it is left as written.
function shapeDiffer(lang: Lang, names?: [string, string]): void {
  const card = [...output.querySelectorAll(".card")].find((c) => c.querySelector("h3")?.textContent?.trim() === COMPARE_HEADINGS[lang][2]);
  if (!card) return;
  // A key under the heading, so A and B keep their names (the parties) while reading.
  if (names) {
    const key = document.createElement("p");
    key.className = "ab-key";
    key.innerHTML = `<span class="ab"><b>A</b>${escapeHtml(names[0])}</span><span class="ab"><b>B</b>${escapeHtml(names[1])}</span>`;
    card.querySelector("h3")?.after(key);
  }
  for (const li of card.querySelectorAll("li")) {
    const topic = li.querySelector(":scope > strong:first-child");
    const rest = li.innerHTML.slice(topic ? topic.outerHTML.length : 0).replace(/^\s*[:\-–—]\s*/, "");
    const m = rest.match(/^(?:Text(?:e|o|os|s)?|Testo)\s*A\s*:?\s*([\s\S]*?)\s*(?:Text(?:e|o|os|s)?|Testo)\s*B\s*:?\s*([\s\S]*)$/i);
    if (!m) continue;
    li.innerHTML = `${topic ? topic.outerHTML : ""}<span class="ab"><b>A</b>${m[1].replace(/[.;,]\s*$/, ".")}</span><span class="ab"><b>B</b>${m[2]}</span>`;
  }
}

// ---------- Spot the spin (word list, on the device) ----------
const spinBox = $("spin");
const spinKinds = $("spin-kinds");
const spinWhy = $("spin-why");
const spinClips = $("spin-clips");
const SPIN_ALL_WHY = "Pick a kind to see only those words, and why they matter.";
function showSpin(texts: string[]): void {
  const found = texts.map((t) => findSpin(t));
  const total = found.reduce((n, f) => n + f.length, 0);
  const counts = countByKind(found.flat());
  spinBox.hidden = false;
  spinKinds.innerHTML = total
    ? [`<button type="button" data-kind="" aria-pressed="true">All <b>${total}</b></button>`,
       ...(Object.keys(SPIN_KINDS) as SpinKind[]).filter((k) => counts[k]).map((k) => `<button type="button" data-kind="${k}" aria-pressed="false" class="k-${k}">${SPIN_KINDS[k].name} <b>${counts[k]}</b></button>`)].join("")
    : "";
  spinWhy.textContent = total ? SPIN_ALL_WHY
    : texts.some((t) => !looksEnglish(t)) ? "Spot the spin only knows English words for now, so it can't mark this text."
    : "No loaded words from our list in this text.";
  spinClips.className = "spin-clips";
  spinClips.innerHTML = total
    ? texts.map((t, i) => `<div class="clip-wrap">${texts.length > 1 ? `<div class="tlabel">Text ${"AB"[i]} · ${found[i].length}</div>` : ""}<div class="clip" tabindex="0" role="region" aria-label="${texts.length > 1 ? `Text ${"AB"[i]}` : "Your text"}, with loaded words marked">${highlightHtml(t, found[i])}</div></div>`).join("")
    : "";
  scrollClipsToFirst("", false);
}
// In a long text the first marked word may be below the visible part of the box: bring it into view.
function scrollClipsToFirst(kind: SpinKind | "", smooth: boolean): void {
  for (const clip of spinClips.querySelectorAll<HTMLElement>(".clip")) {
    const mark = clip.querySelector<HTMLElement>(kind ? `mark.k-${kind}` : "mark");
    clip.scrollTo({ top: mark ? Math.max(0, mark.offsetTop - 48) : 0, behavior: smooth ? "smooth" : "instant" });
  }
}
spinKinds.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-kind]");
  if (!b) return;
  const kind = b.dataset.kind as SpinKind | "";
  for (const x of spinKinds.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  spinClips.className = `spin-clips${kind ? ` only only-${kind}` : ""}`;
  spinWhy.textContent = kind ? SPIN_KINDS[kind].why : SPIN_ALL_WHY;
  scrollClipsToFirst(kind, true);
});

// ---------- Check this claim ----------
function addClaimButtons(lang: Lang): void {
  // "Claims worth checking" is the third section of an explainer and the fifth of a comparison.
  const names = [HEADINGS[lang][2], COMPARE_HEADINGS[lang][4]];
  const card = [...output.querySelectorAll(".card")].find((c) => names.includes(c.querySelector("h3")?.textContent?.trim() ?? ""));
  if (!card) return;
  for (const li of card.querySelectorAll("li")) {
    // "**Claim**: Check …" shows as the claim in italics, then the note on its own line, without the colon.
    const lead = li.querySelector(":scope > strong:first-child");
    if (lead) {
      const claimText = (lead.textContent ?? "").replace(/[\s:]+$/, "");
      lead.textContent = claimText.charAt(0).toUpperCase() + claimText.slice(1); // a headline starts with a capital
      const next = lead.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE) next.textContent = " " + (next.textContent ?? "").replace(/^\s*[.:\-–—]\s*/, "");
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "check-claim";
    b.innerHTML = `${MAGNIFIER}<span>Check this claim</span>`;
    li.appendChild(b);
  }
}
const MAGNIFIER = `<svg class="mag" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12.8 12.8l4.6 4.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

// A Google Search check starts with one verdict in bold (see checkClaim). Turn it into a stamped badge.
type Verdict = { kind: "yes" | "no" | "mixed" | "unknown"; word: string; rest: string };
function readVerdict(text: string): Verdict | null {
  const m = text.match(/^\s*\*\*([^*\n]{2,60}?)\*\*\s*[:.\-–—]?\s*/);
  if (!m) return null;
  const word = m[1].replace(/[\s:.]+$/, "");
  const w = word.toLowerCase();
  const kind: Verdict["kind"] =
    /not enough|insufficien|pas assez|insuffisant|no hay suficiente|nicht genug|unzureichend/.test(w) ? "unknown"
    : /^(?:not|non|pas|no|nicht)\b/.test(w) ? "unknown"
    : /mixed|mist|mitig|mixte|mixta|gemischt|teilweise/.test(w) ? "mixed"
    : /disputed|contest|discut|cuestion|refut|umstritten|bestritten/.test(w) ? "no"
    : /support|confirm|fondat|étay|soutenu|respald|bestätigt|gestützt|belegt/.test(w) ? "yes"
    : "unknown";
  return { kind, word, rest: text.slice(m[0].length) };
}
// The private answer ("**Kind of claim:** a promise." then "**How to check it:**" and bullets, in any language):
// the kind becomes a tag, the bold label a small heading, and the bullets numbered steps.
function shapeHowToCheck(drawer: HTMLElement): void {
  for (const p of drawer.querySelectorAll<HTMLParagraphElement>(":scope > p:not([class])")) {
    const s = p.firstElementChild;
    if (!s || s.tagName !== "STRONG" || p.firstChild !== s) continue;
    const label = (s.textContent ?? "").replace(/\s*[:：]\s*$/, "");
    const value = (p.textContent ?? "").slice((s.textContent ?? "").length).replace(/^\s*[:：]?\s*/, "").trim();
    if (value) {
      p.outerHTML = `<div class="claim-kind"><span class="ck-label">${escapeHtml(label)}</span><span class="ck-value">${escapeHtml(value.replace(/\.$/, ""))}</span></div>`;
    } else {
      const next = p.nextElementSibling;
      if (next?.tagName === "UL") next.classList.add("claim-steps");
      p.outerHTML = `<div class="ck-label">${escapeHtml(label)}</div>`;
    }
  }
}
const VERDICT_MARK: Record<Verdict["kind"], string> = { yes: "✓", no: "✕", mixed: "~", unknown: "?" };
function verdictHtml(v: Verdict): string {
  return `<div class="verdict v-${v.kind}"><span class="v-mark" aria-hidden="true">${VERDICT_MARK[v.kind]}</span><span class="v-word">${escapeHtml(v.word)}</span></div><span class="v-by">Checked with Google Search</span>`;
}
output.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.check-claim");
  if (!b || b.disabled) return;
  const li = b.closest("li")!;
  // Only the claim itself (the bold part) is checked, not the note on what to check: less goes to the cloud.
  const lead = li.querySelector(":scope > strong:first-child")?.textContent?.replace(/[:\s]+$/, "").trim() ?? "";
  const rawClaim = lead.length >= 12 ? lead
    : (li.firstChild ? [...li.childNodes].filter((n) => n !== b && !(n instanceof HTMLElement && n.classList.contains("claim-drawer"))).map((n) => n.textContent).join("") : "").trim();
  // If the original text had personal details, the claim gets the same details removed, and it is only
  // checked on this device, whatever "Run on" says now. (A name found once is removed everywhere.)
  const personalText = (lastResult?.findings.length ?? 0) > 0;
  const claim = personalText ? redactKnown(rawClaim, lastResult!.findings) : rawClaim;
  const lang = (lastResult?.lang ?? langSel.value) as Lang;
  let drawer = li.querySelector<HTMLElement>(".claim-drawer");
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.className = "claim-drawer";
    li.appendChild(drawer);
  }
  if (findPersonalData(claim).length > 0) {
    drawer.innerHTML = `<p class="claim-note">This claim includes personal details, so it was not sent anywhere.</p>`;
    return;
  }
  if (personalText && deviceStatus !== "available") {
    drawer.innerHTML = `<p class="claim-note">This text had personal details, so its claims are only checked on your device, and on-device AI isn't ready in this browser. Nothing was sent.</p>`;
    return;
  }
  b.disabled = true;
  b.querySelector("span")!.textContent = "Checking…";
  drawer.innerHTML = `<span class="claim-loading" aria-hidden="true"></span>${settings.claimGrounding
    ? `<p class="claim-note">Checking with Google Search… Only this sentence is sent to the cloud.</p>`
    : `<p class="claim-note">Working out how to check it${deviceStatus === "available" ? ", on your device" : ""}…</p>`}`;
  try {
    // Respect "Run on": "This device only" never falls back to the cloud.
    // Offline, only the device can answer, so it is treated like "This device only".
    const run = navigator.onLine && !personalText ? runSel.value : "device";
    const mode = run === "device" ? "only_on_device" : run === "cloud" ? "only_in_cloud" : "prefer_on_device";
    const r = await checkClaim(claim, lang, LANGUAGE_NAMES[lang], settings.cloudModel, settings.claimGrounding && run !== "device", mode);
    const list = r.sources.length
      ? `<ol class="claim-sources">${r.sources.map((x) => `<li><a href="${escapeHtml(x.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.title)}</a></li>`).join("")}</ol>`
      : "";
    const q = encodeURIComponent(claim.slice(0, 300));
    const links = r.grounded
      ? ""
      : `<div class="ck-label">Search it yourself</div><div class="claim-links"><a class="claim-go" href="https://toolbox.google.com/factcheck/explorer/search/${q}" target="_blank" rel="noopener noreferrer">${MAGNIFIER}Google Fact Check Explorer</a><a class="claim-go" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">${MAGNIFIER}Google Search</a></div>`;
    const where = r.grounded
      ? "Only this sentence was sent to the cloud. Check the sources yourself."
      : r.ranOn === "on_device"
        ? "This ran on your device; nothing was sent. The links only open if you click them."
        : "Only this sentence was sent to the cloud. The links only open if you click them.";
    const verdict = r.grounded ? readVerdict(r.text) : null;
    const body = verdict ? `<div class="verdict-row">${verdictHtml(verdict)}</div>${renderMarkdown(verdict.rest)}` : renderMarkdown(r.text);
    drawer.innerHTML = `${body}${list}${links}<p class="claim-note">${where}</p><div class="claim-suggest"></div>`;
    if (!verdict) shapeHowToCheck(drawer);
    if (r.suggestionsHtml) drawer.querySelector(".claim-suggest")!.attachShadow({ mode: "open" }).innerHTML = r.suggestionsHtml;
    // Not "Checked" with a ballot X: next to a claim, an X reads as "false". The app never says true or false.
    b.textContent = r.grounded ? "Sources below ↓" : "How to check it ↓";
    b.classList.add("done");
  } catch (err) {
    drawer.innerHTML = `<p class="claim-note">Couldn't check this claim: ${escapeHtml(friendlyError(err))}</p>`;
    b.disabled = false;
    b.querySelector("span")!.textContent = "Check this claim";
  }
});

// ---------- Reading age (worked out on the device) ----------
// The explainer as a reader reads it: each point and paragraph is a sentence; section headings and buttons are left
// out (they have no full stops, so they would glue sentences together and make the explainer look harder than it is).
function explainerProse(): string {
  return [...output.querySelectorAll<HTMLElement>(".card li, .card > p")]
    .map((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      c.querySelectorAll("button, .claim-drawer").forEach((x) => x.remove());
      const t = (c.textContent ?? "").replace(/\s+/g, " ").trim();
      return /[.!?:;]["”’)]?$/.test(t) ? t : t + ".";
    })
    .filter((t) => t.length > 1)
    .join(" ");
}
function showGauge(original: string, explainer: string, lang: Lang): void {
  const gauge = $("gauge");
  const a = lang === "en" && looksEnglish(original) ? readingAge(original) : null;
  const b = lang === "en" ? readingAge(explainer) : null;
  if (!a || !b) { gauge.hidden = true; return; }
  const pos = (age: number) => `${((age - 5) / 15) * 100}%`;
  const e = $("g-exp"), o = $("g-orig");
  e.style.left = pos(b.age); e.textContent = String(b.age);
  // Close ages would print on top of each other, so the original's dot loses its number.
  o.style.left = pos(a.age); o.textContent = Math.abs(a.age - b.age) < 2 ? "" : String(a.age);
  // Only show "a → b" when the explainer is easier; an already plain text gets a note instead of a step up.
  $("g-cap").innerHTML = b.age < a.age
    ? `<s title="The original">${a.age}</s> → <b title="This explainer">${b.age}</b><small class="g-sub">the original → this explainer</small>`
    : `<small class="g-note">The original was already easy to read (reading age ${a.age}), so the explainer keeps it simple.</small>`;
  $("gauge").setAttribute("aria-label", `Reading age: the original needs ${a.age}, this explainer ${b.age}`);
  gauge.hidden = false;
}

// ---------- Read aloud (the browser's own voice: free and private) ----------
const speakBtn = $<HTMLButtonElement>("speak");
const VOICE_LANG: Record<Lang, string> = { en: "en-GB", it: "it-IT", fr: "fr-FR", es: "es-ES", de: "de-DE" };
const listenTop = $<HTMLButtonElement>("listen-top");
// Both Listen buttons (at the foot and next to the sticker) show the same state.
function syncListen(on: boolean): void {
  speakBtn.textContent = on ? "Stop" : "Listen";
  speakBtn.setAttribute("aria-pressed", String(on));
  listenTop.textContent = on ? "■ Stop" : "▶ Listen";
  listenTop.setAttribute("aria-pressed", String(on));
  // Screen readers get words, not the ▶ / ■ symbols.
  listenTop.setAttribute("aria-label", on ? "Stop reading aloud" : "Listen to the explainer");
}
function stopSpeaking(): void {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  syncListen(false);
}
speakBtn.hidden = !("speechSynthesis" in window);
listenTop.addEventListener("click", () => speakBtn.click());
// The top button appears whenever the result's actions do (a finished explainer), and goes with them.
new MutationObserver(() => { listenTop.hidden = actions.hidden || speakBtn.hidden; }).observe(actions, { attributes: true, attributeFilter: ["hidden"] });
speakBtn.addEventListener("click", () => {
  if (speechSynthesis.speaking) { stopSpeaking(); return; }
  // Read the sections only: not the "Check this claim" buttons or any open claim answers.
  const text = [...output.querySelectorAll(".card")].map((c) => {
    const copy = c.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".check-claim, .claim-drawer").forEach((x) => x.remove());
    // Each heading, paragraph and bullet ends with a full stop, so the voice pauses between them.
    copy.querySelectorAll("h3, p, li, .ab").forEach((x) => x.append(". "));
    return (copy.textContent ?? "").replace(/^\d+\s*/, "").replace(/([.!?:;])\s*\.(?=\s)/g, "$1").replace(/\s+/g, " ").trim();
  }).join(" \n");
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[(lastResult?.lang ?? langSel.value) as Lang];
  u.rate = 0.95;
  u.onend = stopSpeaking;
  speechSynthesis.speak(u);
  syncListen(true);
});

function renderChoices(): void {
  for (const b of $("mode-seg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  for (const b of $("level-seg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.level === level));
  $("choice-hint").textContent = deviceStatus === "available"
    ? `${LEVEL_TEXT[level].split(":")[0]} takes ${DEVICE_SECONDS[level]} on your device, a few seconds in the cloud.`
    : "";
  $("mode-hint").textContent =
    mode === "history"
      ? "A speech, declaration or letter from the past. History mode adds how it tries to persuade and its historical context. Try a real speech:"
      : comparing()
        ? "Two texts on the same topic, for example two parties' plans. See where they agree and differ, without being told which is better. Or try a made-up pair:"
        : "Paste any political text, or try a sample (made up, or one real press release):";
  input2.hidden = $("label-a").hidden = $("label-b").hidden = !comparing();
  const lede = output.querySelector(".empty-lede");
  if (lede) {
    lede.innerHTML = comparing()
      ? "Paste two texts and press <b>Compare them</b>. Your comparison appears here, in plain words:"
      : mode === "history"
        ? "Paste a text and press <b>Explain it</b>. Your explainer appears here, in plain words:"
        : "Paste a text and press <b>Explain it</b>. Here is one, before and after:";
  }
  // The example front page shows on the Today tab only (see index.html and style.css).
  document.body.dataset.mode = mode;
  document.body.classList.toggle("compare-on", comparing());
  input.placeholder = comparing() ? "Paste the first text here…" : "Paste the text here…";
  if (!explainBtn.disabled) explainBtn.textContent = explainLabel();
  $("again").textContent = comparing() ? "Compare two other texts ↑" : "Explain another text ↑";
  updateCount();
  updatePrivacy();
  // The outline only exists before the first result (a result replaces it), so it may be gone.
  const ghost = document.getElementById("ghost");
  if (ghost) {
    const hints = sectionHints(langSel.value as Lang, mode === "history", comparing());
    ghost.innerHTML = sectionNames().map((h, i) => `<li>${escapeHtml(h)}${hints[i] ? `<span class="gd">${escapeHtml(hints[i])}</span>` : ""}</li>`).join("");
  }
  renderSamples();
}
$("mode-seg").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!b) return;
  const changed = mode !== b.dataset.mode;
  mode = b.dataset.mode as Mode;
  store.set("pp-mode", mode);
  // A result from another tab would no longer match the page (a Lincoln explainer under Compare): clear it.
  if (changed && lastResult && !running) clearResult();
  renderChoices();
});
$("level-seg").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-level]");
  if (!b) return;
  level = b.dataset.level as Level;
  store.set("pp-level", level);
  renderChoices();
});

// ---------- Samples and character count ----------
function renderSamples(): void {
  if (comparing()) {
    const box = $("samples");
    box.innerHTML = "";
    for (const p of COMPARE_SAMPLES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = p.label;
      b.addEventListener("click", () => {
        input.value = p.a;
        input2.value = p.b;
        sourceNote.hidden = true;
        updateCount();
        updatePrivacy();
      });
      box.appendChild(b);
    }
    return;
  }
  const year = (label: string) => Number(label.match(/\d{4}/)?.[0] ?? 0);
  const list = SAMPLES.filter((x) => !!x.history === (mode === "history")).sort((a, b) => year(a.label) - year(b.label));
  const box = $("samples");
  box.innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = s.label;
    b.addEventListener("click", () => {
      input.value = s.text;
      sourceNote.hidden = true;
      updateCount();
      updatePrivacy();
    });
    box.appendChild(b);
  }
}
const updateCount = () => {
  const n = input.value.length + (comparing() ? input2.value.length : 0);
  charCount.textContent = n.toLocaleString("en-GB");
  // "0 characters" says nothing: the count shows once there is text.
  charCount.parentElement!.hidden = n === 0;
};
for (const box of [input, input2]) {
  box.addEventListener("input", () => {
    updateCount();
    updatePrivacy();
  });
}
const explainLabel = () => (comparing() ? "Compare them" : "Explain it");
// The "Before" on the example front page: put the whole sample in the box, ready to explain.
output.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#load-example")) return;
  const s = SAMPLES.find((x) => x.label === "Council housing plan");
  if (!s) return;
  input.value = s.text;
  sourceNote.hidden = true;
  updateCount();
  updatePrivacy();
  input.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  explainBtn.focus({ preventScroll: true });
});

// ---------- Privacy guard ----------
function updatePrivacy(): void {
  const found = findPersonalData(allText());
  privacyBox.classList.toggle("found", found.length > 0);
  redactBtn.hidden = found.length === 0;
  privacyText.textContent =
    found.length === 0
      ? "Privacy guard on: personal details never go to the cloud."
      : deviceStatus === "available"
        ? `Found ${describeFindings(found)} (${listFindings(found)}). This text will only run on your device.`
        : `Found ${describeFindings(found)} (${listFindings(found)}). Personal details never go to the cloud, so remove them first.`;
}
// Both boxes are checked together, so a name given in Text A is also removed from Text B.
function redactBoxes(): void {
  const findings = findPersonalData(allText());
  input.value = redactKnown(redact(input.value), findings);
  if (comparing()) input2.value = redactKnown(redact(input2.value), findings);
  updateCount();
  updatePrivacy();
}
redactBtn.addEventListener("click", redactBoxes);
redactSendBtn.addEventListener("click", () => {
  redactBoxes();
  explain();
});

// ---------- On-device status ----------
async function refreshDevice(): Promise<void> {
  const lang = langSel.value as Lang;
  deviceStatus = await getDeviceStatus(lang);
  updatePrivacy(); // its wording depends on whether the device can run the text
  pill.className = "pill";
  setupBtn.hidden = true;
  deviceHelp.hidden = true;

  // Offline: the page still works (the service worker keeps a copy), but only the on-device model can run.
  if (!navigator.onLine) {
    pill.textContent = deviceStatus === "available" ? "Offline · on-device AI ready" : "Offline";
    pill.classList.add(deviceStatus === "available" ? "ready" : "cloud");
    if (deviceStatus !== "available") {
      deviceHelp.hidden = false;
      deviceHelp.textContent = "You're offline. Explaining needs the AI built into Chrome on this device, which isn't ready here. Connect to the internet to use the cloud.";
    } else {
      void warmUpDevice(lang);
    }
    return;
  }

  if (deviceStatus === "available") {
    pill.textContent = "On-device AI ready";
    pill.classList.add("ready");
    void warmUpDevice(lang);
  } else if (deviceStatus === "downloadable" || deviceStatus === "downloading") {
    pill.textContent = deviceStatus === "downloading" ? "On-device AI downloading…" : "Cloud for now (on-device AI can be set up)";
    pill.classList.add("cloud");
    setupBtn.hidden = false;
  } else {
    pill.textContent = "Using the cloud";
    pill.classList.add("cloud");
    deviceHelp.hidden = false;
    deviceHelp.textContent = hasPromptApi()
      ? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
        ? "On a phone the cloud is used, still behind the privacy guard. In Chrome on a computer, it can run on your own device."
        : "On-device AI can't run here (this language, or a computer below Chrome's minimum), so the cloud is used."
      : "Want it private? In desktop Chrome (148 or newer), the built-in AI keeps your text on your computer. Until then the cloud is used.";
    // The details, for anyone who hovers: Chrome's minimum is 16 GB of memory or a 4 GB graphics card, plus 22 GB free.
    deviceHelp.title = hasPromptApi()
      ? "Chrome's on-device AI needs 16 GB of memory or a graphics card with 4 GB, plus 22 GB of free disk space."
      : "Windows, Mac, Linux or a Chromebook Plus. No setup beyond a one-time download.";
  }
}
langSel.addEventListener("change", async () => {
  await refreshDevice();
  renderChoices();
});
window.addEventListener("online", () => void refreshDevice().then(() => (libraryShown ? renderLibrary() : undefined)));
window.addEventListener("offline", () => void refreshDevice());

setupBtn.addEventListener("click", async () => {
  setupBtn.disabled = true;
  try {
    const model = makeModel("prefer_on_device", langSel.value as Lang, settings.cloudModel);
    await model.initializeDeviceModel((p) => {
      pill.textContent = `Downloading on-device AI… ${Math.round(p * 100)}%`;
    });
  } catch (e) {
    showError(`Couldn't set up the on-device model: ${messageOf(e)}`);
  } finally {
    setupBtn.disabled = false;
    await refreshDevice();
  }
});

// ---------- Read a photo (a leaflet, a poster, a newspaper cutting) ----------
// The photo is read on this device when Chrome's model can take pictures. Otherwise it would go to the cloud
// as it is, which the privacy guard can't check, so the reader is asked first. The text read from the photo
// goes into the text box, where the reader checks it and the privacy guard scans it as usual.
const photoBtn = $<HTMLButtonElement>("photo");
const photoFile = $<HTMLInputElement>("photo-file");
const photoStatus = $("photo-status");
const photoConfirm = $("photo-confirm");
// What runs if the reader agrees to send something to the cloud (a photo, a video or a recording).
let pendingSend: (() => void) | null = null;
function askToSend(text: string, button: string, run: () => void): void {
  $("confirm-text").textContent = text;
  $("photo-send").textContent = button;
  pendingSend = run;
  setPhotoStatus("");
  photoConfirm.hidden = false;
}
// Puts text read from a photo, video or recording into the box (Text B if comparing and A is filled).
function fillFromSource(text: string, where: string): void {
  const target = comparing() && input.value.trim() && !input2.value.trim() ? input2 : input;
  target.value = text;
  sourceNote.hidden = true;
  updateCount();
  updatePrivacy();
  setPhotoStatus(`${where} Check the text, then press ${explainLabel()}.`);
  target.focus();
}
function setPhotoStatus(text: string): void {
  photoStatus.textContent = text;
  photoStatus.hidden = !text;
}
// Shrinks the photo (long side 1600 px) and returns it as JPEG in base64: smaller and faster to read.
async function photoToJpeg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}
async function runPhoto(jpeg: string, mode: "only_on_device" | "only_in_cloud"): Promise<void> {
  photoConfirm.hidden = true;
  photoBtn.disabled = true;
  setPhotoStatus(mode === "only_on_device" ? "Reading the photo on your device…" : "Reading the photo in the cloud…");
  try {
    const r = await readPhoto(jpeg, mode, settings.cloudModel);
    if (!r.text || /^NO TEXT\.?$/i.test(r.text)) {
      setPhotoStatus("No readable text found. Try a sharper photo, taken straight on, in good light.");
      return;
    }
    fillFromSource(r.text, `Read ${r.ranOn === "on_device" ? "on your device" : "in the cloud"}.`);
  } catch (e) {
    setPhotoStatus(`Couldn't read the photo: ${friendlyError(e)}`);
  } finally {
    photoBtn.disabled = false;
  }
}
photoBtn.addEventListener("click", () => photoFile.click());
photoFile.addEventListener("change", async () => {
  const file = photoFile.files?.[0];
  photoFile.value = "";
  if (!file) return;
  await booted;
  hideError();
  photoConfirm.hidden = true;
  let jpeg: string;
  try {
    jpeg = await photoToJpeg(file);
  } catch {
    setPhotoStatus("That file couldn't be opened as a picture. Try a JPEG or PNG photo.");
    return;
  }
  const canRead = (await getImageDeviceStatus()) === "available";
  if (canRead && runSel.value !== "cloud") return runPhoto(jpeg, "only_on_device");
  if (!navigator.onLine) return setPhotoStatus("You're offline, and this browser can't read photos on your device.");
  if (runSel.value === "device") return setPhotoStatus("You chose This device only, but this browser can't read photos on your device.");
  askToSend(
    "This browser can't read photos on your device, so the photo would go to Google's cloud as it is. The privacy guard can't check photos for names or addresses.",
    "Send the photo to the cloud",
    () => void runPhoto(jpeg, "only_in_cloud"),
  );
});
$("photo-send").addEventListener("click", () => {
  const run = pendingSend;
  pendingSend = null;
  photoConfirm.hidden = true;
  run?.();
});
$("photo-cancel").addEventListener("click", () => {
  pendingSend = null;
  photoConfirm.hidden = true;
});

// ---------- Read a speech video, a recording or a YouTube link (cloud only) ----------
const videoBtn = $<HTMLButtonElement>("video");
const videoFile = $<HTMLInputElement>("video-file");
const ytRow = $("yt-row");
const ytUrl = $<HTMLInputElement>("yt-url");
// Files are sent inside the request, which Google limits to about 20 MB; base64 makes a file a third bigger.
const MAX_MEDIA_MB = 14;
// Gemini's names for some types browsers report differently.
const MEDIA_TYPES: Record<string, string> = { "video/quicktime": "video/mov", "audio/x-m4a": "audio/mp4", "audio/mpeg": "audio/mp3", "audio/x-wav": "audio/wav" };
function mediaBlocked(): string | null {
  if (!navigator.onLine) return "You're offline. Videos and recordings can only be read in the cloud.";
  if (runSel.value === "device") return "You chose This device only, but videos and recordings can only be read in the cloud.";
  return null;
}
async function runMedia(src: MediaSource, label: string): Promise<void> {
  for (const b of [photoBtn, videoBtn, $<HTMLButtonElement>("yt"), $<HTMLButtonElement>("yt-go")]) b.disabled = true;
  const started = performance.now();
  let busyNote = "";
  const tick = () => setPhotoStatus(`Listening to the ${label} in the cloud… ${Math.round((performance.now() - started) / 1000)} s ${busyNote || "(a 5-minute speech takes about half a minute)"}`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    // Like explainers: when Google's cloud is busy, wait a little and try again (3 tries in all).
    let text = "";
    for (let attempt = 1; ; attempt++) {
      try {
        text = await readMedia(src, settings.cloudModel);
        break;
      } catch (e) {
        if (attempt >= 3 || !isBusyError(e) || !navigator.onLine) throw e;
        busyNote = `(Google's cloud is busy: trying again, ${attempt + 1} of 3)`;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!text || /^NO TEXT\.?$/i.test(text)) {
      setPhotoStatus(`Nothing to read: no speech or text was found in the ${label}.`);
      return;
    }
    fillFromSource(text, `Written out in the cloud from the ${label}.`);
    ytRow.hidden = true;
  } catch (e) {
    setPhotoStatus(`Couldn't read the ${label}: ${friendlyError(e, src.kind === "youtube")}`);
  } finally {
    clearInterval(timer);
    for (const b of [photoBtn, videoBtn, $<HTMLButtonElement>("yt"), $<HTMLButtonElement>("yt-go")]) b.disabled = false;
  }
}
videoBtn.addEventListener("click", () => videoFile.click());
videoFile.addEventListener("change", async () => {
  const file = videoFile.files?.[0];
  videoFile.value = "";
  if (!file) return;
  await booted;
  hideError();
  photoConfirm.hidden = true;
  const blocked = mediaBlocked();
  if (blocked) return setPhotoStatus(blocked);
  if (file.size > MAX_MEDIA_MB * 1024 * 1024) {
    return setPhotoStatus(`That file is ${Math.round(file.size / 1048576)} MB; the limit is ${MAX_MEDIA_MB} MB. Use a shorter clip, or put it on YouTube and paste the link.`);
  }
  const mimeType = MEDIA_TYPES[file.type] ?? file.type;
  if (!/^(video|audio)\//.test(mimeType)) return setPhotoStatus("That file isn't a video or a sound recording.");
  const label = mimeType.startsWith("audio/") ? "recording" : "video";
  askToSend(
    `Videos and recordings can only be read in Google's cloud, so this ${label} would be sent there as it is. The privacy guard can't check it for names or voices. Fine for a public speech; think twice for a private recording.`,
    `Send the ${label} to the cloud`,
    async () => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1]);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      await runMedia({ kind: "file", mimeType, base64 }, label);
    },
  );
});
$("yt").addEventListener("click", () => {
  ytRow.hidden = !ytRow.hidden;
  if (!ytRow.hidden) ytUrl.focus();
});
async function readYoutube(): Promise<void> {
  await booted;
  hideError();
  photoConfirm.hidden = true;
  const url = youtubeUrl(ytUrl.value);
  if (!url) return setPhotoStatus("That doesn't look like a YouTube video link. Copy it from the Share button on YouTube.");
  const blocked = mediaBlocked();
  if (blocked) return setPhotoStatus(blocked);
  // A public YouTube video is already public, so it goes to the cloud without asking; the page says so.
  await runMedia({ kind: "youtube", url }, "video");
}
$("yt-go").addEventListener("click", () => void readYoutube());
ytUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void readYoutube();
  }
});

// ---------- Explain ----------
explainBtn.addEventListener("click", () => void booted.then(() => explain()));

// ---------- Explain another text ----------
// After a result: clear the text and the explainer, and take the reader back up to an empty box.
// (A tester's first wish: "add a button once you have done one text to do another one".)
const againBtn = $<HTMLButtonElement>("again");
// The explainer goes; the text stays (used when switching tab, so a History result never sits under Compare).
function clearResult(): void {
  stopSpeaking();
  hideError();
  for (const el of [actions, badge, routeNote, spinBox, $("gauge"), $("route"), redactSendBtn, sourceNote]) el.hidden = true;
  output.innerHTML = EMPTY_OUTPUT;
  lastResult = null;
}
function startOver(): void {
  if (running) return;
  clearResult();
  for (const box of [input, input2]) {
    box.value = "";
    // Same path as typing, so the saved draft, the count and the privacy guard all follow.
    box.dispatchEvent(new Event("input"));
  }
  renderChoices();
  $("input-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  input.focus({ preventScroll: true });
}
againBtn.addEventListener("click", startOver);
// Ctrl+Enter (Cmd+Enter on a Mac) in a text box explains it.
for (const box of [input, input2]) {
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !explainBtn.disabled) {
      e.preventDefault();
      explainBtn.click();
    }
  });
}

// One explainer at a time: extra clicks, Ctrl+Enter or the side panel during a run are ignored.
let running = false;
async function explain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await explainOnce();
  } finally {
    running = false;
  }
}
async function explainOnce(): Promise<void> {
  const a = input.value.trim();
  const b = input2.value.trim();
  const compare = comparing();
  // What gets checked for personal details and length, and what is kept (shortened) in the library.
  const text = compare ? `Text A:\n${a}\n\nText B:\n${b}` : a;
  hideError();
  if (compare && (a.length < 40 || b.length < 40)) {
    showError("Paste both texts first (a paragraph or more each), or pick a pair.");
    return;
  }
  if (!compare && a.length < 40) {
    showError("Paste a longer text first (a paragraph or more), or pick a sample.");
    return;
  }
  if (!isConfigured) {
    showError("This copy isn't connected to Firebase yet. See the README to set it up.");
    return;
  }

  const lang = langSel.value as Lang;
  const findings = findPersonalData(text);
  const route = chooseRoute({
    choice: runSel.value as RunChoice,
    chars: text.length,
    deviceCharLimit: settings.deviceCharLimit,
    deviceStatus,
    personal: findings.length > 0,
    offline: !navigator.onLine,
  });
  if (!route.ok) {
    showError(route.privacy ? `${route.reason} Found: ${listFindings(findings, 3)}.` : route.reason);
    redactSendBtn.hidden = !route.privacy;
    // On a phone the message is far below the button: bring it into view, as a normal run does.
    if (matchMedia("(max-width: 860px)").matches && !embedded) $("out-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    // A clear "stopped" frame, in place of the example front page (see style.css).
    badge.hidden = !route.privacy;
    if (route.privacy) {
      badge.className = "stamp stopped";
      badge.textContent = "Stopped by the privacy guard · nothing sent";
    }
    return;
  }

  explainBtn.disabled = true;
  explainBtn.textContent = compare ? "Comparing…" : "Explaining…";
  actions.hidden = true;
  $("gauge").hidden = true;
  spinBox.hidden = true;
  stopSpeaking();
  routeNote.hidden = false;
  routeNote.textContent = route.reason;
  // The sections this run will produce, fixed now, so switching tab or language mid-run can't change them.
  const runSections = sectionNames();
  // Their names show straight away as faint outlines, so the wait never looks like an empty page.
  output.innerHTML = pendingSections("", runSections);
  output.lang = lang; // so long words hyphenate in the right language
  // On a phone the explainer is far below the button: scroll to it so pressing Explain visibly does something.
  if (matchMedia("(max-width: 860px)").matches && !embedded) $("out-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  output.classList.add("streaming");
  srStatus.textContent = compare ? "Comparing the texts…" : "Explaining the text…";

  const started = performance.now();
  // A live timer, so a slower on-device run never looks stuck.
  let likelyDevice = route.mode === "only_on_device" || (route.mode === "prefer_on_device" && deviceStatus === "available");
  badge.hidden = false;
  badge.className = `stamp running ${likelyDevice ? "device" : "cloud"}`;
  const tick = () => {
    const s = Math.round((performance.now() - started) / 1000);
    badge.innerHTML = `${likelyDevice ? "Working on your device" : "Working in the cloud"}<small>${s} s</small>`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  setRoute(likelyDevice ? "device" : "cloud", true);
  let markdown = "";
  try {
    let model = makeModel(route.mode, lang, settings.cloudModel);
    let fellBack = false;
    const prompt = compare ? buildComparePrompt(a, b, lang, level) : buildPrompt(text, lang, level, mode);
    // When Google's cloud model is overloaded it can stop mid-answer: it streams part of the explainer, then ends
    // with a "high demand" error. Try again after a short pause. The first tries stream (fastest when Google is
    // healthy); the later ones ask for the whole answer in one go, which got through more often in busy spells.
    let final;
    let longestPartial = "";
    for (let attempt = 1; ; attempt++) {
      // Where this try is running: the first chunk says; before it arrives, the route's best guess.
      let ranSource: string | undefined;
      try {
        markdown = "";
        const cancel = new AbortController();
        if (attempt >= WHOLE_ANSWER_FROM) {
          output.innerHTML = pendingSections("", runSections);
          const whole = await model.generateContent(prompt, { signal: cancel.signal, timeout: WHOLE_ANSWER_MS });
          markdown = whole.response.text();
          output.innerHTML = renderMarkdown(markdown);
          final = whole.response;
        } else {
          // timeout: how long to wait for the cloud to start answering at all (the library's default is 3 minutes).
          const result = await model.generateContentStream(prompt, { signal: cancel.signal, timeout: FIRST_WORDS_MS });
          // If the stream breaks, result.response fails too; the loop's error is the one handled (and retried),
          // so mark this one as seen rather than leave an "uncaught" error in the console.
          result.response.catch(() => {});
          // Give up on an answer that goes quiet (the first words can take a while on the device), then retry.
          for await (const chunk of withStallLimit(result.stream, FIRST_WORDS_MS, NEXT_WORDS_MS, () => cancel.abort())) {
            ranSource ??= chunk.inferenceSource;
            markdown += chunk.text();
            output.innerHTML = renderMarkdown(markdown) + pendingSections(markdown, runSections);
          }
          output.innerHTML = renderMarkdown(markdown);
          final = await result.response;
        }
        // After a busy spell, go back to the plain reason; the retries only matter to the console.
        if (attempt > 1 && !fellBack) {
          routeNote.textContent = route.reason;
          console.info(`Google's cloud was busy; it worked on try ${attempt}.`);
        }
        break;
      } catch (e) {
        // Gemini Nano failed partway (Auto only): the cloud takes over, once. Personal texts never get here.
        const ranOnDevice = ranSource ? ranSource === "on_device" : likelyDevice;
        if (shouldFallBackToCloud({ mode: route.mode, ranOnDevice, online: navigator.onLine, alreadyFellBack: fellBack })) {
          fellBack = true;
          likelyDevice = false;
          model = makeModel("only_in_cloud", lang, settings.cloudModel);
          console.info("[Firebase AI Logic] The on-device model couldn't finish; trying again in the cloud.", e);
          routeNote.textContent = "The on-device model couldn't finish, so the cloud stepped in.";
          setRoute("cloud", true);
          longestPartial = "";
          output.innerHTML = pendingSections("", runSections);
          attempt = 0;
          continue;
        }
        if (markdown.length > longestPartial.length) longestPartial = markdown;
        // Offline is not "busy": trying again can't help, so say so at once.
        if (attempt >= MAX_ATTEMPTS || !isBusyError(e) || !navigator.onLine) {
          // Show the most that ever arrived, not just what the last try managed.
          markdown = longestPartial;
          throw e;
        }
        output.innerHTML = pendingSections("", runSections);
        routeNote.textContent = ranOnDevice ? "Still working on your device…" : "The cloud is slow right now. Still working…";
        console.info(`Google's cloud AI is busy. Trying again (${attempt + 1} of ${MAX_ATTEMPTS}).`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    const source = final.inferenceSource === "on_device" ? "on_device" : "in_cloud";
    // For anyone checking in DevTools: the Firebase AI Logic mode asked for, and where the answer really ran.
    console.info(`[Firebase AI Logic] mode=${fellBack ? `${route.mode} → only_in_cloud (device failed)` : route.mode} inferenceSource=${final.inferenceSource ?? "in_cloud"}`);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    showBadge(source, secs);
    setRoute(source === "on_device" ? "device" : "cloud", false);
    // Reading age compares one original with its explainer, so it is left out of comparisons.
    if (!compare) showGauge(text, explainerProse(), lang);
    else shapeDiffer(lang, [compareName(a, "Text A"), compareName(b, "Text B")]);
    showSpin(compare ? [a, b] : [a]);
    addClaimButtons(lang);
    lastResult = { markdown, source, lang, text, findings, seconds: secs };
    actions.hidden = false;
    srStatus.textContent = `The explainer is ready. It ran ${source === "on_device" ? "on your device" : "in the cloud"}.`;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to my library";
  } catch (e) {
    // Keep any part of the answer that arrived, without the outline of sections that will now never come.
    output.innerHTML = markdown ? renderMarkdown(markdown) : "";
    badge.hidden = true;
    $("route").hidden = true;
    // The "Trying again (4 of 4)…" note would now be out of date.
    routeNote.hidden = true;
    srStatus.textContent = "The explainer couldn't be finished.";
    showError(friendlyError(e));
  } finally {
    clearInterval(timer);
    output.classList.remove("streaming");
    explainBtn.disabled = false;
    explainBtn.textContent = explainLabel();
  }
}

const MAX_ATTEMPTS = 4;
// From this try on, ask for the whole answer at once instead of a stream, and wait up to this long for it.
const WHOLE_ANSWER_FROM = 3;
const WHOLE_ANSWER_MS = 60_000;
// How long an answer may stay silent: before its first words, then between words.
const FIRST_WORDS_MS = 45_000;
const NEXT_WORDS_MS = 25_000;

// Overload errors arrive as a cut-off stream ("Failed to parse stream"), a stream that goes silent ("stalled"),
// or as 500/503 "high demand" / UNAVAILABLE responses.
function isBusyError(e: unknown): boolean {
  return /parse-failed|Failed to parse stream|stalled|Timeout has expired|high demand|overloaded|UNAVAILABLE|INTERNAL|\b50[03]\b/i.test(messageOf(e));
}

function showBadge(source: "on_device" | "in_cloud", secs: string): void {
  badge.hidden = false;
  // Once it's done, the stamp becomes a sticker that slaps onto the page and says which AI wrote it.
  badge.className = `stamp sticker ${source === "on_device" ? "device" : "cloud"}`;
  badge.innerHTML = source === "on_device"
    ? `${SPARK}<span class="st-text"><b>Ran on your device</b><small>${deviceModelName(navigator.userAgent).replace(/ /g, "&nbsp;")} · nothing&nbsp;sent · ${secs}&nbsp;s</small></span>`
    : `${SPARK}<span class="st-text"><b>Ran in the cloud</b><small>Google&nbsp;Gemini · Firebase&nbsp;AI&nbsp;Logic · ${secs}&nbsp;s</small></span>`;
}
// A four-point spark in blue to violet, a nod to Gemini.
const SPARK = `<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="spark-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3f7ff0"/><stop offset=".55" stop-color="#9b72cb"/><stop offset="1" stop-color="#d96570"/></linearGradient></defs><path fill="url(#spark-g)" d="M12 1c.7 5.8 4.6 10.2 11 11-6.4.8-10.3 5.2-11 11-.7-5.8-4.6-10.2-11-11 6.4-.8 10.3-5.2 11-11Z"/></svg>`;

// ---------- Save, copy, library ----------
saveBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  saveBtn.disabled = true;
  try {
    const saved = await saveExplainer({
      // Personal details never reach the library either.
      title: redactKnown(firstLine(lastResult.markdown), lastResult.findings),
      snippet: redact(lastResult.text, lastResult.findings).slice(0, 280),
      lang: lastResult.lang,
      source: lastResult.source,
      markdown: redactKnown(lastResult.markdown, lastResult.findings),
    });
    saveBtn.textContent = saved === "queued" ? "Saved ✓ (syncs when online)" : "Saved ✓";
    await renderLibrary();
  } catch (e) {
    saveBtn.disabled = false;
    showError(`Couldn't save: ${messageOf(e)}`);
  }
});

$("print").addEventListener("click", () => window.print());

// Share as a front page: a picture of the explainer (never the original text), shared on phones,
// downloaded on computers. Personal details found by the privacy guard are removed first.
const shareBtn = $<HTMLButtonElement>("share");
shareBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  const r = lastResult;
  const clean = (s: string) => redactKnown(s.replace(/\s*Check this claim\s*$/i, "").trim(), r.findings);
  const cards = [...output.querySelectorAll<HTMLElement>(".card")];
  const section = (i: number) => {
    const c = cards[i];
    if (!c) return { title: "", items: [] as string[] };
    const items = [...c.querySelectorAll<HTMLElement>(":scope > ul > li")].map((li) => {
      // The A/B lines of a comparison read as one line on the picture.
      const copy = li.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".check-claim, .claim-drawer").forEach((x) => x.remove());
      copy.querySelectorAll(".ab b").forEach((b) => (b.textContent = `${b.textContent}: `));
      copy.querySelectorAll(".ab").forEach((ab) => ab.append(" "));
      return clean(copy.textContent ?? "").replace(/\s+/g, " ");
    });
    return { title: c.querySelector("h3")?.textContent ?? "", items };
  };
  const compare = !!cards[2]?.querySelector(".ab");
  shareBtn.disabled = true;
  shareBtn.textContent = "Drawing…";
  try {
    const blob = await drawFrontPage({
      headline: clean(cards[0]?.querySelector("p")?.textContent ?? firstLine(r.markdown)),
      // An explainer shows what it says + claims; a comparison shows where they differ + claims.
      first: section(compare ? 2 : 1),
      second: section(compare ? 4 : 2),
      third: section(5),
      ranOn: r.source,
      seconds: r.seconds,
      date: new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    });
    const file = new File([blob], "plain-politics-front-page.png", { type: "image/png" });
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Plain Politics" }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    shareBtn.textContent = touch ? "Share as a front page" : "Saved ✓";
    setTimeout(() => (shareBtn.textContent = "Share as a front page"), 2000);
  } catch (e) {
    showError(`Couldn't make the picture: ${messageOf(e)}`);
    shareBtn.textContent = "Share as a front page";
  } finally {
    shareBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  await navigator.clipboard.writeText(lastResult.markdown);
  copyBtn.textContent = "Copied ✓";
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
});

async function renderLibrary(): Promise<void> {
  if (!(await hasLibraryUser())) return;
  let items: SavedExplainer[] = [];
  try {
    items = await listExplainers();
  } catch {
    return;
  }
  libraryList.innerHTML = "";
  if (items.length === 0) {
    libraryList.innerHTML = '<li class="empty">Nothing saved yet.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "lib-item";
    const when = item.createdAt ? item.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    const where = item.source === "on_device" ? "on device" : "cloud";
    li.innerHTML = `<div><button class="link" type="button">${escapeHtml(item.title)}</button>
      <div class="lib-meta">${escapeHtml(when)} · ${where} · ${item.lang.toUpperCase()}</div></div>
      <button class="lib-del" type="button" aria-label="Delete">Delete</button>`;
    li.querySelector(".link")!.addEventListener("click", () => {
      if (running) return;
      output.innerHTML = renderMarkdown(item.markdown);
      badge.hidden = true;
      spinBox.hidden = true;
      $("route").hidden = true;
      $("gauge").hidden = true;
      routeNote.hidden = false;
      routeNote.textContent = `From your library (${where}).`;
      actions.hidden = true;
      output.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    li.querySelector(".lib-del")!.addEventListener("click", async () => {
      li.remove(); // straight away; the list is redrawn from the database afterwards
      try {
        await deleteExplainer(item.id);
      } catch (e) {
        showError(`Couldn't delete: ${friendlyError(e)}`);
      }
      await renderLibrary();
    });
    libraryList.appendChild(li);
  }
}

// ---------- Errors ----------
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function friendlyError(e: unknown, youtube = false): string {
  return friendlyMessage(messageOf(e), { deviceReady: deviceStatus === "available", online: navigator.onLine, dev: import.meta.env.DEV, youtube });
}
function showError(msg: string): void {
  errorBox.hidden = false;
  errorBox.textContent = msg;
}
function hideError(): void {
  errorBox.hidden = true;
  redactSendBtn.hidden = true;
}

// ---------- Chrome extension side panel ----------
// The extension shows this page in its side panel (?embed=1). The panel reads the page you
// are reading and sends its text here with postMessage. Nothing goes through a server.
const embedded = new URLSearchParams(location.search).get("embed") === "1";
const inputPanel = $("input-panel");
const pageEmpty = $("page-empty");
const pageSource = $("page-source");
const pageStatus = $("page-status");
if (embedded) {
  document.body.classList.add("embed");
  inputPanel.hidden = true;
  // In the panel, the mode and speed choices sit in the page card, always in view.
  $("page-card").insertBefore($("choices"), pageStatus);
}
function setPageStatus(text: string): void {
  pageStatus.textContent = text;
  pageStatus.hidden = !text;
}
function askPanel(what: "page" | "selection"): void {
  setPageStatus(what === "selection" ? "Reading your selection…" : "Reading the page…");
  window.parent.postMessage({ type: "pp-request", what }, "*");
}
$("pp-page").addEventListener("click", () => askPanel("page"));
$("pp-sel").addEventListener("click", () => askPanel("selection"));
$("reread").addEventListener("click", () => askPanel("page"));
$("show-input").addEventListener("click", () => {
  inputPanel.hidden = false;
  input.focus();
});
$("edit-text").addEventListener("click", () => {
  inputPanel.hidden = !inputPanel.hidden;
  if (!inputPanel.hidden) input.focus();
});

window.addEventListener("message", (e: MessageEvent) => {
  // Only the extension's side panel that embeds this page may send it text.
  if (!embedded || e.source !== window.parent || !e.origin.startsWith("chrome-extension://")) return;
  const d = e.data as { type?: string; text?: unknown; title?: unknown; autoRun?: unknown };
  if (d?.type === "pp-status") {
    setPageStatus(typeof d.text === "string" ? d.text.slice(0, 300) : "");
    return;
  }
  if (d?.type !== "pp-text" || typeof d.text !== "string") return;
  input.value = d.text.slice(0, 60000);
  (e.source as Window | null)?.postMessage({ type: "pp-got", n: input.value.length }, e.origin);
  const title = typeof d.title === "string" ? d.title.slice(0, 120) : "";
  sourceNote.textContent = title ? `From the page: ${title}` : "From the page you are reading";
  sourceNote.hidden = false;
  $("src-title").textContent = title || "The page you are reading";
  $("src-meta").textContent = `${input.value.length.toLocaleString("en-GB")} characters from the page`;
  pageEmpty.hidden = true;
  pageSource.hidden = false;
  setPageStatus("");
  if (embedded) inputPanel.hidden = true;
  updateCount();
  updatePrivacy();
  window.scrollTo({ top: 0 });
  if (d.autoRun === true) void booted.then(() => explain());
});

// ---------- Start ----------
// Settings and the on-device check take a moment; the page can show (and the panel can
// say "ready") straight away, and an explainer waits for them.
$("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
// Edition number for the masthead: No. 1 was launch day (18 Nov 2026), one volume per year.
{
  const now = new Date();
  const no = Math.max(1, Math.floor((now.getTime() - new Date(2026, 10, 18).getTime()) / 864e5) + 1);
  const vol = ["I", "II", "III", "IV", "V"][Math.min(4, Math.max(0, now.getFullYear() - 2026))];
  $("edition-no").textContent = `Vol. ${vol} · No. ${no}`;
}
const booted = (async () => {
  updateCount();
  renderChoices();
  settings = await loadSettings();
  await refreshDevice();
  renderChoices();
})();
if (embedded && window.parent !== window) window.parent.postMessage({ type: "pp-ready" }, "*");
// The library list opens the database, which starts App Check (and reCAPTCHA's cookie). So it is only loaded
// when the reader gets near it, not on every page load.
let libraryShown = false;
// The library starts just below the first screen, and a page makes small scrolls of its own while it settles after a
// reload. So it waits until it is near AND the reader has really moved: a wheel, a swipe, a page key, or a real scroll.
let libraryNear = false;
let readerMoved = false;
function maybeShowLibrary(): void {
  if (libraryShown || !libraryNear || !(readerMoved || scrollY > 150)) return;
  libraryShown = true;
  void booted.then(renderLibrary);
}
new IntersectionObserver((entries) => {
  libraryNear = entries.some((en) => en.isIntersecting);
  maybeShowLibrary();
}, { rootMargin: "200px" }).observe($("lib-title").closest("section")!);
addEventListener("scroll", maybeShowLibrary, { passive: true });
const readerMoves = () => { readerMoved = true; maybeShowLibrary(); };
addEventListener("wheel", readerMoves, { passive: true, once: true });
addEventListener("touchmove", readerMoves, { passive: true, once: true });
addEventListener("keydown", (e) => {
  if (!(e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) && ["PageDown", "End", "ArrowDown", " "].includes(e.key)) readerMoves();
});

// ---------- Reading options: larger text, easy reading (kept in this browser) ----------
function applyReading(): void {
  const v = readingSel.value;
  document.body.classList.toggle("read-large", v.includes("large"));
  document.body.classList.toggle("read-easy", v.includes("easy"));
}
{
  const saved = store.get("pp-reading");
  if (saved && [...readingSel.options].some((o) => o.value === saved)) readingSel.value = saved;
  applyReading();
}
readingSel.addEventListener("change", () => {
  store.set("pp-reading", readingSel.value);
  applyReading();
});

// ---------- Keep the text through an accidental reload ----------
// Kept in sessionStorage: only this tab, gone when the tab is closed, never sent anywhere.
const DRAFT_KEYS: [HTMLTextAreaElement, string][] = [[input, "pp-draft-a"], [input2, "pp-draft-b"]];
for (const [box, key] of DRAFT_KEYS) {
  try {
    const d = sessionStorage.getItem(key);
    if (d && !box.value) box.value = d;
  } catch { /* storage blocked: fine */ }
  box.addEventListener("input", () => {
    try { sessionStorage.setItem(key, box.value); } catch { /* storage blocked or full: fine */ }
  });
}
// Samples, photos and videos fill the boxes without typing, so save once more as the page goes away.
addEventListener("pagehide", () => {
  for (const [box, key] of DRAFT_KEYS) {
    try { sessionStorage.setItem(key, box.value); } catch { /* fine */ }
  }
});
updateCount();
updatePrivacy();

// ---------- Works offline, installable ----------
// The service worker keeps a copy of the site on this device (see public/sw.js). Not in the extension's panel,
// which already ships with the extension, and not in development, where files change all the time.
if ("serviceWorker" in navigator && import.meta.env.PROD && !embedded) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
// Chrome offers to install the site as an app; show our own button for it next to My library.
const installBtn = $<HTMLButtonElement>("install");
let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as Event & { prompt(): Promise<void> };
  installBtn.hidden = embedded;
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener("appinstalled", () => (installBtn.hidden = true));
