self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Почта России', {
    body: data.body || 'Обновление по вашему талону', data: { url: data.url || '/' }, icon: '/favicon.svg'
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => windows[0] ? windows[0].focus() : clients.openWindow(event.notification.data.url)));
});
