/* Boarding — service worker : affiche les alertes envoyées par le serveur (Web Push). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Boarding', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Boarding', {
    body: d.body || '', icon: '/boarding/icon-192.png', badge: '/boarding/icon-192.png',
    tag: 'boarding', renotify: true, data: { url: d.url || '/boarding/' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/boarding/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (l) {
    for (var i = 0; i < l.length; i++) if (l[i].url.indexOf('/boarding/') >= 0) return l[i].focus();
    return self.clients.openWindow(url);
  }));
});
