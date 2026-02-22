// Service Worker for Liverty Music push notifications
self.addEventListener('push', (event) => {
	let data;
	try {
		data = event.data?.json();
	} catch {
		// Malformed payload — fall back to defaults
		data = undefined;
	}
	data = data ?? { title: 'Liverty Music', body: 'New notification' };

	const options = {
		body: data.body,
		icon: '/favicon.svg',
		badge: '/favicon.svg',
		tag: data.tag || 'liverty-default',
		data: { url: data.url || '/' },
	};

	event.waitUntil(
		self.registration.showNotification(
			data.title || 'Liverty Music',
			options,
		),
	);
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
