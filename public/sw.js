// Service Worker for Liverty Music push notifications
self.addEventListener('push', (event) => {
	const data = event.data?.json() ?? {
		title: 'Liverty Music',
		body: 'New notification',
	};

	const options = {
		body: data.body,
		icon: '/favicon.svg',
		badge: '/favicon.svg',
		tag: data.tag || 'liverty-default',
		data: { url: data.url || '/' },
	};

	event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url || '/';

	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clients) => {
				for (const client of clients) {
					if (new URL(client.url).pathname === url && 'focus' in client) {
						return client.focus();
					}
				}
				return self.clients.openWindow(url);
			}),
	);
});
