/* Stride Beats service worker: keeps the app and saved episodes on the phone. */
var SHELL = "sb-shell-v1";
var EPS = "sb-episodes";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(["./", "./index.html"]); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("sb-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Saved episodes live at <scope>/offline/<id>. Safari's audio player asks for byte ranges, so answer them. */
function serveSaved(req) {
  var u = new URL(req.url);
  return caches.open(EPS).then(function (c) { return c.match(u.origin + u.pathname); }).then(function (hit) {
    if (!hit) return new Response("Not saved", { status: 404 });
    var type = hit.headers.get("Content-Type") || "audio/mpeg";
    return hit.blob().then(function (blob) {
      var size = blob.size, range = req.headers.get("Range");
      if (range) {
        var m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        var start = m[1] ? parseInt(m[1], 10) : 0;
        var end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
        if (start >= size) return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } });
        return new Response(blob.slice(start, end + 1, type), { status: 206, headers: {
          "Content-Type": type, "Content-Length": String(end - start + 1),
          "Content-Range": "bytes " + start + "-" + end + "/" + size, "Accept-Ranges": "bytes" } });
      }
      return new Response(blob, { status: 200, headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (u.pathname.indexOf("/offline/") !== -1) { e.respondWith(serveSaved(req)); return; }
    /* App files: try the network so updates arrive, fall back to the saved copy offline. */
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match("./index.html"); });
    }));
    return;
  }
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (r) { c.put(req, r.clone()); return r; });
      });
    }));
  }
});
