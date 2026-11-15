import { concertWire } from '../support/concert-wire'
import { expect, type Page, test } from '../support/test'

/**
 * E2E tests for snack-bar (renamed from snack-bar) using the Popover API.
 *
 * Covers verification task 5.1: multiple snacks appear, animate in,
 * auto-dismiss, no zombies. The dialog stacking, the entry and exit motion and
 * the update snack's one line are stories of `snack-bar`; where the snack sits
 * above the navigation bar, a bottom banner and the Done bar of edit mode is
 * checked in the app shell's stories (src/app-shell.stories.ts).
 */

/** Mock all Connect-RPC routes with minimal responses. */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('FollowService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{
							id: { value: '00000000-0000-4000-8000-a10000000001' },
							name: { value: 'YOASOBI' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000002' },
							name: { value: 'Vaundy' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000003' },
							name: { value: 'Ado' },
							hype: 0,
						},
					],
				}),
			})
		}

		if (url.includes('Unfollow')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		if (url.includes('ConcertService/ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						groups: [
							{
								date: { value: { year: 2026, month: 3, day: 15 } },
								away: [
									{
										id: { value: '00000000-0000-4000-8000-c10000000001' },
										performers: [
											{
												id: { value: '00000000-0000-4000-8000-a10000000001' },
												name: { value: 'Test Artist' },
												mbid: { value: '' },
											},
										],
										series: {
											id: { value: '00000000-0000-4000-8000-5e0000000001' },
											title: { value: 'Test Concert' },
										},
										localDate: {
											value: { year: 2026, month: 3, day: 15 },
										},
									},
								],
							},
						],
					}),
				),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/**
 * Publish a snack via the test bridge exposed by main.ts in DEV mode.
 *
 * main.ts exposes window.__lm_publishSnack when import.meta.env.DEV is true,
 * which calls ea.publish(new Snack(...)) using the real Aurelia EventAggregator.
 * This is the only reliable way to trigger snack-bar from Playwright without
 * accessing Aurelia internals directly.
 */
async function publishSnackDirect(
	page: Page,
	message: string,
	severity: 'info' | 'warning' | 'error' = 'info',
	durationMs = 2500,
): Promise<void> {
	// The DEV bridge is attached only after `au.start()` resolves (main.ts),
	// which can land a tick after the snack-bar element is already in the DOM.
	// Wait for it so the publish below never races the bridge attachment.
	await page.waitForFunction(
		() =>
			typeof (window as unknown as Record<string, unknown>)
				.__lm_publishSnack === 'function',
		undefined,
		{ timeout: 10_000 },
	)
	await page.evaluate(
		({ message, severity, durationMs }) => {
			const bridge = (window as unknown as Record<string, unknown>)
				.__lm_publishSnack as
				| ((m: string, s: string, d: number) => void)
				| undefined
			if (typeof bridge !== 'function') {
				throw new Error(
					'__lm_publishSnack not found — ensure DEV server is running (main.ts exposes bridge in DEV mode)',
				)
			}
			bridge(message, severity, durationMs)
		},
		{ message, severity, durationMs },
	)
}

// =========================================================================
// 5.1: Multiple snacks — appear, animate, auto-dismiss, no zombies
// =========================================================================

test.describe('Snack bar: multiple rapid snacks (5.1)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'YOASOBI',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Vaundy',
						},
						home: null,
					},
					{
						artist: { id: '00000000-0000-4000-8000-a10000000003', name: 'Ado' },
						home: null,
					},
				]),
			)
		})
		await mockRpcRoutes(page)
		await page.goto('/dashboard')
		await expect(page.locator('snack-bar')).toBeAttached({ timeout: 10_000 })
	})

	// The snack-bar host is taken out of the shell grid's flow (app-shell.css:
	// fixed, zero height, overflow hidden); its snacks still show in the top layer.
	// @spec components/infrastructure/fan/web/global/app-shell "Overlay elements remain functional"
	test('3 rapid snacks appear one at a time, then auto-dismiss without zombies', async ({
		page,
	}) => {
		test.setTimeout(30_000)

		for (let i = 1; i <= 3; i++) {
			await publishSnackDirect(page, `Snack ${i}`, 'info', 1000)
		}

		// One at a time, in the order they were published.
		const snacks = page.locator('.snack-item')
		for (let i = 1; i <= 3; i++) {
			await expect(page.locator('.snack-item:popover-open')).toHaveText(
				`Snack ${i}`,
				{ timeout: 3000 },
			)
			await expect(snacks).toHaveCount(1)
		}

		await expect(snacks).toHaveCount(0, { timeout: 5000 })
	})
})
