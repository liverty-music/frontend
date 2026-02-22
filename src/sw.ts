/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

// Precache app shell assets injected by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST)

// Cache ZK circuit artifacts (.wasm and .zkey) with a long-lived CacheFirst strategy.
registerRoute(
	({ url }) => url.pathname.endsWith('.wasm') || url.pathname.endsWith('.zkey'),
	new CacheFirst({
		cacheName: 'zk-circuits-v1',
		plugins: [
			new ExpirationPlugin({
				maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
			}),
		],
	}),
)

// Push notification handler (merged from public/sw.js).
self.addEventListener('push', (event) => {
	let data:
		| { title?: string; body?: string; tag?: string; url?: string }
		| undefined
	try {
		data = event.data?.json()
	} catch {
		data = undefined
	}
	data = data ?? { title: 'Liverty Music', body: 'New notification' }

	const options: NotificationOptions = {
		body: data.body,
		icon: '/favicon.svg',
		badge: '/favicon.svg',
		tag: data.tag || 'liverty-default',
		data: { url: data.url || '/' },
	}

	event.waitUntil(
		self.registration.showNotification(data.title || 'Liverty Music', options),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const url: string = event.notification.data?.url || '/'

	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clients) => {
				let targetUrl: URL
				try {
					targetUrl = new URL(url, self.location.origin)
				} catch {
					targetUrl = new URL('/', self.location.origin)
				}
				for (const client of clients) {
					const clientUrl = new URL(client.url)
					if (clientUrl.href === targetUrl.href && 'focus' in client) {
						return client.focus()
					}
				}
				return self.clients.openWindow(url)
			}),
	)
})
