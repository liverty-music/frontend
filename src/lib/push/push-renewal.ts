/**
 * Service-Worker push-subscription renewal.
 *
 * The browser can rotate or expire a push subscription at any time and signals
 * it with a `pushsubscriptionchange` event — which can fire with NO client open.
 * Left unhandled, the old endpoint keeps 410-ing on the backend and delivery
 * silently ends (the 2026-08 outage). This module renews the browser
 * subscription with the configured VAPID key so a valid endpoint always exists.
 *
 * Re-registration with the backend `PushNotificationService.Create` RPC needs
 * the user's JWT, which lives in `localStorage` and is therefore UNREACHABLE
 * from a Service Worker. So the SW cannot call Create itself. Instead it renews
 * the browser subscription and notifies any open window client to run the
 * main-thread recovery (which owns the auth token and calls Create); the
 * app-open recovery path reconciles the fully-closed case on next launch.
 *
 * Everything here is best-effort and MUST NOT throw out of the event: a failure
 * (permission revoked, offline) simply retries on the next event or app open.
 */

/**
 * Message type posted to window clients when the SW has renewed the browser
 * subscription, asking the client to re-register it with the backend.
 */
export const PUSH_SUBSCRIPTION_CHANGED_MESSAGE =
	'liverty:push:subscription-changed'

/** Named Cache Storage bucket holding the cache-first `/config.json` copy. */
const CONFIG_CACHE_NAME = 'liverty-runtime-config'
const CONFIG_URL = '/config.json'

/** Outcome of a renewal attempt, for logging/tests. */
export type PushRenewalResult = 'renewed' | 'skipped' | 'failed'

/** Minimal client surface the renewal needs — matches `ServiceWorkerGlobalScope.clients`. */
export interface ClientNotifier {
	matchAll(options?: {
		type?: 'window' | 'worker' | 'sharedworker' | 'all'
		includeUncontrolled?: boolean
	}): Promise<ReadonlyArray<{ postMessage(message: unknown): void }>>
}

export interface ReadVapidDeps {
	/** Cache Storage, injectable for tests. Defaults to the global `caches`. */
	cacheStorage?: CacheStorage
	/** Fetch implementation, injectable for tests. Defaults to the global `fetch`. */
	fetchImpl?: typeof fetch
}

/**
 * Reads `vapidPublicKey` from same-origin `/config.json`, cache-first: it serves
 * a previously cached copy when present (so renewal works offline and does not
 * depend on the network), and otherwise fetches once and caches it. The env is
 * carried by `/config.json`, so this keeps the bundle env-agnostic — the SW
 * never bakes a key.
 *
 * Returns `null` (never throws) when the key cannot be obtained, so the caller
 * can skip renewal and retry later.
 */
export async function readVapidPublicKeyCacheFirst(
	deps: ReadVapidDeps = {},
): Promise<string | null> {
	const cacheStorage =
		deps.cacheStorage ?? (globalThis as { caches?: CacheStorage }).caches
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch

	try {
		let response: Response | undefined
		if (cacheStorage) {
			const cache = await cacheStorage.open(CONFIG_CACHE_NAME)
			response = await cache.match(CONFIG_URL)
			if (!response) {
				const fresh = await fetchImpl(CONFIG_URL, { cache: 'no-store' })
				if (fresh?.ok) {
					await cache.put(CONFIG_URL, fresh.clone())
					response = fresh
				}
			}
		} else {
			response = await fetchImpl(CONFIG_URL, { cache: 'force-cache' })
		}

		if (!response?.ok) return null
		const config = (await response.json()) as { vapidPublicKey?: unknown }
		const key = config.vapidPublicKey
		return typeof key === 'string' && key.length > 0 ? key : null
	} catch {
		return null
	}
}

export interface RenewDeps {
	registration: ServiceWorkerRegistration
	vapidKey: string
	clients: ClientNotifier
}

/**
 * Renews the browser push subscription with the VAPID key and notifies open
 * clients to re-register it. Reuses an already-present subscription rather than
 * churning a new endpoint. Best-effort: returns `'failed'` instead of throwing
 * when a new subscription cannot be obtained (permission revoked / offline), so
 * the `pushsubscriptionchange` event never rejects and the stale endpoint is not
 * left registered as active.
 */
export async function renewPushSubscription(
	deps: RenewDeps,
): Promise<PushRenewalResult> {
	const { registration, vapidKey, clients } = deps
	try {
		let subscription = await registration.pushManager.getSubscription()
		if (!subscription) {
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: vapidKey,
			})
		}
		if (!subscription) return 'failed'

		// The SW can renew the browser subscription but cannot call the
		// authenticated Create RPC (no access to the JWT). Ask any open client to
		// re-register via the main-thread recovery path; the app-open path covers
		// the closed-app case. Never let a client notify failure crash the event.
		try {
			const windowClients = await clients.matchAll({
				type: 'window',
				includeUncontrolled: true,
			})
			for (const client of windowClients) {
				client.postMessage({ type: PUSH_SUBSCRIPTION_CHANGED_MESSAGE })
			}
		} catch {
			// Ignore — the app-open recovery still reconciles.
		}

		return 'renewed'
	} catch {
		return 'failed'
	}
}

export interface HandlePushSubscriptionChangeDeps extends ReadVapidDeps {
	registration: ServiceWorkerRegistration
	clients: ClientNotifier
}

/**
 * Orchestrates a `pushsubscriptionchange`: resolve the VAPID key (cache-first),
 * then renew. Returns `'skipped'` when no key is available (renewal retries on a
 * later event). Never throws.
 */
export async function handlePushSubscriptionChange(
	deps: HandlePushSubscriptionChangeDeps,
): Promise<PushRenewalResult> {
	const vapidKey = await readVapidPublicKeyCacheFirst(deps)
	if (!vapidKey) return 'skipped'
	return renewPushSubscription({
		registration: deps.registration,
		vapidKey,
		clients: deps.clients,
	})
}
