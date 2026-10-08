/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

import { BackgroundSyncPlugin } from 'workbox-background-sync'
import { matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'
import {
	flushInteractionStash,
	NOTIFICATION_FLUSH_MESSAGE,
	NOTIFICATION_SYNC_TAG,
	type PushPayload,
	reportNotificationInteraction,
	resolvePushMetadata,
} from './lib/analytics/notification-interaction'
import {
	configNetworkFirst,
	navigateOrShell,
} from './lib/offline/offline-fallback'
import { handlePushSubscriptionChange } from './lib/push/push-renewal'
import { Events } from './services/analytics-events'

// ---------------------------------------------------------------------------
// Precache app shell assets injected by vite-plugin-pwa at build time.
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// Runtime config endpoint — network-first, last good copy offline.
//
// Online, every boot reads `/config.json` from the network (never a cached
// copy), so ConfigMap updates (followed by a Reloader-triggered pod rollout)
// still propagate on the next page load without cache busting. The response
// is also kept, and served ONLY when the network request fails, so a fan can
// reopen the app without a connection: the tickets screen shows the last
// loaded tickets and makes entry QR codes offline (OpenSpec change
// `ticket-wallet-and-checkin`). This is the additive change anticipated by
// `adopt-runtime-config-for-frontend` design D6.
//
// `/config.json` is intentionally NOT in `__WB_MANIFEST` — it is
// mounted from a K8s ConfigMap at deploy time, not shipped in the
// image's dist output beyond the `public/` fallback.
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) => url.pathname === '/config.json',
	({ request }) => configNetworkFirst(request),
)

// ---------------------------------------------------------------------------
// Navigations — network-first, precached app shell offline.
//
// Online navigations go to the server unchanged (Caddy templating, link
// previews). When the network fails, the precached `index.html` is served so
// the client-side router opens the route offline (e.g. `/tickets` in a venue
// without signal).
// ---------------------------------------------------------------------------
registerRoute(
	new NavigationRoute(({ request }) =>
		navigateOrShell(request, () => matchPrecache('/index.html')),
	),
)

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

// ---------------------------------------------------------------------------
// Push subscription renewal.
//
// The browser rotates/expires push subscriptions and fires
// `pushsubscriptionchange` — possibly with no client open. Renew the browser
// subscription with the VAPID key (read cache-first from `/config.json`) so a
// valid endpoint keeps existing; the actual backend re-registration is done by
// an open client (or the app-open recovery path), since the SW cannot read the
// JWT. `pushsubscriptionchange` is not in the default SW lib types, so it is
// registered via the untyped listener and narrowed locally.
// ---------------------------------------------------------------------------
;(self as ServiceWorkerGlobalScope).addEventListener(
	'pushsubscriptionchange' as keyof ServiceWorkerGlobalScopeEventMap,
	((event: ExtendableEvent) => {
		event.waitUntil(
			handlePushSubscriptionChange({
				registration: self.registration,
				clients: self.clients,
			}),
		)
	}) as EventListener,
)

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
	event.waitUntil(Promise.all([self.clients.claim(), flushInteractionStash()]))
})

self.addEventListener('message', (event) => {
	if (event.data?.type === NOTIFICATION_FLUSH_MESSAGE) {
		event.waitUntil(flushInteractionStash())
	}
	if (event.data?.type === 'SKIP_WAITING') {
		self.skipWaiting()
	}
})
