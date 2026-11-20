// The page: reads the text, picks where to run, streams the explainer,
// and saves it to the library on request.

import "./style.css";
import { buildPrompt, HEADINGS, PERSUADES_HEADING, CONTEXT_HEADING, type Lang, type Level, type Mode } from "./prompt.ts";
import { chooseRoute, type DeviceStatus, type RunChoice } from "./route.ts";
import { renderMarkdown, firstLine, escapeHtml } from "./markdown.ts";
import { getDeviceStatus, hasPromptApi, warmUpDevice } from "./device.ts";
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

let settings: Settings = { cloudModel: "gemini-3.5-flash-lite", deviceCharLimit: 20000 };
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

function renderChoices(): void {
  for (const b of $("mode-seg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  for (const b of $("level-seg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.level === level));
  const time = deviceStatus === "available" ? ` On your device: ${DEVICE_SECONDS[level]}; in the cloud: a few seconds.` : "";
  $("choice-hint").textContent = LEVEL_TEXT[level] + time;
  $("mode-hint").textContent =
    mode === "history"
      ? "A speech, declaration or letter from the past. History mode adds how it tries to persuade and its historical context. Try a real speech:"
      : "A news article, a speech, a bill or a manifesto. Or try a made-up sample:";
  const lang = langSel.value as Lang;
  const sections = [...HEADINGS[lang], ...(mode === "history" ? [PERSUADES_HEADING[lang], CONTEXT_HEADING[lang]] : [])];
  $("ghost").innerHTML = sections.map((h) => `<li>${escapeHtml(h)}</li>`).join("");
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
      ? "🛡️ Privacy guard is on: personal details never go to the cloud."
      : `🛡️ Found ${describeFindings(found)}. This text will only run on your device.`;
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

  if (deviceStatus === "available") {
    pill.textContent = "🔒 On-device AI ready";
    pill.classList.add("ready");
    void warmUpDevice(lang);
  } else if (deviceStatus === "downloadable" || deviceStatus === "downloading") {
    pill.textContent = deviceStatus === "downloading" ? "On-device AI downloading…" : "☁️ Cloud for now (on-device AI can be set up)";
    pill.classList.add("cloud");
    setupBtn.hidden = false;
  } else {
    pill.textContent = "☁️ Using the cloud";
    pill.classList.add("cloud");
    deviceHelp.hidden = false;
    deviceHelp.textContent = hasPromptApi()
      ? "On-device AI can't run this here (this language isn't supported yet, or this computer doesn't meet Chrome's needs: 16 GB of memory or a 4 GB graphics card, and 22 GB of free disk space). The cloud is used instead."
      : "Want it private? Open this page in desktop Chrome (version 148 or newer) on Windows, Mac, Linux or a Chromebook Plus. On-device AI is built in, with no setup beyond a one-time download. Until then the cloud is used.";
  }
}
langSel.addEventListener("change", async () => {
  await refreshDevice();
  renderChoices();
});

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
  });
  if (!route.ok) {
    showError(route.reason);
    redactSendBtn.hidden = !route.privacy;
    return;
  }

  explainBtn.disabled = true;
  explainBtn.textContent = "Explaining…";
  actions.hidden = true;
  routeNote.hidden = false;
  routeNote.textContent = route.reason;
  output.innerHTML = "";
  output.classList.add("streaming");

  const started = performance.now();
  // A live timer, so a slower on-device run never looks stuck.
  const likelyDevice = route.mode === "only_on_device" || (route.mode === "prefer_on_device" && deviceStatus === "available");
  badge.hidden = false;
  badge.className = `badge running ${likelyDevice ? "device" : "cloud"}`;
  const tick = () => {
    const s = Math.round((performance.now() - started) / 1000);
    badge.textContent = `${likelyDevice ? "🔒 Working on your device" : "☁️ Working in the cloud"} · ${s}s`;
  };
  tick();
  const timer = setInterval(tick, 1000);
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
          output.innerHTML = renderMarkdown(markdown);
        }
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
    lastResult = { markdown, source, lang, text, findings };
    actions.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to my library";
  } catch (e) {
    if (!markdown) output.innerHTML = "";
    badge.hidden = true;
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
  badge.className = `badge ${source === "on_device" ? "device" : "cloud"}`;
  badge.textContent = source === "on_device" ? `🔒 Ran on your device · ${secs}s` : `☁️ Ran in the cloud · ${secs}s`;
}

// ---------- Save, copy, library ----------
saveBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  saveBtn.disabled = true;
  try {
    await saveExplainer({
      // Personal details never reach the library either.
      title: redactKnown(firstLine(lastResult.markdown), lastResult.findings),
      snippet: redact(lastResult.text, lastResult.findings).slice(0, 280),
      lang: lastResult.lang,
      source: lastResult.source,
      markdown: redactKnown(lastResult.markdown, lastResult.findings),
    });
    saveBtn.textContent = "Saved ✓";
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
    const where = item.source === "on_device" ? "🔒 device" : "☁️ cloud";
    li.innerHTML = `<div><button class="link" type="button">${escapeHtml(item.title)}</button>
      <div class="lib-meta">${escapeHtml(when)} · ${where} · ${item.lang.toUpperCase()}</div></div>
      <button class="lib-del" type="button" aria-label="Delete">Delete</button>`;
    li.querySelector(".link")!.addEventListener("click", () => {
      output.innerHTML = renderMarkdown(item.markdown);
      badge.hidden = true;
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
const booted = (async () => {
  updateCount();
  renderChoices();
  settings = await loadSettings();
  await refreshDevice();
  renderChoices();
})();
if (embedded && window.parent !== window) window.parent.postMessage({ type: "pp-ready" }, "*");
void booted.then(renderLibrary);
