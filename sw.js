// 홈 화면 앱용 서비스 워커: 항상 네트워크를 먼저 쓰고, 오프라인일 때만 마지막으로 받은 파일을 보여준다.
const CACHE = "live-earth-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "cdn.jsdelivr.net";
  if (!cacheable) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
