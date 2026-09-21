import { expect, type Page, test } from '../support/test'

/**
 * Workbox precache guard.
 *
 * Runs against the `vite preview` server on :9100 (see `playwright.pwa.config.mjs`),
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

/**
 * Wait until the service worker is activated, controlling this page, AND its
 * precache is populated.
 *
 * Reaching `activated` is NOT sufficient: the install handler resolving and
 * this context observing the resulting Cache API writes are separate events,
 * and asserting on a single snapshot at `activated` made this spec flaky (it
 * read an empty precache roughly half the time). Everything here polls the
 * settled state instead.
 */
async function precacheState(page: Page) {
	return await page.evaluate(async () => {
		if (!('serviceWorker' in navigator)) return null
		const reg = await navigator.serviceWorker.getRegistration()
		if (!reg?.active || !navigator.serviceWorker.controller) return null
		const name = (await caches.keys()).find((k) =>
			k.startsWith('workbox-precache'),
		)
		if (!name) return null
		const cache = await caches.open(name)
		const urls = (await cache.keys()).map((r) => new URL(r.url).pathname)
		const shell = await cache.match('/index.html', { ignoreSearch: true })
		return {
			entries: urls.length,
			jsChunks: urls.filter((u) => u.endsWith('.js')).length,
			shellStatus: shell ? shell.status : null,
			shellBytes: shell ? (await shell.text()).length : 0,
		}
	})
}

/** Poll until the worker controls the page and the precache is written. */
async function settledPrecache(page: Page) {
	await expect
		.poll(async () => (await precacheState(page))?.entries ?? 0, {
			timeout: 30_000,
		})
		.toBeGreaterThan(0)
	const state = await precacheState(page)
	expect(state).not.toBeNull()
	return state as NonNullable<Awaited<ReturnType<typeof precacheState>>>
}

test.describe('Offline Concert Cache', () => {
	test('service worker takes control and precaches the app shell', async ({
		page,
	}) => {
		await page.goto('/')
		const state = await settledPrecache(page)

		// An empty precache would still let the page render online, so assert on
		// its contents rather than on the DOM.
		expect(state.entries).toBeGreaterThan(0)
	})

	test('precache holds the app shell and route chunks', async ({ page }) => {
		await page.goto('/')
		const state = await settledPrecache(page)

		// This is what a workbox / vite-plugin-pwa regression actually breaks: a
		// bad `injectManifest` run yields an empty or shell-less manifest, and
		// the app silently stops working offline.
		//
		// `ignoreSearch` is required inside `precacheState` — workbox keys
		// precached entries with a `?__WB_REVISION__=` query string.
		expect(state.shellStatus).toBe(200)
		expect(state.shellBytes).toBeGreaterThan(0)
		// A shell with no route chunks cannot boot offline.
		expect(state.jsChunks).toBeGreaterThan(5)
	})
})
