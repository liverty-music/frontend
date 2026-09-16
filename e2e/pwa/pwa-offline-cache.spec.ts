import { expect, type Page, test } from '../support/test'

/**
 * Workbox precache guard.
 *
 * Runs against the `vite preview` server on :9100 (see `playwright.config.mjs`),
 * NOT the dev server: `vite.config.ts` sets `devOptions.enabled: false`, so no
 * service worker exists in dev and an offline assertion there would pass or
 * fail for reasons unrelated to caching.
 *
 * This is the only pipeline coverage `workbox` / `vite-plugin-pwa` precaching
 * has, so the assertions deliberately check that the service worker is in
 * control and serving — not merely that the page is non-blank. A blank-page
 * check passes even when no service worker was ever registered, which is how
 * the previous version of this spec could never have detected a workbox
 * regression.
 */

/** Wait for the SW to be registered, activated and controlling the page. */
async function waitForServiceWorkerControl(page: Page) {
	await page.waitForFunction(
		async () => {
			if (!('serviceWorker' in navigator)) return false
			const reg = await navigator.serviceWorker.getRegistration()
			return !!reg?.active && !!navigator.serviceWorker.controller
		},
		undefined,
		{ timeout: 30_000 },
	)
}

test.describe('Offline Concert Cache', () => {
	test('service worker takes control and precaches the app shell', async ({
		page,
	}) => {
		await page.goto('/')
		await waitForServiceWorkerControl(page)

		// The precache must be populated — an empty cache would still let the
		// page render online, so assert on its contents rather than on the DOM.
		const precachedCount = await page.evaluate(async () => {
			const names = await caches.keys()
			let total = 0
			for (const name of names) {
				const cache = await caches.open(name)
				total += (await cache.keys()).length
			}
			return total
		})
		expect(precachedCount).toBeGreaterThan(0)
	})

	test('precache holds the app shell and route chunks', async ({ page }) => {
		await page.goto('/')
		await waitForServiceWorkerControl(page)

		// Assert on the precache CONTENTS. This is what a workbox /
		// vite-plugin-pwa regression actually breaks: a bad `injectManifest`
		// run yields an empty or shell-less manifest, and the app silently
		// stops working offline.
		//
		// `ignoreSearch` is required — workbox stores precached entries keyed
		// with a `?__WB_REVISION__=` query string.
		const precache = await page.evaluate(async () => {
			const name = (await caches.keys()).find((k) =>
				k.startsWith('workbox-precache'),
			)
			if (!name) return null
			const cache = await caches.open(name)
			const urls = (await cache.keys()).map((r) => new URL(r.url).pathname)
			const shell = await cache.match('/index.html', { ignoreSearch: true })
			return {
				shellStatus: shell ? shell.status : null,
				shellBytes: shell ? (await shell.text()).length : 0,
				jsChunks: urls.filter((u) => u.endsWith('.js')).length,
			}
		})

		expect(precache).not.toBeNull()
		// The app shell must be precached, and be a real document.
		expect(precache?.shellStatus).toBe(200)
		expect(precache?.shellBytes).toBeGreaterThan(0)
		// Route chunks must be precached too — a shell with no chunks cannot
		// boot offline.
		expect(precache?.jsChunks).toBeGreaterThan(5)
	})
})
