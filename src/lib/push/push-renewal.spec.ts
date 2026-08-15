import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	handlePushSubscriptionChange,
	PUSH_SUBSCRIPTION_CHANGED_MESSAGE,
	readVapidPublicKeyCacheFirst,
	renewPushSubscription,
} from './push-renewal'

const VAPID = 'BNg-test-key'

function jsonResponse(body: unknown, ok = true): Response {
	return {
		ok,
		clone() {
			return this
		},
		json: async () => body,
	} as unknown as Response
}

function fakeCacheStorage(seed?: Response) {
	const store = new Map<string, Response>()
	if (seed) store.set('/config.json', seed)
	const cache = {
		match: vi.fn(async (k: string) => store.get(k)),
		put: vi.fn(async (k: string, v: Response) => {
			store.set(k, v)
		}),
	}
	return {
		open: vi.fn(async () => cache),
		_cache: cache,
	} as unknown as CacheStorage & { _cache: typeof cache }
}

function fakeClients(
	clients: Array<{ postMessage: ReturnType<typeof vi.fn> }>,
) {
	return {
		matchAll: vi.fn(async () => clients),
	}
}

describe('readVapidPublicKeyCacheFirst', () => {
	it('returns the cached key without hitting the network', async () => {
		const cacheStorage = fakeCacheStorage(
			jsonResponse({ vapidPublicKey: VAPID }),
		)
		const fetchImpl = vi.fn()

		const key = await readVapidPublicKeyCacheFirst({ cacheStorage, fetchImpl })

		expect(key).toBe(VAPID)
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('fetches and caches on a cache miss', async () => {
		const cacheStorage = fakeCacheStorage()
		const fetchImpl = vi.fn(async () => jsonResponse({ vapidPublicKey: VAPID }))

		const key = await readVapidPublicKeyCacheFirst({ cacheStorage, fetchImpl })

		expect(key).toBe(VAPID)
		expect(fetchImpl).toHaveBeenCalledWith('/config.json', {
			cache: 'no-store',
		})
		expect(cacheStorage._cache.put).toHaveBeenCalled()
	})

	it('returns null when the fetch fails (never throws)', async () => {
		const cacheStorage = fakeCacheStorage()
		const fetchImpl = vi.fn(async () => {
			throw new Error('offline')
		})

		await expect(
			readVapidPublicKeyCacheFirst({ cacheStorage, fetchImpl }),
		).resolves.toBeNull()
	})

	it('returns null when the config has no vapidPublicKey', async () => {
		const cacheStorage = fakeCacheStorage(jsonResponse({}))
		const key = await readVapidPublicKeyCacheFirst({
			cacheStorage,
			fetchImpl: vi.fn(),
		})
		expect(key).toBeNull()
	})
})

describe('renewPushSubscription', () => {
	let subscribe: ReturnType<typeof vi.fn>
	let getSubscription: ReturnType<typeof vi.fn>

	beforeEach(() => {
		subscribe = vi.fn(async () => ({ endpoint: 'https://push/new' }))
		getSubscription = vi.fn(async () => null)
	})

	function registration(): ServiceWorkerRegistration {
		return {
			pushManager: { getSubscription, subscribe },
		} as unknown as ServiceWorkerRegistration
	}

	it('subscribes with the VAPID key and notifies open clients on renewal', async () => {
		const client = { postMessage: vi.fn() }
		const clients = fakeClients([client])

		const result = await renewPushSubscription({
			registration: registration(),
			vapidKey: VAPID,
			clients,
		})

		expect(result).toBe('renewed')
		expect(subscribe).toHaveBeenCalledWith({
			userVisibleOnly: true,
			applicationServerKey: VAPID,
		})
		expect(client.postMessage).toHaveBeenCalledWith({
			type: PUSH_SUBSCRIPTION_CHANGED_MESSAGE,
		})
	})

	it('reuses an already-present subscription without re-subscribing', async () => {
		getSubscription = vi.fn(async () => ({ endpoint: 'https://push/existing' }))
		const clients = fakeClients([])

		const result = await renewPushSubscription({
			registration: registration(),
			vapidKey: VAPID,
			clients,
		})

		expect(result).toBe('renewed')
		expect(subscribe).not.toHaveBeenCalled()
	})

	it('is non-fatal when a new subscription cannot be obtained', async () => {
		subscribe = vi.fn(async () => {
			throw new DOMException('permission revoked', 'NotAllowedError')
		})
		const clients = fakeClients([])

		// Must resolve (not reject) so the event never crashes.
		await expect(
			renewPushSubscription({
				registration: registration(),
				vapidKey: VAPID,
				clients,
			}),
		).resolves.toBe('failed')
	})
})

describe('handlePushSubscriptionChange', () => {
	it('skips renewal when no VAPID key is available', async () => {
		const subscribe = vi.fn()
		const result = await handlePushSubscriptionChange({
			registration: {
				pushManager: { getSubscription: vi.fn(async () => null), subscribe },
			} as unknown as ServiceWorkerRegistration,
			clients: fakeClients([]),
			cacheStorage: fakeCacheStorage(jsonResponse({})),
			fetchImpl: vi.fn(),
		})

		expect(result).toBe('skipped')
		expect(subscribe).not.toHaveBeenCalled()
	})

	it('renews when the VAPID key resolves', async () => {
		const client = { postMessage: vi.fn() }
		const result = await handlePushSubscriptionChange({
			registration: {
				pushManager: {
					getSubscription: vi.fn(async () => null),
					subscribe: vi.fn(async () => ({ endpoint: 'https://push/new' })),
				},
			} as unknown as ServiceWorkerRegistration,
			clients: fakeClients([client]),
			cacheStorage: fakeCacheStorage(jsonResponse({ vapidPublicKey: VAPID })),
			fetchImpl: vi.fn(),
		})

		expect(result).toBe('renewed')
		expect(client.postMessage).toHaveBeenCalled()
	})
})
