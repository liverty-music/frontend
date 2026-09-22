import { expect, test } from '../support/test'

/**
 * Web app manifest guard — the `vite-plugin-pwa` half that `workbox` does not
 * cover.
 *
 * `pwa-offline-cache.spec.ts` covers precaching. Everything else
 * `vite-plugin-pwa` produces is this file: the manifest it generates from
 * `vite.config.ts`, the `<link rel="manifest">` it injects, and the icons it
 * expects to be served. That output is what decides whether the browser
 * considers the app installable at all, and until this spec existed it had no
 * pipeline coverage — which is why `vite-plugin-pwa` is excluded from
 * automerge (change task 10.4c).
 *
 * WHY THIS AND NOT `pwa-install-prompt.spec.ts`: the install PROMPT cannot be
 * driven here, because the banner sits behind `auth.isAuthenticated` in
 * `app-shell.html` and CI cannot produce a `storageState`. But the prompt is
 * OUR code, and `src/services/pwa-install-service.spec.ts` unit-tests it. What
 * a dependency upgrade changes is the generated manifest, and that is exactly
 * what is asserted here. See docs/ci-coverage-gaps.md.
 *
 * The criteria below are Chromium's installability requirements. Each is a
 * separate assertion on purpose: "the manifest is wrong" is not an actionable
 * failure, "no icon is 512x512 or larger" is.
 */

interface ManifestIcon {
	src: string
	sizes?: string
	type?: string
	purpose?: string
}

interface WebAppManifest {
	name?: string
	short_name?: string
	start_url?: string
	display?: string
	icons?: ManifestIcon[]
	theme_color?: string
	background_color?: string
}

const largestSide = (icon: ManifestIcon): number =>
	Math.max(
		0,
		...(icon.sizes ?? '')
			.split(/\s+/)
			.flatMap((s) => s.split('x').map((n) => Number.parseInt(n, 10)))
			.filter((n) => Number.isFinite(n)),
	)

test.describe('PWA manifest', () => {
	test('the document links a manifest that parses', async ({ page }) => {
		await page.goto('/')

		const href = await page
			.locator('link[rel="manifest"]')
			.first()
			.getAttribute('href')
		expect(
			href,
			'vite-plugin-pwa must inject <link rel="manifest">',
		).toBeTruthy()

		const res = await page.request.get(new URL(href as string, page.url()).href)
		expect(res.status()).toBe(200)
		expect(() => res.json()).not.toThrow()
	})

	test('the manifest satisfies the installability criteria', async ({
		page,
	}) => {
		await page.goto('/')
		const href = (await page
			.locator('link[rel="manifest"]')
			.first()
			.getAttribute('href')) as string
		const manifest = (await (
			await page.request.get(new URL(href, page.url()).href)
		).json()) as WebAppManifest

		// A browser falls back to `name` when `short_name` is absent, so only one
		// is strictly required — but both are asserted because dropping
		// `short_name` silently changes the home-screen label.
		expect(manifest.name, 'manifest.name').toBeTruthy()
		expect(manifest.short_name, 'manifest.short_name').toBeTruthy()

		expect(manifest.start_url, 'manifest.start_url').toBeTruthy()
		expect(
			['standalone', 'fullscreen', 'minimal-ui'],
			'manifest.display must be an app-like display mode; "browser" is not installable',
		).toContain(manifest.display)

		const icons = manifest.icons ?? []
		expect(icons.length, 'manifest.icons').toBeGreaterThan(0)

		// 192 and 512 are the two Chromium requires. A maskable icon is not
		// required for installability but IS what keeps the Android launcher from
		// cropping the icon into a white square, so its loss is worth failing on.
		expect(
			icons.some((i) => largestSide(i) >= 192),
			'an icon of at least 192x192',
		).toBe(true)
		expect(
			icons.some((i) => largestSide(i) >= 512),
			'an icon of at least 512x512',
		).toBe(true)
		expect(
			icons.some((i) => (i.purpose ?? '').split(/\s+/).includes('maskable')),
			'a maskable icon',
		).toBe(true)
	})

	test('every icon the manifest declares is actually served', async ({
		page,
	}) => {
		// A manifest may list an icon the build does not emit. The browser then
		// fails installability with no error anywhere in the page, so this is
		// checked against the server rather than against the manifest alone.
		await page.goto('/')
		const href = (await page
			.locator('link[rel="manifest"]')
			.first()
			.getAttribute('href')) as string
		const manifest = (await (
			await page.request.get(new URL(href, page.url()).href)
		).json()) as WebAppManifest

		for (const icon of manifest.icons ?? []) {
			const url = new URL(icon.src, page.url()).href
			const res = await page.request.get(url)
			expect(res.status(), `icon ${icon.src}`).toBe(200)
			expect(
				res.headers()['content-type'],
				`icon ${icon.src} content-type`,
			).toContain('image')
		}
	})

	test('start_url is served and inside the service worker scope', async ({
		page,
	}) => {
		// `start_url` outside the service worker's scope is installable but opens
		// uncontrolled — the launched app would not use the precache at all.
		await page.goto('/')
		const href = (await page
			.locator('link[rel="manifest"]')
			.first()
			.getAttribute('href')) as string
		const manifest = (await (
			await page.request.get(new URL(href, page.url()).href)
		).json()) as WebAppManifest

		const startUrl = new URL(manifest.start_url as string, page.url())
		expect(startUrl.origin).toBe(new URL(page.url()).origin)
		expect((await page.request.get(startUrl.href)).status()).toBe(200)

		const scope = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.getRegistration()
			return reg?.scope ?? null
		})
		expect(scope, 'a registered service worker').toBeTruthy()
		expect(startUrl.href.startsWith(scope as string)).toBe(true)
	})
})
