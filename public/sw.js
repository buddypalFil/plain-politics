// Plain Politics service worker: keeps a copy of the site on this device so it opens with no internet.
// Offline, explainers run only with the AI built into Chrome (Gemini Nano); nothing can reach the cloud anyway.
// The page (/) is network first, so a new release shows up as soon as you are online; the files in /assets have
// a hash in their name, so they never change and are served from the copy first.
const CACHE = "pp-site";
const SHELL = ["/", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// Finds every file the page needs: its scripts and styles, and the fonts those styles load.
// Only the Latin font files: English, French and Italian need nothing else.
async function filesFor(html) {
  const assets = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]));
  for (const css of [...assets].filter((a) => a.endsWith(".css"))) {
    const text = await (await fetch(css)).text();
    for (const m of text.matchAll(/url\((?:["']?)(\/assets\/[^)"']+)/g)) {
      if (!/\.woff2?$/.test(m[1]) || /-latin-/.test(m[1])) assets.add(m[1]);
    }
  }
  return assets;
}

// Stores the given page and everything it needs, then drops files from older releases.
async function refresh(html) {
  const cache = await caches.open(CACHE);
  const need = await filesFor(html);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  await Promise.all([...need].filter((p) => !have.has(p)).map((p) => cache.add(p).catch(() => {})));
  await Promise.all([...have].filter((p) => p.startsWith("/assets/") && !need.has(p)).map((p) => cache.delete(p)));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const page = await cache.match("/");
    await refresh(await page.text());
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Firebase, Gemini, reCAPTCHA and every other site go straight to the network, untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && url.pathname === "/") {
          const copy = res.clone();
          event.waitUntil((async () => {
            const html = await copy.clone().text();
            await (await caches.open(CACHE)).put("/", copy);
            await refresh(html);
          })());
        }
        return res;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(url.pathname);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.startsWith("/assets/")) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then((c) => c.put(url.pathname, copy)));
    }
    return res;
  })());
});
