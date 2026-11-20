// Side panel: shows the Plain Politics web app and hands it the text of the page you are reading.
const isExtension = typeof chrome !== "undefined" && !!chrome.storage;
// Opened from `npm run dev` (http://localhost:5173/extension/sidepanel.html) it previews the local app.
const APP = isExtension ? "https://plain-politics-app.web.app" : location.origin;
// To test the real extension against `npm run dev`, use: const APP = "http://localhost:5173";

const frame = document.getElementById("app");
const loadingText = document.getElementById("loading-text");
frame.src = APP + "/?embed=1";

let ready = false;
let queued = null;
let gotTimer = 0;

const failTimer = setTimeout(() => {
  if (ready) return;
  document.body.classList.add("failed");
  loadingText.textContent = "Couldn't reach Plain Politics. Check your internet connection, then close and reopen this panel.";
}, 15000);

window.addEventListener("message", (e) => {
  if (e.origin !== APP || e.source !== frame.contentWindow || !e.data) return;
  const { type } = e.data;
  if (type === "pp-ready") {
    ready = true;
    clearTimeout(failTimer);
    document.body.classList.remove("failed");
    document.body.classList.add("ready");
    if (queued) { const q = queued; queued = null; send(q); }
  } else if (type === "pp-got") {
    clearTimeout(gotTimer);
  } else if (type === "pp-request") {
    fromPage(e.data.what === "selection");
  }
});

// Shows a short message in the app's page card.
function status(text) {
  if (ready) frame.contentWindow.postMessage({ type: "pp-status", text }, APP);
}

function send(p) {
  if (!p || !p.text) return;
  if (!ready) { queued = p; return; }
  frame.contentWindow.postMessage({ type: "pp-text", text: p.text, title: p.title, autoRun: p.autoRun !== false }, APP);
  clearTimeout(gotTimer);
  gotTimer = setTimeout(() => status("Plain Politics didn't receive the page. Close this panel and open it again."), 4000);
}

async function fromPage(selectionOnly) {
  if (!isExtension) { status("Open this panel from the Chrome extension to read pages."); return; }
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
    if (!r || !r.text) {
      status(selectionOnly ? "Select some text on the page first, then try again." : "This page has no text to explain.");
      return;
    }
    send({ ...r, autoRun: true });
  } catch {
    status("Chrome needs your OK to read this page: click the PP icon in Chrome's toolbar, or right-click the page and choose “Explain this page with Plain Politics”.");
  }
}

// Text sent by a toolbar click or the right-click menu (see background.js).
async function takePending() {
  const { pending } = await chrome.storage.session.get("pending");
  if (pending && Date.now() - pending.at < 60000) {
    await chrome.storage.session.remove("pending");
    send(pending);
  }
}
if (isExtension) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes.pending && changes.pending.newValue) takePending();
  });
  takePending();
}
