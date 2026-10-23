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
	type NotificationMetadata,
	notificationInteraction,
	type PushPayload,
	reportNotificationInteraction,
	resolvePushMetadata,
} from './lib/analytics/notification-interaction'
import {
	configStaleWhileRevalidate,
	navigateOrShell,
	OFFLINE_CONFIG_CACHE,
} from './lib/offline/offline-fallback'
import {
	ARTIST_WRITES,
	FOLLOW_WRITES,
	isRpcMethod,
} from './lib/offline/rpc-write-route'
import { handlePushSubscriptionChange } from './lib/push/push-renewal'
import { Events } from './services/analytics-events'

// ---------------------------------------------------------------------------
// Precache app shell assets injected by vite-plugin-pwa at build time.
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// Runtime config endpoint — the kept copy first, refreshed in the background.
//
// Start-up reads `/config.json` before Aurelia starts, so a network round trip
// here delayed every boot (1.4 s on Slow 4G). The worker serves the copy kept
// from the last start and refreshes it from the network for the next one, so a
// ConfigMap change (followed by a Reloader-triggered pod rollout) reaches a
// device one start later. An app release drops the kept copy on activate, so
// new code always starts with the config read from the network. With no kept
// copy the worker waits for the network; offline it fails like the network.
// The kept copy also lets a fan reopen the app without a connection: the
// tickets screen shows the last loaded tickets and makes entry QR codes
// offline (OpenSpec change `ticket-wallet-and-checkin`).
//
// `/config.json` is intentionally NOT in `__WB_MANIFEST` — it is
// mounted from a K8s ConfigMap at deploy time, not shipped in the
// image's dist output beyond the `public/` fallback.
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) => url.pathname === '/config.json',
	({ request, event }) =>
		configStaleWhileRevalidate(request, (work) => event.waitUntil(work)),
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
// Background Sync for writes only: creating an artist and follow / unfollow /
// hype. A write the fan made offline is worth replaying. Reads (artist List,
// Search, ListSimilar, ListTop; follow List) are not routed here: a replayed
// read has no one waiting for its answer, and routing them through the
// Service Worker added a hop to every Discovery request.
// NetworkOnly avoids cache.put() on POST responses (Cache API is GET-only).
// ---------------------------------------------------------------------------
registerRoute(
	({ url }) =>
		isRpcMethod(
			url.pathname,
			'liverty_music.rpc.artist.v1.ArtistService',
			ARTIST_WRITES,
		),
	new NetworkOnly({
		plugins: [
			new BackgroundSyncPlugin('artist-ops-queue', {
				maxRetentionTime: 7 * 24 * 60, // 7 days (minutes)
			}),
		],
	}),
	'POST',
)

registerRoute(
	({ url }) =>
		isRpcMethod(
			url.pathname,
			'liverty_music.rpc.follow.v1.FollowService',
			FOLLOW_WRITES,
		),
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
	const { url, notificationId, type, milestone } = resolvePushMetadata(payload)

	const options: NotificationOptions = {
		body: payload.body,
		icon: '/icons/icon-192x192.png',
		badge: '/favicon-96x96.png',
		tag: payload.tag || 'default',
		// Map the passthrough metadata straight into options.data so
		// notificationclick/close read it back (readMetadata).
		data: { url, notification_id: notificationId, type, milestone },
	}

	event.waitUntil(
		self.registration.showNotification(
			payload.title || 'Liverty Music',
			options,
		),
	)
})

/** The metadata the push handler stored in `options.data`. */
function readMetadata(
	notification: Notification,
): Partial<NotificationMetadata> {
	const data = (notification.data ?? {}) as {
		url?: string
		notification_id?: string
		type?: string
		milestone?: string
	}
	return {
		url: data.url,
		notificationId: data.notification_id,
		type: data.type,
		milestone: data.milestone,
	}
}

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const data = readMetadata(event.notification)
	const url: string = data.url || '/'

	event.waitUntil(
		(async () => {
			// Report the open at interaction time (orthogonal to navigation). Kept
			// first so the capture is issued even if focus/openWindow throws.
			await reportNotificationInteraction(
				notificationInteraction(
					Events.NotificationOpened,
					data,
					self.location.origin,
				),
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
	event.waitUntil(
		reportNotificationInteraction(
			notificationInteraction(
				Events.NotificationDismissed,
				readMetadata(event.notification),
				self.location.origin,
			),
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
	event.waitUntil(
		Promise.all([
			self.clients.claim(),
			flushInteractionStash(),
			// A release: the next start reads the config from the network, so
			// new code never starts with a config kept for the old code.
			caches.delete(OFFLINE_CONFIG_CACHE),
		]),
	)
})

self.addEventListener('message', (event) => {
	if (event.data?.type === NOTIFICATION_FLUSH_MESSAGE) {
		event.waitUntil(flushInteractionStash())
	}
	if (event.data?.type === 'SKIP_WAITING') {
		self.skipWaiting()
	}
})
