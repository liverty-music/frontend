/**
 * Service-worker notification-interaction reporting.
 *
 * A service worker has no `window`, so it cannot run `posthog-js` and does not
 * know the signed-in user. This module is the DOM-free seam shared by the app
 * (which WRITES the identity snapshot) and `sw.ts` (which READS it and reports
 * `notification.opened` / `notification.dismissed` interactions directly to
 * PostHog's public `/capture` endpoint).
 *
 * Design (OpenSpec `emit-notification-analytics-events`, Decision 3):
 *   - The app persists a tiny identity snapshot `{ distinctId, optedOut, ... }`
 *     to the Cache API on identify / opt-out change; the SW reads it when an
 *     interaction fires.
 *   - `notificationclick` / `notificationclose` report the interaction AT
 *     INTERACTION TIME via `event.waitUntil(fetch(...))`, keyed by the
 *     `notification_id` carried in the notification.
 *   - When the snapshot says `optedOut`, nothing is sent.
 *   - A failed `fetch` (offline) is retried via the Background Sync API where
 *     available; otherwise the interaction is written to a bounded IndexedDB
 *     stash and flushed on the next SW activation / app open. The stable
 *     per-interaction `uuid` (`$insert_id`) de-duplicates retries server-side.
 *
 * The module is intentionally free of Aurelia / DOM dependencies so the PWA
 * service-worker bundle can import it without pulling in the app runtime.
 */

import type {
	Events,
	NotificationDismissedProps,
	NotificationOpenedProps,
} from '../../services/analytics-events'

/**
 * The identity + destination the service worker needs to post an interaction
 * to PostHog. `distinctId` / `optedOut` are the identity half the app refreshes
 * on identify and opt-out change; `apiHost` / `projectKey` are the (public)
 * destination so the SW need not read `/config.json` on every interaction.
 */
export interface AnalyticsIdentitySnapshot {
	/** PostHog distinct_id — the signed-in user's platform id once identified. */
	distinctId: string
	/** When true, the user opted out of analytics; the SW sends nothing. */
	optedOut: boolean
	/** PostHog ingestion host, e.g. `https://eu.i.posthog.com`. */
	apiHost: string
	/** Public PostHog project API key (already shipped in the web client). */
	projectKey: string
}

/**
 * One notification interaction awaiting delivery to PostHog. `event` is the
 * catalogue name (`notification.opened` / `notification.dismissed`); `uuid` is
 * the `$insert_id` reused across retries so a Background-Sync / stash resend is
 * de-duplicated; `timestamp` is the ISO-8601 interaction time (NOT the send
 * time) so events attribute to when the user acted.
 */
export interface NotificationInteraction {
	event: typeof Events.NotificationOpened | typeof Events.NotificationDismissed
	notificationId: string
	uuid: string
	timestamp: string
}

/** Cache name holding the single identity-snapshot entry. */
const IDENTITY_CACHE = 'liverty-analytics-identity-v1'
/**
 * Synthetic request URL under which the snapshot Response is stored. The
 * `__liverty__` prefix keeps it clear this is an internal, non-navigable key.
 */
const IDENTITY_KEY = '/__liverty__/analytics-identity'

/** Background Sync tag used to retry a failed interaction send when offline. */
export const NOTIFICATION_SYNC_TAG = 'flush-notification-analytics'
/** postMessage type the app sends to nudge the SW to flush on app open. */
export const NOTIFICATION_FLUSH_MESSAGE = 'flush-notification-analytics'

// -- Push payload -------------------------------------------------------------

/**
 * Push message body. Client-passthrough metadata (`url`, `notification_id`)
 * lives under `data`; `url` / `notification_id` also appear top-level in the
 * legacy shape, read as a rollout compat fallback.
 */
export interface PushPayload {
	title?: string
	body?: string
	tag?: string
	data?: { url?: string; notification_id?: string }
	url?: string
	notification_id?: string
}

/**
 * Resolves the client-passthrough metadata the SW maps into
 * `showNotification` `options.data`, preferring the nested `data` and falling
 * back to the legacy top-level fields so an in-flight old payload (or an old SW
 * against a new payload) still navigates and correlates. `url` defaults to `/`;
 * `notificationId` is `''` when absent (interaction reporting then skips).
 */
export function resolvePushMetadata(payload: PushPayload): {
	url: string
	notificationId: string
} {
	return {
		url: payload.data?.url ?? payload.url ?? '/',
		notificationId:
			payload.data?.notification_id ?? payload.notification_id ?? '',
	}
}

// -- IndexedDB offline stash --------------------------------------------------

const STASH_DB = 'liverty-analytics'
const STASH_STORE = 'notification-interactions'
/**
 * Upper bound on stashed interactions. When full, the oldest entry is dropped
 * so a device that stays offline indefinitely cannot grow storage without
 * bound — best-effort offline delivery, not a durable queue.
 */
const STASH_CAP = 100

function openStashDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(STASH_DB, 1)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STASH_STORE)) {
				// keyPath `uuid` makes the stable interaction id the primary key, so
				// a re-stash of the same interaction overwrites rather than duplicates.
				db.createObjectStore(STASH_STORE, { keyPath: 'uuid' })
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('open stash db failed'))
	})
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('idb request failed'))
	})
}

async function stashInteraction(
	interaction: NotificationInteraction,
): Promise<void> {
	const db = await openStashDB()
	try {
		// Enforce the bound before inserting: drop the oldest keys until there is
		// room for one more. Insertion order == chronological order because the
		// uuid is generated at interaction time and never reused.
		const existing = await promisifyRequest(
			db
				.transaction(STASH_STORE, 'readonly')
				.objectStore(STASH_STORE)
				.getAllKeys(),
		)
		const tx = db.transaction(STASH_STORE, 'readwrite')
		const store = tx.objectStore(STASH_STORE)
		const overflow = existing.length + 1 - STASH_CAP
		for (let i = 0; i < overflow; i++) {
			store.delete(existing[i])
		}
		store.put(interaction)
		await promisifyRequest(
			// A no-op request whose completion mirrors the transaction's.
			store.count(),
		)
	} finally {
		db.close()
	}
}

async function readAllStashed(): Promise<NotificationInteraction[]> {
	const db = await openStashDB()
	try {
		return await promisifyRequest(
			db.transaction(STASH_STORE, 'readonly').objectStore(STASH_STORE).getAll(),
		)
	} finally {
		db.close()
	}
}

async function deleteStashed(uuid: string): Promise<void> {
	const db = await openStashDB()
	try {
		const tx = db.transaction(STASH_STORE, 'readwrite')
		tx.objectStore(STASH_STORE).delete(uuid)
		await promisifyRequest(tx.objectStore(STASH_STORE).count())
	} finally {
		db.close()
	}
}

// -- Identity snapshot (Cache API) --------------------------------------------

/**
 * Persists the identity snapshot for the service worker to read. Called by the
 * app on identify and on analytics opt-out change. Overwrites atomically.
 */
export async function writeIdentitySnapshot(
	snapshot: AnalyticsIdentitySnapshot,
): Promise<void> {
	const cache = await caches.open(IDENTITY_CACHE)
	await cache.put(
		IDENTITY_KEY,
		new Response(JSON.stringify(snapshot), {
			headers: { 'content-type': 'application/json' },
		}),
	)
}

/** Reads the identity snapshot, or null when the app has never written one. */
export async function readIdentitySnapshot(): Promise<AnalyticsIdentitySnapshot | null> {
	const cache = await caches.open(IDENTITY_CACHE)
	const res = await cache.match(IDENTITY_KEY)
	if (res === undefined) return null
	try {
		return (await res.json()) as AnalyticsIdentitySnapshot
	} catch {
		return null
	}
}

// -- Capture body -------------------------------------------------------------

/** Absolute PostHog `/capture` endpoint for the snapshot's host. */
export function captureUrl(apiHost: string): string {
	return `${apiHost.replace(/\/+$/, '')}/capture/`
}

/**
 * Centralised PostHog `/capture` body builder — the single definition of the
 * event shape (event name, `distinct_id`, `$insert_id`, explicit interaction
 * `timestamp`) so the SW path stays aligned with the app SDK. Properties reuse
 * the {@link NotificationOpenedProps} / {@link NotificationDismissedProps}
 * typings (only `notification_id` is carried; `event_id` / `artist_id` are
 * catalogue-optional and not threaded through the payload yet).
 */
export function buildCaptureBody(
	snapshot: AnalyticsIdentitySnapshot,
	interaction: NotificationInteraction,
): Record<string, unknown> {
	const properties: NotificationOpenedProps | NotificationDismissedProps = {
		notification_id: interaction.notificationId,
	}
	return {
		api_key: snapshot.projectKey,
		event: interaction.event,
		distinct_id: snapshot.distinctId,
		timestamp: interaction.timestamp,
		properties: {
			...properties,
			// $insert_id de-duplicates a Background-Sync / stash resend server-side.
			$insert_id: interaction.uuid,
		},
	}
}

// -- Reporting ----------------------------------------------------------------

/** POSTs one interaction to PostHog. Throws on network / non-2xx so callers can stash. */
async function sendInteraction(
	snapshot: AnalyticsIdentitySnapshot,
	interaction: NotificationInteraction,
): Promise<void> {
	const res = await fetch(captureUrl(snapshot.apiHost), {
		method: 'POST',
		// keepalive lets the request outlive a short-lived SW activation.
		keepalive: true,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(buildCaptureBody(snapshot, interaction)),
	})
	if (!res.ok) {
		throw new Error(`posthog capture failed: ${res.status}`)
	}
}

/**
 * Best-effort registration of a Background Sync retry. Returns true when the
 * platform accepted the registration (Chromium); false on Safari / Firefox
 * where the API is absent — the caller then relies on the stash + activation /
 * app-open flush instead.
 */
async function registerSyncRetry(
	registration: ServiceWorkerRegistration,
): Promise<boolean> {
	const withSync = registration as ServiceWorkerRegistration & {
		sync?: { register(tag: string): Promise<void> }
	}
	if (withSync.sync === undefined) return false
	try {
		await withSync.sync.register(NOTIFICATION_SYNC_TAG)
		return true
	} catch {
		return false
	}
}

/**
 * Reports a notification interaction at interaction time. Reads the identity
 * snapshot and:
 *   - skips entirely when there is no snapshot, the user is opted out, or the
 *     notification carries no `notification_id`;
 *   - otherwise sends immediately; on failure stashes the interaction (bounded)
 *     and registers a Background Sync retry where supported.
 *
 * `registration` is `self.registration` from the service worker, used only to
 * register the Sync retry.
 */
export async function reportNotificationInteraction(
	interaction: NotificationInteraction,
	registration: ServiceWorkerRegistration,
): Promise<void> {
	if (interaction.notificationId === '') return
	const snapshot = await readIdentitySnapshot()
	if (snapshot === null || snapshot.optedOut || snapshot.projectKey === '') {
		return
	}
	try {
		await sendInteraction(snapshot, interaction)
	} catch {
		// Offline / transient failure: stash for a later flush and ask the
		// platform to retry via Background Sync where available.
		await stashInteraction(interaction)
		await registerSyncRetry(registration)
	}
}

/**
 * Flushes every stashed interaction, sending each and deleting it only on a
 * successful send (so a still-offline flush leaves the stash intact for the
 * next attempt). Invoked on SW activation, on a `sync` event, and when the app
 * signals it opened. Reads the snapshot once; if opted out, the stash is
 * cleared without sending.
 */
export async function flushInteractionStash(): Promise<void> {
	const stashed = await readAllStashed()
	if (stashed.length === 0) return
	const snapshot = await readIdentitySnapshot()
	if (snapshot === null || snapshot.projectKey === '') return
	if (snapshot.optedOut) {
		// Opted out after stashing: discard rather than send.
		for (const interaction of stashed) {
			await deleteStashed(interaction.uuid)
		}
		return
	}
	for (const interaction of stashed) {
		try {
			await sendInteraction(snapshot, interaction)
			await deleteStashed(interaction.uuid)
		} catch {
			// Still offline — stop and leave the rest for the next flush.
			break
		}
	}
}
