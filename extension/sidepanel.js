// Side panel: shows the Plain Politics web app and hands it the text of the page you are reading.
const APP = "https://plain-politics-app.web.app";
// For local testing against `npm run dev`, use: const APP = "http://localhost:5173";

const frame = document.getElementById("app");
const msg = document.getElementById("msg");
frame.src = APP + "/?embed=1";

let ready = false;
let queued = null;
let gotTimer = 0;

window.addEventListener("message", (e) => {
  if (e.origin !== APP || e.source !== frame.contentWindow) return;
  if (e.data && e.data.type === "pp-got") {
    clearTimeout(gotTimer);
    say("");
    return;
  }
  if (e.data && e.data.type === "pp-ready") {
    ready = true;
    if (queued) { const q = queued; queued = null; send(q); }
  }
});

function send(p) {
  if (!p || !p.text) return;
  if (!ready) { queued = p; return; }
  frame.contentWindow.postMessage({ type: "pp-text", text: p.text, title: p.title, autoRun: p.autoRun !== false }, APP);
  say("Sending the page to Plain Politics…");
  clearTimeout(gotTimer);
  gotTimer = setTimeout(() => say("Plain Politics didn't receive the page. Close this panel and open it again."), 4000);
}

function say(t) { msg.textContent = t; msg.hidden = !t; }

async function fromPage(selectionOnly) {
  say("Reading the page…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [selectionOnly],
      func: (selOnly) => {
        const sel = String(window.getSelection() || "").trim();
        if (selOnly) return { text: sel, title: document.title || "" };
        const root = document.querySelector("article") || document.querySelector("main") || document.body;
        const raw = sel.length > 80 ? sel : root.innerText;
        return { text: raw.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000), title: document.title || "" };
      },
    });
    const r = res && res.result;
    if (!r || !r.text) { say(selectionOnly ? "Select some text on the page first." : "This page has no text to explain."); return; }
    if (!ready) say("Waiting for Plain Politics to load…");
    send({ ...r, autoRun: true });
  } catch {
    say("Chrome needs your OK for this page: click the PP icon in the toolbar, or right-click the page and choose “Explain this page with Plain Politics”.");
  }
}

document.getElementById("page").addEventListener("click", () => fromPage(false));
document.getElementById("sel").addEventListener("click", () => fromPage(true));

// Text sent from the right-click menu.
async function takePending() {
  const { pending } = await chrome.storage.session.get("pending");
  if (pending && Date.now() - pending.at < 60000) {
    await chrome.storage.session.remove("pending");
    send(pending);
  }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.pending && changes.pending.newValue) takePending(); });
takePending();
