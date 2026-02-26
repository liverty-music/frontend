/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

import { BackgroundSyncPlugin } from 'workbox-background-sync'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'

// ---------------------------------------------------------------------------
// Precache app shell assets injected by vite-plugin-pwa at build time.
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// ZK circuit artifacts — CacheFirst with 30-day TTL.
// ---------------------------------------------------------------------------
const ZK_CACHE = 'zk-circuits-v1'
const CIRCUIT_URLS = ['/ticketcheck.wasm', '/ticketcheck.zkey']

registerRoute(
	({ url }) => url.pathname.endsWith('.wasm') || url.pathname.endsWith('.zkey'),
	new CacheFirst({
		cacheName: ZK_CACHE,
		plugins: [
			new ExpirationPlugin({
				maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
			}),
		],
	}),
)

// Pre-cache circuit files during SW install (non-blocking on failure).
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(ZK_CACHE).then(async (cache) => {
			const existing = await cache.keys()
			const cached = new Set(existing.map((r) => new URL(r.url).pathname))
			const missing = CIRCUIT_URLS.filter((u) => !cached.has(u))
			if (missing.length === 0) return
			try {
				await cache.addAll(missing)
			} catch (err) {
				console.warn('[SW] Circuit pre-cache failed (will retry at runtime):', err)
			}
		}),
	)
})

// ---------------------------------------------------------------------------
// Concert list API — NetworkFirst with 3s timeout, 24h cache.
// ---------------------------------------------------------------------------
const CONCERT_CACHE = 'concert-api-v1'

registerRoute(
	({ url }) =>
		url.pathname.includes('liverty_music.rpc.concert.v1.ConcertService'),
	new NetworkFirst({
		cacheName: CONCERT_CACHE,
		networkTimeoutSeconds: 3,
		plugins: [
			new ExpirationPlugin({
				maxEntries: 50,
				maxAgeSeconds: 24 * 60 * 60, // 24 hours
			}),
		],
		fetchOptions: {},
	}),
)

// ---------------------------------------------------------------------------
// Background Sync for artist operations (follow / unfollow / passion level).
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) =>
		url.pathname.includes('liverty_music.rpc.artist.v1.ArtistService'),
	new NetworkFirst({
		cacheName: 'artist-api-v1',
		plugins: [
			new BackgroundSyncPlugin('artist-ops-queue', {
				maxRetentionTime: 7 * 24 * 60, // 7 days (minutes)
			}),
		],
	}),
	'POST',
)

// ---------------------------------------------------------------------------
// Periodic Background Sync — refresh concert cache.
// ---------------------------------------------------------------------------
self.addEventListener('periodicsync', (event: ExtendableEvent & { tag?: string }) => {
	if (event.tag !== 'concert-refresh') return

	event.waitUntil(
		caches.open(CONCERT_CACHE).then(async (cache) => {
			const keys = await cache.keys()
			// Re-fetch each cached concert API request to refresh the data.
			for (const request of keys) {
				try {
					const response = await fetch(request)
					if (response.ok) {
						await cache.put(request, response)
					}
				} catch {
					// Silent failure — will retry at next periodic sync interval.
				}
			}
		}),
	)
})

// ---------------------------------------------------------------------------
// Push notification handler.
// ---------------------------------------------------------------------------
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
				// Only open same-origin URLs to prevent external redirects.
				const safeUrl =
					targetUrl.origin === self.location.origin ? targetUrl.href : '/'
				return self.clients.openWindow(safeUrl)
			}),
	)
})
