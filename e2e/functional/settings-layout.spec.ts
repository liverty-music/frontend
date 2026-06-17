import { expect, type Page, test } from '@playwright/test'

/**
 * CI layout-regression guard for the fix-settings-layout change.
 *
 * The original bug: Settings `main` was itself the scroll container but omitted
 * `min-block-size: 0`, so its `1fr` grid track grew to full content height, the
 * route grid overflowed its `100%` box, and the content slid *upward behind* the
 * fixed `page-header` (PREFERENCES title + first rows ended up under the header).
 * The fix re-aligned Settings with the house scroll pattern: `main` is an
 * `overflow: hidden; min-block-size: 0` shell wrapping an inner `.settings-scroll`
 * container that owns the overflow.
 *
 * This test runs in the `functional` CI project (no auth needed — AuthHook gives
 * guests free roam, so `/settings` is reachable unauthenticated). It forces the
 * regression condition with a short viewport (content taller than the viewport ⇒
 * the scroll container engages) and asserts the scroll container's top edge stays
 * at or below the header's bottom edge — i.e. the content never slides behind the
 * pinned header. RPC is mocked so the assertion never depends on a live backend.
 *
 * The authenticated-context screenshot + geometry assertions live in
 * `e2e/visual/settings.auth.visual.spec.ts` (run locally / in the authenticated
 * suite); this spec is the always-on PR gate for the same CSS mechanism.
 */

// A viewport short enough that the settings content overflows it, so the inner
// scroll container is actually engaged (the regression only manifests when the
// content exceeds the available height).
test.use({ viewport: { width: 390, height: 540 } })

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		}),
	)
}

test.describe('Settings layout (guest)', () => {
	test('content does not slide behind the fixed header', async ({ page }) => {
		await mockRpcRoutes(page)

		await page.goto('/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		const header = page.getByTestId('settings-header')
		const scroll = page.getByTestId('settings-scroll')

		await expect(header).toBeVisible()
		await expect(scroll).toBeVisible()

		const headerBox = await header.boundingBox()
		const scrollBox = await scroll.boundingBox()
		expect(headerBox).not.toBeNull()
		expect(scrollBox).not.toBeNull()
		if (!headerBox || !scrollBox) return

		// In the regressed layout the overflowing grid track pushes the scroll
		// container (and its content) up behind the header, so its top edge would
		// sit above the header's bottom. The fix keeps it at or below. A 1px
		// tolerance absorbs sub-pixel rounding.
		expect(scrollBox.y).toBeGreaterThanOrEqual(
			headerBox.y + headerBox.height - 1,
		)
	})
})
