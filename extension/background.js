// Plain Politics extension: opens the side panel and passes it the text to explain.
// The text goes straight from the page to the side panel; no server in between.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "pp-selection", title: "Explain the selection with Plain Politics", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "pp-page", title: "Explain this page with Plain Politics", contexts: ["page"] });
});

// Clicking the toolbar icon opens the side panel and explains the page straight away.
// (Handling the click ourselves gives the extension Chrome's one-time OK for this tab.)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.action.onClicked.addListener((tab) => openAndExplain(tab, null));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const sel = info.menuItemId === "pp-selection" ? info.selectionText : null;
  openAndExplain(tab, sel);
});

async function openAndExplain(tab, selectionText) {
  if (!tab?.id) return;
  // Must be called straight away, while Chrome still counts the click as the user's.
  const opening = chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  let pending = null;
  if (selectionText) {
    pending = { text: selectionText, title: tab.title || "", autoRun: true };
  } else {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageText });
      if (res?.result?.text) pending = { ...res.result, autoRun: true };
    } catch {
      // Chrome's own pages and the Web Store can't be read; the panel still opens.
    }
  }
  await opening;
  if (pending) await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } });
}

// Runs inside the web page: the selection if there is one, otherwise the article text.
function extractPageText() {
  const sel = String(window.getSelection() || "").trim();
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const raw = sel.length > 80 ? sel : root.innerText;
  const text = raw.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
  return { text, title: document.title || "" };
}
