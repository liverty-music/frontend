import { describe, expect, it, vi } from 'vitest'
import {
	configNetworkFirst,
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

describe('configNetworkFirst', () => {
	it('reads the network online and keeps the copy', async () => {
		const { storage, buckets } = fakeCaches()
		const fetchImpl = vi.fn(async () => new Response('{"v":2}'))
		const res = await configNetworkFirst(new Request(CONFIG), {
			fetchImpl,
			cacheStorage: storage,
		})
		expect(await res.text()).toBe('{"v":2}')
		expect(fetchImpl).toHaveBeenCalledWith(expect.any(Request), {
			cache: 'no-store',
		})
		expect(buckets.get(OFFLINE_CONFIG_CACHE)?.has(CONFIG)).toBe(true)
	})

	it('serves the kept copy only when the network fails', async () => {
		const { storage } = fakeCaches()
		await configNetworkFirst(new Request(CONFIG), {
			fetchImpl: async () => new Response('{"v":1}'),
			cacheStorage: storage,
		})
		const res = await configNetworkFirst(new Request(CONFIG), {
			fetchImpl: async () => {
				throw new TypeError('Failed to fetch')
			},
			cacheStorage: storage,
		})
		expect(await res.text()).toBe('{"v":1}')
	})

	it('does not keep an error response', async () => {
		const { storage, buckets } = fakeCaches()
		const res = await configNetworkFirst(new Request(CONFIG), {
			fetchImpl: async () => new Response('', { status: 503 }),
			cacheStorage: storage,
		})
		expect(res.status).toBe(503)
		expect(buckets.get(OFFLINE_CONFIG_CACHE)?.has(CONFIG)).toBeFalsy()
	})

	it('fails like the network when nothing was kept', async () => {
		const { storage } = fakeCaches()
		await expect(
			configNetworkFirst(new Request(CONFIG), {
				fetchImpl: async () => {
					throw new TypeError('Failed to fetch')
				},
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
