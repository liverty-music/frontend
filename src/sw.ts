/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

import { BackgroundSyncPlugin } from 'workbox-background-sync'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkOnly } from 'workbox-strategies'
import {
	flushInteractionStash,
	NOTIFICATION_FLUSH_MESSAGE,
	NOTIFICATION_SYNC_TAG,
	type PushPayload,
	reportNotificationInteraction,
	resolvePushMetadata,
} from './lib/analytics/notification-interaction'
import { Events } from './services/analytics-events'

// ---------------------------------------------------------------------------
// Precache app shell assets injected by vite-plugin-pwa at build time.
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// Runtime config endpoint — NetworkOnly.
//
// Why NetworkOnly: ConfigMap updates (followed by Reloader-triggered pod
// rollout) MUST propagate on the next page load without depending on
// cache busting. Caching `/config.json` in the SW would create a window
// where the SPA boots against stale config after an operator change.
//
// OFFLINE TRADE-OFF (intentional, scoped non-goal for this change):
// A user who has previously loaded the app and then goes offline will
// see `showStaticErrorPage` from `loadAppConfig()` rather than a
// partial cached experience. Auth and gRPC already require network, so
// offline support was always limited. If offline-tolerant config
// becomes a goal, swap this for a `NetworkFirst` (or
// `StaleWhileRevalidate`) strategy with a short TTL — additive change.
// See OpenSpec change `adopt-runtime-config-for-frontend` design D6
// Risks/Trade-offs for the full rationale.
//
// `/config.json` is intentionally NOT in `__WB_MANIFEST` — it is
// mounted from a K8s ConfigMap at deploy time, not shipped in the
// image's dist output beyond the `public/` fallback.
// ---------------------------------------------------------------------------
registerRoute(({ url }) => url.pathname === '/config.json', new NetworkOnly())

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
// PWA Share Target handler — DISABLED.
//
// This fetch handler intercepted the POST that the Android Gmail share sheet
// sent to `/import/ticket-email`, extracted the shared email data, and
// redirected to the import wizard route. The share entry point no longer
// exists: the `share_target` declaration was removed from the manifest and
// the Android share action that fed it is gone, so this interception can
// never fire. It is kept (disabled) rather than deleted so a future revival
// can re-enable the ticket-email import flow without re-implementation —
// re-add `share_target` to the manifest and un-comment the handler below.
// ---------------------------------------------------------------------------
// self.addEventListener('fetch', (event) => {
// 	const url = new URL(event.request.url)
// 	if (
// 		event.request.method === 'POST' &&
// 		url.pathname === '/import/ticket-email'
// 	) {
// 		event.respondWith(
// 			(async () => {
// 				const formData = await event.request.formData()
// 				const title = formData.get('title')?.toString() ?? ''
// 				const text = formData.get('text')?.toString() ?? ''
// 				const params = new URLSearchParams({ title, text })
// 				return Response.redirect(
// 					`/import/ticket-email?${params.toString()}`,
// 					303,
// 				)
// 			})(),
// 		)
// 	}
// })

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
	let payload: PushPayload | undefined
	try {
		payload = event.data?.json()
	} catch {
		payload = undefined
	}
	payload = payload ?? { title: 'Liverty Music', body: 'New notification' }

	// Compat shim (removed once both sides are deployed): resolve url /
	// notification_id from the nested `data`, falling back to the legacy
	// top-level fields.
	const { url, notificationId } = resolvePushMetadata(payload)

	const options: NotificationOptions = {
		body: payload.body,
		icon: '/icons/icon-192x192.png',
		badge: '/favicon-96x96.png',
		tag: payload.tag || 'liverty-default',
		// Map the passthrough metadata straight into options.data so
		// notificationclick/close read event.notification.data.{url,notification_id}.
		data: { url, notification_id: notificationId },
	}

	event.waitUntil(
		self.registration.showNotification(
			payload.title || 'Liverty Music',
			options,
		),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const data = (event.notification.data ?? {}) as {
		url?: string
		notification_id?: string
	}
	const url: string = data.url || '/'
	const notificationId: string = data.notification_id ?? ''

	event.waitUntil(
		(async () => {
			// Report the open at interaction time (orthogonal to navigation). Kept
			// first so the capture is issued even if focus/openWindow throws.
			await reportNotificationInteraction(
				{
					event: Events.NotificationOpened,
					notificationId,
					uuid: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
				},
				self.registration,
			)

			const clients = await self.clients.matchAll({
				type: 'window',
				includeUncontrolled: true,
			})
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
		})(),
	)
})

self.addEventListener('notificationclose', (event) => {
	const data = (event.notification.data ?? {}) as { notification_id?: string }
	event.waitUntil(
		reportNotificationInteraction(
			{
				event: Events.NotificationDismissed,
				notificationId: data.notification_id ?? '',
				uuid: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
			},
			self.registration,
		),
	)
})

// Offline fallback flush points: retry stashed interactions when the platform
// fires a Background Sync, on SW activation, and when the app signals it opened.
//
// The `sync` event (Background Sync API) is not in the default TS SW lib types,
// so it is registered via the untyped listener and narrowed locally.
type SyncEventLike = ExtendableEvent & { tag: string }
;(self as ServiceWorkerGlobalScope).addEventListener(
	'sync' as keyof ServiceWorkerGlobalScopeEventMap,
	((event: SyncEventLike) => {
		if (event.tag === NOTIFICATION_SYNC_TAG) {
			event.waitUntil(flushInteractionStash())
		}
	}) as EventListener,
)

self.addEventListener('activate', (event) => {
	event.waitUntil(flushInteractionStash())
})

self.addEventListener('message', (event) => {
	if (event.data?.type === NOTIFICATION_FLUSH_MESSAGE) {
		event.waitUntil(flushInteractionStash())
	}
})
