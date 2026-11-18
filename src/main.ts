// The page: reads the text, picks where to run, streams the explainer,
// and saves it to the library on request.

import "./style.css";
import { buildPrompt, type Detail, type Lang } from "./prompt.ts";
import { chooseRoute, type DeviceStatus, type RunChoice } from "./route.ts";
import { renderMarkdown, firstLine, escapeHtml } from "./markdown.ts";
import { getDeviceStatus, hasPromptApi } from "./device.ts";
import { SAMPLES } from "./samples.ts";
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
const detailSel = $<HTMLSelectElement>("detail");
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

let settings: Settings = { cloudModel: "gemini-3.5-flash-lite", deviceCharLimit: 20000 };
let deviceStatus: DeviceStatus = "unavailable";
let lastResult: { markdown: string; source: "on_device" | "in_cloud"; lang: Lang; text: string } | null = null;

// ---------- Samples and character count ----------
for (const s of SAMPLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = s.label;
  b.addEventListener("click", () => {
    input.value = s.text;
    updateCount();
  });
  $("samples").appendChild(b);
}
const updateCount = () => (charCount.textContent = input.value.length.toLocaleString("en-GB"));
input.addEventListener("input", updateCount);

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
  } else if (deviceStatus === "downloadable" || deviceStatus === "downloading") {
    pill.textContent = deviceStatus === "downloading" ? "On-device AI downloading…" : "☁️ Cloud for now (on-device AI can be set up)";
    pill.classList.add("cloud");
    setupBtn.hidden = false;
  } else {
    pill.textContent = "☁️ Using the cloud";
    pill.classList.add("cloud");
    deviceHelp.hidden = false;
    deviceHelp.textContent = hasPromptApi()
      ? "Chrome's on-device model doesn't support this language here, so the cloud is used."
      : "Want it private? In desktop Chrome, turn on chrome://flags/#prompt-api-for-gemini-nano-multimodal-input and restart. Until then the cloud is used.";
  }
}
langSel.addEventListener("change", refreshDevice);

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
explainBtn.addEventListener("click", explain);

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
  const detail = detailSel.value as Detail;
  const route = chooseRoute({
    choice: runSel.value as RunChoice,
    chars: text.length,
    deviceCharLimit: settings.deviceCharLimit,
    deviceStatus,
  });
  if (!route.ok) {
    showError(route.reason);
    return;
  }

  explainBtn.disabled = true;
  explainBtn.textContent = "Explaining…";
  badge.hidden = true;
  actions.hidden = true;
  routeNote.hidden = false;
  routeNote.textContent = route.reason;
  output.innerHTML = "";
  output.classList.add("streaming");

  const started = performance.now();
  let markdown = "";
  try {
    const model = makeModel(route.mode, lang, settings.cloudModel);
    const prompt = buildPrompt(text, lang, detail);
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
    lastResult = { markdown, source, lang, text };
    actions.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to my library";
  } catch (e) {
    if (!markdown) output.innerHTML = "";
    showError(friendlyError(e));
  } finally {
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
      title: firstLine(lastResult.markdown),
      snippet: lastResult.text.slice(0, 280),
      lang: lastResult.lang,
      source: lastResult.source,
      markdown: lastResult.markdown,
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
}

// ---------- Start ----------
(async () => {
  updateCount();
  settings = await loadSettings();
  await refreshDevice();
  await renderLibrary();
})();
