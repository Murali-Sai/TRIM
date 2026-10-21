// TRIM service worker: shows streak reminders (Web Push) and opens Log food when tapped.
// It caches nothing; the app works the same with or without it.

self.addEventListener('push', (event) => {
  let data = { title: 'TRIM', body: 'Log something today.', url: '/log' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // A message that is not JSON still shows the default text.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'streak-reminder',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/log', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
