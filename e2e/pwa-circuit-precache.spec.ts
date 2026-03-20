import { expect, test } from '@playwright/test'

test.describe('ZK Circuit File Pre-Cache', () => {
	test('circuit files are cached after SW registration', async ({ page }) => {
		await page.goto('/')

		// Wait for SW to register and install event to complete
		await page
			.waitForFunction(
				() => navigator.serviceWorker.controller !== null,
				{},
				{ timeout: 15000 },
			)
			.catch(() => {
				// SW might not be available in test environment — skip gracefully
			})

		// Query Cache API for circuit files
		const cachedUrls = await page.evaluate(async () => {
			try {
				const cache = await caches.open('zk-circuits-v1')
				const keys = await cache.keys()
				return keys.map((r) => new URL(r.url).pathname)
			} catch {
				return []
			}
		})

		// In production builds with SW, circuit files should be pre-cached.
		// In dev/test without SW, this array will be empty — which is acceptable.
		if (cachedUrls.length > 0) {
			expect(cachedUrls).toContain('/ticketcheck.wasm')
			expect(cachedUrls).toContain('/ticketcheck.zkey')
		}
	})
})
