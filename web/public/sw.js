// Minimal service worker: makes the UI installable and keeps normal network
// behavior (no offline caching, so a stale UI can never mask an update).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through: the browser fetches from the network as usual.
});
