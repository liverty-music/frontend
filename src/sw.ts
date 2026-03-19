/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

import { BackgroundSyncPlugin } from 'workbox-background-sync'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkOnly } from 'workbox-strategies'

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
				console.warn(
					'[SW] Circuit pre-cache failed (will retry at runtime):',
					err,
				)
			}
		}),
	)
})

// ---------------------------------------------------------------------------
// PWA Share Target handler — intercepts POST from Android share sheet.
// Extracts shared email data and redirects to the import wizard route.
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url)
	if (
		event.request.method === 'POST' &&
		url.pathname === '/import/ticket-email'
	) {
		event.respondWith(
			(async () => {
				const formData = await event.request.formData()
				const title = formData.get('title')?.toString() ?? ''
				const text = formData.get('text')?.toString() ?? ''
				const params = new URLSearchParams({ title, text })
				return Response.redirect(
					`/import/ticket-email?${params.toString()}`,
					303,
				)
			})(),
		)
	}
})

// ---------------------------------------------------------------------------
// Background Sync for artist operations (listTop / listSimilar / search).
// NetworkOnly avoids cache.put() on POST responses (Cache API is GET-only).
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) =>
		url.pathname.includes('liverty_music.rpc.artist.v1.ArtistService'),
	new NetworkOnly({
		plugins: [
			new BackgroundSyncPlugin('artist-ops-queue', {
				maxRetentionTime: 7 * 24 * 60, // 7 days (minutes)
			}),
		],
	}),
	'POST',
)

// ---------------------------------------------------------------------------
// Background Sync for follow operations (follow / unfollow / hype).
// NetworkOnly avoids cache.put() on POST responses (Cache API is GET-only).
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) =>
		url.pathname.includes('liverty_music.rpc.follow.v1.FollowService'),
	new NetworkOnly({
		plugins: [
			new BackgroundSyncPlugin('follow-ops-queue', {
				maxRetentionTime: 7 * 24 * 60, // 7 days (minutes)
			}),
		],
	}),
	'POST',
)

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
