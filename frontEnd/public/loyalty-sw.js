/*
 * ClinicOS Loyalty — patient PWA service worker (Phase 9).  Scope: /c/
 *
 * WHAT IT DOES
 *   • precaches ONE static page (/loyalty-offline.html) and the app icons, so a reload with no connection shows a branded, honest
 *     "you're offline" page instead of the browser's error screen;
 *   • serves the immutable, content-hashed build files (/_next/static/*) cache-first, so an installed app opens fast;
 *   • page navigations are NETWORK-FIRST: the freshest app is always used; only if the network fails the offline page is shown.
 *
 * WHAT IT NEVER DOES  (privacy — a patient's points, name and activity must not sit in a cache)
 *   • it never touches /api/ or any cross-origin request (the public Loyalty API lives on another origin — the worker doesn't even see it);
 *   • it never caches an HTML page, a JSON response, an Authorization-bearing request, or any non-GET request;
 *   • it holds no patient data and no token.
 */
const VERSION = "loyalty-pwa-v9";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL = ["/loyalty-offline.html", "/loyalty-pwa/icon-192.png", "/loyalty-pwa/icon-512.png", "/loyalty-pwa/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("loyalty-pwa-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // writes always go straight to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the API and every third party are none of our business
  if (url.pathname.startsWith("/api/")) return;
  if (req.headers.has("authorization")) return;

  // 1) page navigations: network first, offline page as the ONLY fallback (the HTML itself is never stored)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/loyalty-offline.html").then((r) => r || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
      )
    );
    return;
  }

  // 2) immutable hashed build files + our own icons: cache first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/loyalty-pwa/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === "basic") cache.put(req, res.clone());
              return res;
            })
        )
      )
    );
  }
  // everything else: untouched (the browser handles it)
});
