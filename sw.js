/* 서비스 워커 — 앱 껍데기만 담아둔다.
 *
 * 담는 것은 화면 파일뿐이고, state.json 은 담지 않는다(늘 새로 받아야 한다).
 * 담아둔 덕분에 인터넷이 없어도 앱이 열리고, app.js 가 마지막으로 받은 내용을 보여준다.
 */
var CACHE = 'oil-shell-v1';
var SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        return n === CACHE ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // 우리 껍데기만 다룬다. GitHub API 응답은 절대 담지 않는다(토큰이 걸린 사적인 내용).
  if (url.origin !== self.location.origin) return;

  // 새 것이 있으면 새 것, 없으면 담아둔 것 — 앱을 고쳐도 다음 실행에 바로 반영된다
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('index.html');
      });
    })
  );
});
