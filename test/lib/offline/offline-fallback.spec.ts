import { describe, expect, it, vi } from 'vitest'
import {
	configStaleWhileRevalidate,
	navigateOrShell,
	OFFLINE_CONFIG_CACHE,
} from '../../../src/lib/offline/offline-fallback'

/** Minimal Cache Storage keyed by URL. */
function fakeCaches() {
	const buckets = new Map<string, Map<string, Response>>()
	const storage = {
		open: vi.fn(async (name: string) => {
			let bucket = buckets.get(name)
			if (!bucket) {
				bucket = new Map()
				buckets.set(name, bucket)
			}
			const b = bucket
			return {
				put: async (url: string, res: Response) => {
					b.set(url, res)
				},
				match: async (url: string) => b.get(url)?.clone(),
			}
		}),
	}
	return { storage: storage as unknown as CacheStorage, buckets }
}

const CONFIG = 'https://liverty-music.app/config.json'

describe('configStaleWhileRevalidate', () => {
	const ok = (body: string) => async () => new Response(body)
	const offline = async () => {
		throw new TypeError('Failed to fetch')
	}

	it('reads the network on the first start and keeps the copy', async () => {
		const { storage, buckets } = fakeCaches()
		const fetchImpl = vi.fn(ok('{"v":1}'))
		const waitUntil = vi.fn()
		const res = await configStaleWhileRevalidate(
			new Request(CONFIG),
			waitUntil,
			{ fetchImpl, cacheStorage: storage },
		)
		expect(await res.text()).toBe('{"v":1}')
		expect(fetchImpl).toHaveBeenCalledWith(expect.any(Request), {
			cache: 'no-store',
		})
		expect(waitUntil).not.toHaveBeenCalled()
		expect(buckets.get(OFFLINE_CONFIG_CACHE)?.has(CONFIG)).toBe(true)
	})

	it('serves the kept copy at once and keeps the refreshed copy for the next start', async () => {
		const { storage } = fakeCaches()
		await configStaleWhileRevalidate(new Request(CONFIG), vi.fn(), {
			fetchImpl: ok('{"v":1}'),
			cacheStorage: storage,
		})
		const work: Promise<unknown>[] = []
		const res = await configStaleWhileRevalidate(
			new Request(CONFIG),
			(p) => work.push(p),
			{ fetchImpl: ok('{"v":2}'), cacheStorage: storage },
		)
		expect(await res.text()).toBe('{"v":1}')
		expect(work).toHaveLength(1)
		await Promise.all(work)
		const next = await configStaleWhileRevalidate(
			new Request(CONFIG),
			vi.fn(),
			{ fetchImpl: offline, cacheStorage: storage },
		)
		expect(await next.text()).toBe('{"v":2}')
	})

	it('keeps the old copy when the refresh fails', async () => {
		const { storage } = fakeCaches()
		await configStaleWhileRevalidate(new Request(CONFIG), vi.fn(), {
			fetchImpl: ok('{"v":1}'),
			cacheStorage: storage,
		})
		const work: Promise<unknown>[] = []
		const res = await configStaleWhileRevalidate(
			new Request(CONFIG),
			(p) => work.push(p),
			{
				fetchImpl: async () => new Response('', { status: 503 }),
				cacheStorage: storage,
			},
		)
		await Promise.all(work)
		expect(await res.text()).toBe('{"v":1}')
		const next = await configStaleWhileRevalidate(
			new Request(CONFIG),
			vi.fn(),
			{ fetchImpl: offline, cacheStorage: storage },
		)
		expect(await next.text()).toBe('{"v":1}')
	})

	it('does not keep an error response', async () => {
		const { storage, buckets } = fakeCaches()
		const res = await configStaleWhileRevalidate(new Request(CONFIG), vi.fn(), {
			fetchImpl: async () => new Response('', { status: 503 }),
			cacheStorage: storage,
		})
		expect(res.status).toBe(503)
		expect(buckets.get(OFFLINE_CONFIG_CACHE)?.has(CONFIG)).toBeFalsy()
	})

	it('fails like the network when nothing was kept', async () => {
		const { storage } = fakeCaches()
		await expect(
			configStaleWhileRevalidate(new Request(CONFIG), vi.fn(), {
				fetchImpl: offline,
				cacheStorage: storage,
			}),
		).rejects.toThrow('Failed to fetch')
	})
})

describe('navigateOrShell', () => {
	const req = () => new Request('https://liverty-music.app/tickets')

	it('uses the network online', async () => {
		const shell = vi.fn()
		const res = await navigateOrShell(req(), shell, {
			fetchImpl: async () => new Response('server'),
		})
		expect(await res.text()).toBe('server')
		expect(shell).not.toHaveBeenCalled()
	})

	it('serves the app shell offline', async () => {
		const res = await navigateOrShell(
			req(),
			async () => new Response('shell'),
			{
				fetchImpl: async () => {
					throw new TypeError('Failed to fetch')
				},
			},
		)
		expect(await res.text()).toBe('shell')
	})

	it('fails like the network without a shell', async () => {
		await expect(
			navigateOrShell(req(), async () => undefined, {
				fetchImpl: async () => {
					throw new TypeError('Failed to fetch')
				},
			}),
		).rejects.toThrow('Failed to fetch')
	})
})
