// The page: reads the text, picks where to run, streams the explainer,
// and saves it to the library on request.

import "@fontsource/unifrakturmaguntia/latin-400.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/libre-franklin/wght.css";
import "./style.css";
import { buildPrompt, HEADINGS, LANGUAGE_NAMES, PERSUADES_HEADING, CONTEXT_HEADING, type Lang, type Level, type Mode } from "./prompt.ts";
import { chooseRoute, type DeviceStatus, type RunChoice } from "./route.ts";
import { renderMarkdown, firstLine, escapeHtml } from "./markdown.ts";
import { getDeviceStatus, hasPromptApi, warmUpDevice } from "./device.ts";
import { readingAge } from "./readability.ts";
import { SAMPLES } from "./samples.ts";
import { findPersonalData, describeFindings, redact, redactKnown, type Finding } from "./privacy.ts";
import {
  isConfigured,
  loadSettings,
  makeModel,
  saveExplainer,
  listExplainers,
  deleteExplainer,
  hasLibraryUser,
  checkClaim,
  type Settings,
  type SavedExplainer,
} from "./firebase.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const charCount = $("char-count");
const langSel = $<HTMLSelectElement>("lang");
const runSel = $<HTMLSelectElement>("run");
const explainBtn = $<HTMLButtonElement>("explain");
const setupBtn = $<HTMLButtonElement>("setup-device");
const deviceHelp = $("device-help");
const pill = $("device-pill");
const badge = $("badge");
const routeNote = $("route-note");
const errorBox = $("error");
const output = $("output");
const actions = $("actions");
const saveBtn = $<HTMLButtonElement>("save");
const copyBtn = $<HTMLButtonElement>("copy");
const libraryList = $("library");
const privacyBox = $("privacy");
const privacyText = $("privacy-text");
const redactBtn = $<HTMLButtonElement>("redact");
const redactSendBtn = $<HTMLButtonElement>("redact-send");
const sourceNote = $("source-note");

let settings: Settings = { cloudModel: "gemini-3.5-flash-lite", deviceCharLimit: 20000, claimGrounding: false };
let deviceStatus: DeviceStatus = "unavailable";
let lastResult: { markdown: string; source: "on_device" | "in_cloud"; lang: Lang; text: string; findings: Finding[] } | null = null;

// ---------- Mode (Today / History) and speed vs detail ----------
const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* private window: fine */ }
  },
};
let mode: Mode = store.get("pp-mode") === "history" ? "history" : "today";
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
  return [...HEADINGS[lang], ...(mode === "history" ? [PERSUADES_HEADING[lang], CONTEXT_HEADING[lang]] : [])];
}
// While the answer streams in, the sections still to come stay as faint outlines.
function pendingSections(md: string): string {
  const done = (md.match(/^#{1,3}\s/gm) ?? []).length;
  const start = Math.max(done, 1); // section 0 is "In one sentence" (unnumbered); section n is numbered n
  const rest = sectionNames().slice(start);
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

// ---------- Check this claim ----------
function addClaimButtons(lang: Lang): void {
  const card = [...output.querySelectorAll(".card")].find((c) => c.querySelector("h3")?.textContent?.trim() === HEADINGS[lang][2]);
  if (!card) return;
  for (const li of card.querySelectorAll("li")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "check-claim";
    b.textContent = "Check this claim";
    li.appendChild(b);
  }
}
output.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.check-claim");
  if (!b || b.disabled) return;
  const li = b.closest("li")!;
  const claim = (li.firstChild ? [...li.childNodes].filter((n) => n !== b && !(n instanceof HTMLElement && n.classList.contains("claim-drawer"))).map((n) => n.textContent).join("") : "").trim();
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
  b.disabled = true;
  drawer.innerHTML = settings.claimGrounding
    ? `<p class="claim-note">Checking with Google Search… Only this sentence is sent to the cloud.</p>`
    : `<p class="claim-note">Working out how to check it${deviceStatus === "available" ? ", on your device" : ""}…</p>`;
  try {
    // Respect "Run on": "This device only" never falls back to the cloud.
    // Offline, only the device can answer, so it is treated like "This device only".
    const run = navigator.onLine ? runSel.value : "device";
    const mode = run === "device" ? "only_on_device" : run === "cloud" ? "only_in_cloud" : "prefer_on_device";
    const r = await checkClaim(claim, lang, LANGUAGE_NAMES[lang], settings.cloudModel, settings.claimGrounding && run !== "device", mode);
    const list = r.sources.length
      ? `<ol class="claim-sources">${r.sources.map((x) => `<li><a href="${escapeHtml(x.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.title)}</a></li>`).join("")}</ol>`
      : "";
    const q = encodeURIComponent(claim.slice(0, 300));
    const links = r.grounded
      ? ""
      : `<p class="claim-links">Search it yourself: <a href="https://toolbox.google.com/factcheck/explorer/search/${q}" target="_blank" rel="noopener noreferrer">Google Fact Check Explorer</a> · <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">Google Search</a></p>`;
    const where = r.grounded
      ? "Only this sentence was sent to the cloud. Check the sources yourself."
      : r.ranOn === "on_device"
        ? "This ran on your device; nothing was sent. The links only open if you click them."
        : "Only this sentence was sent to the cloud. The links only open if you click them.";
    drawer.innerHTML = `${renderMarkdown(r.text)}${list}${links}<p class="claim-note">${where}</p><div class="claim-suggest"></div>`;
    if (r.suggestionsHtml) drawer.querySelector(".claim-suggest")!.attachShadow({ mode: "open" }).innerHTML = r.suggestionsHtml;
    b.textContent = "Checked";
    b.classList.add("done");
  } catch (err) {
    drawer.innerHTML = `<p class="claim-note">Couldn't check this claim: ${escapeHtml(friendlyError(err))}</p>`;
    b.disabled = false;
  }
});

// ---------- Reading age (worked out on the device) ----------
function showGauge(original: string, explainer: string, lang: Lang): void {
  const gauge = $("gauge");
  const a = lang === "en" ? readingAge(original) : null;
  const b = lang === "en" ? readingAge(explainer) : null;
  if (!a || !b) { gauge.hidden = true; return; }
  const pos = (age: number) => `${((age - 5) / 15) * 100}%`;
  const e = $("g-exp"), o = $("g-orig");
  e.style.left = pos(b.age); e.textContent = String(b.age);
  // Close ages would print on top of each other, so the original's dot loses its number.
  o.style.left = pos(a.age); o.textContent = Math.abs(a.age - b.age) < 2 ? "" : String(a.age);
  // Only show "a → b" when the explainer is easier; an already plain text gets a note instead of a step up.
  $("g-cap").innerHTML = b.age < a.age
    ? `<s title="The original">${a.age}</s> → <b title="This explainer">${b.age}</b>`
    : `<b title="This explainer">${b.age}</b><small class="g-note">The original was already easy to read (${a.age}).</small>`;
  $("gauge").setAttribute("aria-label", `Reading age: the original needs ${a.age}, this explainer ${b.age}`);
  gauge.hidden = false;
}

// ---------- Read aloud (the browser's own voice: free and private) ----------
const speakBtn = $<HTMLButtonElement>("speak");
const VOICE_LANG: Record<Lang, string> = { en: "en-GB", it: "it-IT", fr: "fr-FR" };
function stopSpeaking(): void {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  speakBtn.textContent = "Listen";
  speakBtn.setAttribute("aria-pressed", "false");
}
speakBtn.hidden = !("speechSynthesis" in window);
speakBtn.addEventListener("click", () => {
  if (speechSynthesis.speaking) { stopSpeaking(); return; }
  const text = [...output.querySelectorAll(".card")].map((c) => (c as HTMLElement).innerText.replace(/^\d+\s*/, "")).join(". \n");
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[(lastResult?.lang ?? langSel.value) as Lang];
  u.rate = 0.95;
  u.onend = stopSpeaking;
  speechSynthesis.speak(u);
  speakBtn.textContent = "Stop";
  speakBtn.setAttribute("aria-pressed", "true");
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
      : "A news article, a speech, a bill or a manifesto. Or try a made-up sample:";
  $("ghost").innerHTML = sectionNames().map((h) => `<li>${escapeHtml(h)}</li>`).join("");
  renderSamples();
}
$("mode-seg").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!b) return;
  mode = b.dataset.mode as Mode;
  store.set("pp-mode", mode);
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
const updateCount = () => (charCount.textContent = input.value.length.toLocaleString("en-GB"));
input.addEventListener("input", () => {
  updateCount();
  updatePrivacy();
});

// ---------- Privacy guard ----------
function updatePrivacy(): void {
  const found = findPersonalData(input.value);
  privacyBox.classList.toggle("found", found.length > 0);
  redactBtn.hidden = found.length === 0;
  privacyText.textContent =
    found.length === 0
      ? "Privacy guard is on: personal details never go to the cloud."
      : `Found ${describeFindings(found)}. This text will only run on your device.`;
}
redactBtn.addEventListener("click", () => {
  input.value = redact(input.value);
  updateCount();
  updatePrivacy();
});
redactSendBtn.addEventListener("click", () => {
  input.value = redact(input.value);
  updateCount();
  updatePrivacy();
  explain();
});

// ---------- On-device status ----------
async function refreshDevice(): Promise<void> {
  const lang = langSel.value as Lang;
  deviceStatus = await getDeviceStatus(lang);
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
      ? "On-device AI isn't available here, so the cloud is used. Either this language isn't supported on the device yet, or this computer is below Chrome's minimum (16 GB of memory or a 4 GB graphics card, plus 22 GB of free disk space)."
      : "Want it private? Open this page in desktop Chrome (version 148 or newer) on Windows, Mac, Linux or a Chromebook Plus. On-device AI is built in, with no setup beyond a one-time download. Until then the cloud is used.";
  }
}
langSel.addEventListener("change", async () => {
  await refreshDevice();
  renderChoices();
});
window.addEventListener("online", () => void refreshDevice().then(renderLibrary));
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

// ---------- Explain ----------
explainBtn.addEventListener("click", () => void booted.then(() => explain()));

async function explain(): Promise<void> {
  const text = input.value.trim();
  hideError();
  if (text.length < 40) {
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
    showError(route.reason);
    redactSendBtn.hidden = !route.privacy;
    return;
  }

  explainBtn.disabled = true;
  explainBtn.textContent = "Explaining…";
  actions.hidden = true;
  $("gauge").hidden = true;
  stopSpeaking();
  routeNote.hidden = false;
  routeNote.textContent = route.reason;
  output.innerHTML = "";
  output.classList.add("streaming");

  const started = performance.now();
  // A live timer, so a slower on-device run never looks stuck.
  const likelyDevice = route.mode === "only_on_device" || (route.mode === "prefer_on_device" && deviceStatus === "available");
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
    const model = makeModel(route.mode, lang, settings.cloudModel);
    const prompt = buildPrompt(text, lang, level, mode);
    // When Google's cloud model is overloaded it can stop mid-answer. Try again
    // a couple of times, after a short pause, before giving up.
    let final;
    for (let attempt = 1; ; attempt++) {
      try {
        markdown = "";
        const result = await model.generateContentStream(prompt);
        for await (const chunk of result.stream) {
          markdown += chunk.text();
          output.innerHTML = renderMarkdown(markdown) + pendingSections(markdown);
        }
        output.innerHTML = renderMarkdown(markdown);
        final = await result.response;
        if (attempt > 1) routeNote.textContent = `${route.reason} (Google's cloud was busy; it worked on try ${attempt}.)`;
        break;
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS || !isBusyError(e)) throw e;
        output.innerHTML = "";
        routeNote.textContent = `Google's cloud AI is busy. Trying again (${attempt + 1} of ${MAX_ATTEMPTS})…`;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    const source = final.inferenceSource === "on_device" ? "on_device" : "in_cloud";
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    showBadge(source, secs);
    setRoute(source === "on_device" ? "device" : "cloud", false);
    showGauge(text, output.innerText, lang);
    addClaimButtons(lang);
    lastResult = { markdown, source, lang, text, findings };
    actions.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to my library";
  } catch (e) {
    if (!markdown) output.innerHTML = "";
    badge.hidden = true;
    $("route").hidden = true;
    showError(friendlyError(e));
  } finally {
    clearInterval(timer);
    output.classList.remove("streaming");
    explainBtn.disabled = false;
    explainBtn.textContent = "Explain it";
  }
}

const MAX_ATTEMPTS = 3;

// Overload errors arrive as a cut-off stream ("Failed to parse stream") or as
// 500/503 "high demand" / UNAVAILABLE responses.
function isBusyError(e: unknown): boolean {
  return /parse-failed|Failed to parse stream|high demand|overloaded|UNAVAILABLE|INTERNAL|\b50[03]\b/i.test(messageOf(e));
}

function showBadge(source: "on_device" | "in_cloud", secs: string): void {
  badge.hidden = false;
  badge.className = `stamp ${source === "on_device" ? "device" : "cloud"}`;
  badge.innerHTML = source === "on_device"
    ? `Ran on your device<small>${secs} s · nothing sent</small>`
    : `Ran in the cloud<small>${secs} s · Google Gemini</small>`;
}

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
      output.innerHTML = renderMarkdown(item.markdown);
      badge.hidden = true;
      $("route").hidden = true;
      $("gauge").hidden = true;
      routeNote.hidden = false;
      routeNote.textContent = `From your library (${where}).`;
      actions.hidden = true;
      output.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    li.querySelector(".lib-del")!.addEventListener("click", async () => {
      await deleteExplainer(item.id);
      await renderLibrary();
    });
    libraryList.appendChild(li);
  }
}

// ---------- Errors ----------
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function friendlyError(e: unknown): string {
  const m = messageOf(e);
  if (/app.?check|PERMISSION_DENIED|403/i.test(m)) {
    return "The request was blocked by App Check. If you're running this locally, register the debug token from the browser console in Firebase (Security > App Check).";
  }
  if (/parse-failed|Failed to parse stream/i.test(m)) {
    return "Google's cloud AI is very busy right now and stopped before the answer finished. Wait a minute and press \"Explain it\" again, or use on-device AI.";
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(m)) {
    return "The cloud AI is busy or out of free quota right now. Try again in a minute, or use on-device AI.";
  }
  if (/on.?device|LanguageModel|unavailable/i.test(m)) {
    return `On-device AI couldn't run this: ${m}. Try "Auto" or "Cloud only".`;
  }
  return `Something went wrong: ${m}`;
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
  if (!e.origin.startsWith("chrome-extension://")) return;
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
void booted.then(renderLibrary);

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
