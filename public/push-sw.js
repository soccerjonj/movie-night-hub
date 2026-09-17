/* Push handling, imported into the generated service worker via workbox.importScripts. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Movie Club Hub', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Movie Club Hub';
  let body = data.body || '';
  if (data.at && body.includes('{at}')) {
    const d = new Date(data.at);
    const when = isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    body = body.replace('{at}', when);
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/pwa-icon.png',
    badge: '/pwa-icon.png',
    tag: data.tag || 'movie-club-hub',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) { c.navigate?.(target); return c.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
