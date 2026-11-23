// The page: reads the text, picks where to run, streams the explainer,
// and saves it to the library on request.

import "@fontsource/unifrakturmaguntia/latin-400.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/libre-franklin/wght.css";
import "./style.css";
import { buildPrompt, buildComparePrompt, HEADINGS, COMPARE_HEADINGS, LANGUAGE_NAMES, PERSUADES_HEADING, CONTEXT_HEADING, type Lang, type Level, type Mode } from "./prompt.ts";
import { chooseRoute, type DeviceStatus, type RunChoice } from "./route.ts";
import { renderMarkdown, firstLine, escapeHtml } from "./markdown.ts";
import { getDeviceStatus, getImageDeviceStatus, hasPromptApi, warmUpDevice } from "./device.ts";
import { readingAge } from "./readability.ts";
import { SAMPLES, COMPARE_SAMPLES } from "./samples.ts";
import { drawFrontPage } from "./share.ts";
import { youtubeUrl } from "./youtube.ts";
import { findSpin, countByKind, highlightHtml, SPIN_KINDS, type SpinKind } from "./spin.ts";
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

// ---------- Compare: "Where they differ" as A and B lines ----------
// The model writes "**Topic**: Text A: ... Text B: ...". Each side gets its own line with an A or B mark.
// If a line doesn't follow that pattern (another language, a different wording), it is left as written.
function shapeDiffer(lang: Lang): void {
  const card = [...output.querySelectorAll(".card")].find((c) => c.querySelector("h3")?.textContent?.trim() === COMPARE_HEADINGS[lang][2]);
  if (!card) return;
  for (const li of card.querySelectorAll("li")) {
    const topic = li.querySelector(":scope > strong:first-child");
    const rest = li.innerHTML.slice(topic ? topic.outerHTML.length : 0).replace(/^\s*[:\-–—]\s*/, "");
    const m = rest.match(/^(?:Text|Testo|Texte)\s*A\s*:\s*([\s\S]*?)\s*(?:Text|Testo|Texte)\s*B\s*:\s*([\s\S]*)$/i);
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
  spinWhy.textContent = total ? SPIN_ALL_WHY : "No loaded words from our list in this text.";
  spinClips.className = "spin-clips";
  spinClips.innerHTML = total
    ? texts.map((t, i) => `<div class="clip-wrap">${texts.length > 1 ? `<div class="tlabel">Text ${"AB"[i]} · ${found[i].length}</div>` : ""}<div class="clip">${highlightHtml(t, found[i])}</div></div>`).join("")
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
      : comparing()
        ? "Two texts on the same topic, for example two parties' plans. See where they agree and differ, without being told which is better. Or try a made-up pair:"
        : "A news article, a speech, a bill or a manifesto. Or try a made-up sample:";
  input2.hidden = $("label-a").hidden = $("label-b").hidden = !comparing();
  const lede = output.querySelector(".empty-lede");
  if (lede) {
    lede.innerHTML = comparing()
      ? "Paste two texts and press <b>Compare them</b>. Your comparison appears here, in plain words:"
      : "Paste a text and press <b>Explain it</b>. Your explainer appears here, in plain words:";
  }
  document.body.classList.toggle("compare-on", comparing());
  input.placeholder = comparing() ? "Paste the first text here…" : "Paste the text here…";
  if (!explainBtn.disabled) explainBtn.textContent = explainLabel();
  updateCount();
  updatePrivacy();
  // The outline only exists before the first result (a result replaces it), so it may be gone.
  const ghost = document.getElementById("ghost");
  if (ghost) ghost.innerHTML = sectionNames().map((h) => `<li>${escapeHtml(h)}</li>`).join("");
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
const updateCount = () => (charCount.textContent = allText().length.toLocaleString("en-GB"));
for (const box of [input, input2]) {
  box.addEventListener("input", () => {
    updateCount();
    updatePrivacy();
  });
}
const explainLabel = () => (comparing() ? "Compare them" : "Explain it");

// ---------- Privacy guard ----------
function updatePrivacy(): void {
  const found = findPersonalData(allText());
  privacyBox.classList.toggle("found", found.length > 0);
  redactBtn.hidden = found.length === 0;
  privacyText.textContent =
    found.length === 0
      ? "Privacy guard is on: personal details never go to the cloud."
      : `Found ${describeFindings(found)}. This text will only run on your device.`;
}
redactBtn.addEventListener("click", () => {
  input.value = redact(input.value);
  input2.value = redact(input2.value);
  updateCount();
  updatePrivacy();
});
redactSendBtn.addEventListener("click", () => {
  input.value = redact(input.value);
  input2.value = redact(input2.value);
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
  const tick = () => setPhotoStatus(`Listening to the ${label} in the cloud… ${Math.round((performance.now() - started) / 1000)} s (a 5-minute speech takes about half a minute)`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const text = await readMedia(src, settings.cloudModel);
    if (!text || /^NO TEXT\.?$/i.test(text)) {
      setPhotoStatus(`Nothing to read: no speech or text was found in the ${label}.`);
      return;
    }
    fillFromSource(text, `Written out in the cloud from the ${label}.`);
    ytRow.hidden = true;
  } catch (e) {
    setPhotoStatus(`Couldn't read the ${label}: ${friendlyError(e)}`);
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
// Ctrl+Enter (Cmd+Enter on a Mac) in a text box explains it.
for (const box of [input, input2]) {
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !explainBtn.disabled) {
      e.preventDefault();
      explainBtn.click();
    }
  });
}

async function explain(): Promise<void> {
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
    showError(route.reason);
    redactSendBtn.hidden = !route.privacy;
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
    const prompt = compare ? buildComparePrompt(a, b, lang, level) : buildPrompt(text, lang, level, mode);
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
    // Reading age compares one original with its explainer, so it is left out of comparisons.
    if (!compare) showGauge(text, output.innerText, lang);
    else shapeDiffer(lang);
    showSpin(compare ? [a, b] : [a]);
    addClaimButtons(lang);
    lastResult = { markdown, source, lang, text, findings, seconds: secs };
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
    explainBtn.textContent = explainLabel();
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
