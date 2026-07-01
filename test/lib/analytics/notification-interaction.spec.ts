import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type AnalyticsIdentitySnapshot,
	buildCaptureBody,
	captureUrl,
	flushInteractionStash,
	type NotificationInteraction,
	reportNotificationInteraction,
	resolvePushMetadata,
	writeIdentitySnapshot,
} from '../../../src/lib/analytics/notification-interaction'
import { Events } from '../../../src/services/analytics-events'

// ── In-memory Cache API fake ────────────────────────────────────────────────
// jsdom provides no `caches`; back it with a Map keyed by request URL.

class FakeCache {
	// Store the body text, not the Response: a real cache.match returns a fresh
	// Response each call, so the body is never consumed across reads.
	private readonly store = new Map<string, string>()
	async put(key: string, res: Response): Promise<void> {
		this.store.set(key, await res.text())
	}
	async match(key: string): Promise<Response | undefined> {
		const body = this.store.get(key)
		return body === undefined ? undefined : new Response(body)
	}
}

function installFakeCaches(): void {
	const registry = new Map<string, FakeCache>()
	;(globalThis as unknown as { caches: CacheStorage }).caches = {
		open: async (name: string) => {
			let cache = registry.get(name)
			if (cache === undefined) {
				cache = new FakeCache()
				registry.set(name, cache)
			}
			return cache as unknown as Cache
		},
	} as CacheStorage
}

// ── In-memory IndexedDB fake ────────────────────────────────────────────────
// Minimal subset used by the offline stash: a single keyPath store whose data
// persists across open()/close() within a test (module-level `rows`).

function installFakeIndexedDB(): void {
	const dbs = new Map<string, Map<string, Map<string, unknown>>>()

	function fireSuccess<T>(result: T): IDBRequest<T> {
		const req = {
			result,
			onsuccess: null,
			onerror: null,
		} as unknown as IDBRequest<T> & {
			onsuccess: (() => void) | null
			onupgradeneeded: (() => void) | null
		}
		queueMicrotask(() => req.onsuccess?.())
		return req
	}

	;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = {
		open(name: string) {
			if (!dbs.has(name)) dbs.set(name, new Map())
			const stores = dbs.get(name)!
			const db = {
				objectStoreNames: {
					contains: (s: string) => stores.has(s),
				},
				createObjectStore: (s: string, _opts: { keyPath: string }) => {
					if (!stores.has(s)) stores.set(s, new Map())
				},
				transaction: (storeName: string) => ({
					objectStore: () => {
						const rows = stores.get(storeName) ?? new Map<string, unknown>()
						stores.set(storeName, rows)
						return {
							getAllKeys: () => fireSuccess([...rows.keys()]),
							getAll: () => fireSuccess([...rows.values()]),
							// keyPath is `uuid`, so a re-put with the same uuid overwrites.
							put: (value: { uuid: string }) => {
								rows.set(value.uuid, value)
								return fireSuccess(undefined)
							},
							delete: (key: string) => {
								rows.delete(key)
								return fireSuccess(undefined)
							},
							count: () => fireSuccess(rows.size),
						}
					},
				}),
				close: () => {},
			}
			const req = {
				result: db,
				onsuccess: null,
				onerror: null,
				onupgradeneeded: null,
			} as unknown as IDBOpenDBRequest & {
				onupgradeneeded: (() => void) | null
				onsuccess: (() => void) | null
			}
			queueMicrotask(() => {
				req.onupgradeneeded?.()
				req.onsuccess?.()
			})
			return req
		},
	} as unknown as IDBFactory
}

const SNAPSHOT: AnalyticsIdentitySnapshot = {
	distinctId: 'user-123',
	optedOut: false,
	apiHost: 'https://eu.i.posthog.com',
	projectKey: 'phc_test',
}

const OPENED: NotificationInteraction = {
	event: Events.NotificationOpened,
	notificationId: 'notif-1',
	uuid: 'uuid-1',
	timestamp: '2026-07-01T00:00:00.000Z',
}

const registration = {
	sync: { register: vi.fn().mockResolvedValue(undefined) },
} as unknown as ServiceWorkerRegistration

describe('resolvePushMetadata', () => {
	it('prefers nested data over legacy top-level fields', () => {
		expect(
			resolvePushMetadata({
				data: { url: '/new', notification_id: 'n-new' },
				url: '/legacy',
				notification_id: 'n-legacy',
			}),
		).toEqual({ url: '/new', notificationId: 'n-new' })
	})

	it('falls back to legacy top-level fields when data is absent', () => {
		expect(
			resolvePushMetadata({ url: '/legacy', notification_id: 'n-legacy' }),
		).toEqual({ url: '/legacy', notificationId: 'n-legacy' })
	})

	it('defaults url to / and notificationId to empty when nothing is present', () => {
		expect(resolvePushMetadata({})).toEqual({ url: '/', notificationId: '' })
	})
})

describe('buildCaptureBody / captureUrl', () => {
	it('matches the PostHog capture shape (event, distinct_id, timestamp, $insert_id)', () => {
		expect(buildCaptureBody(SNAPSHOT, OPENED)).toEqual({
			api_key: 'phc_test',
			event: 'notification.opened',
			distinct_id: 'user-123',
			timestamp: '2026-07-01T00:00:00.000Z',
			properties: {
				notification_id: 'notif-1',
				$insert_id: 'uuid-1',
			},
		})
	})

	it('appends /capture/ without doubling the host slash', () => {
		expect(captureUrl('https://eu.i.posthog.com')).toBe(
			'https://eu.i.posthog.com/capture/',
		)
		expect(captureUrl('https://eu.i.posthog.com/')).toBe(
			'https://eu.i.posthog.com/capture/',
		)
	})
})

describe('reportNotificationInteraction', () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		installFakeCaches()
		installFakeIndexedDB()
		fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
		vi.stubGlobal('fetch', fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	})

	it('POSTs the interaction to /capture with the right event, id, timestamp and uuid', async () => {
		await writeIdentitySnapshot(SNAPSHOT)
		await reportNotificationInteraction(OPENED, registration)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('https://eu.i.posthog.com/capture/')
		expect(init.method).toBe('POST')
		expect(init.keepalive).toBe(true)
		const body = JSON.parse(init.body as string)
		expect(body.event).toBe('notification.opened')
		expect(body.distinct_id).toBe('user-123')
		expect(body.timestamp).toBe('2026-07-01T00:00:00.000Z')
		expect(body.properties.notification_id).toBe('notif-1')
		expect(body.properties.$insert_id).toBe('uuid-1')
	})

	it('sends nothing when the snapshot says the user opted out', async () => {
		await writeIdentitySnapshot({ ...SNAPSHOT, optedOut: true })
		await reportNotificationInteraction(OPENED, registration)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('sends nothing when there is no identity snapshot', async () => {
		await reportNotificationInteraction(OPENED, registration)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('sends nothing when the notification carries no notification_id', async () => {
		await writeIdentitySnapshot(SNAPSHOT)
		await reportNotificationInteraction(
			{ ...OPENED, notificationId: '' },
			registration,
		)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('stashes and registers a Background Sync retry on fetch failure, then flushes once reconnected without duplicating', async () => {
		await writeIdentitySnapshot(SNAPSHOT)
		fetchMock.mockRejectedValueOnce(new Error('offline'))

		await reportNotificationInteraction(OPENED, registration)
		// Failed send: no successful POST, stash written, sync registered.
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(
			(
				registration as unknown as {
					sync: { register: ReturnType<typeof vi.fn> }
				}
			).sync.register,
		).toHaveBeenCalledWith('flush-notification-analytics')

		// Reconnected: flush resends exactly once (the stash deduped by uuid).
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
		await flushInteractionStash()
		expect(fetchMock).toHaveBeenCalledTimes(2)

		// A second flush finds an empty stash — no further sends.
		await flushInteractionStash()
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('flush discards the stash without sending when the user has since opted out', async () => {
		await writeIdentitySnapshot(SNAPSHOT)
		fetchMock.mockRejectedValueOnce(new Error('offline'))
		await reportNotificationInteraction(OPENED, registration)
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await writeIdentitySnapshot({ ...SNAPSHOT, optedOut: true })
		await flushInteractionStash()
		// No new send; and a follow-up opt-in flush finds nothing left to send.
		expect(fetchMock).toHaveBeenCalledTimes(1)
		await writeIdentitySnapshot(SNAPSHOT)
		await flushInteractionStash()
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})
