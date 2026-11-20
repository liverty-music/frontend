import { concertWire } from '../support/concert-wire'
import { expect, type Page, test } from '../support/test'

/**
 * A tap on the Timetable tab swaps the view at once, and on re-entry page
 * identity (the shell page-header title + the active bottom-nav tab) switches
 * in the same frame as the cached timetable. Which title and tab a displayed
 * route shows, and that a failed navigation leaves them unchanged, is checked
 * against the real router in test/app-shell.spec.ts.
 *
 * Runs in the `functional` CI project (no auth — AuthHook gives guests free
 * roam); RPC is mocked so the assertions never need a live backend.
 */

test.use({ viewport: { width: 390, height: 700 } })

async function seedGuest(page: Page): Promise<void> {
	// A guest with a home region + one follow, so the timetable renders without
	// the home selector.
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: {
						id: '00000000-0000-4000-8000-a00000000001',
						name: 'YOASOBI',
						mbid: '00000000-0000-4000-8000-b00000000001',
					},
					home: 'JP-13',
				},
			]),
		)
	})
}

const tab = (page: Page, icon: string) =>
	page.locator(`.nav-tab[data-nav="${icon}"]`)

test.describe('Timetable tab (guest)', () => {
	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Tapping a menu tab swaps the view immediately"
	test('the timetable view replaces Discovery while its data is still in flight', async ({
		page,
	}) => {
		await page.route('**/liverty_music.rpc.**', async (route) => {
			if (route.request().url().includes('ListByArtists')) {
				// Hold the timetable's data back: the view must not wait for it.
				await new Promise((resolve) => setTimeout(resolve, 1500))
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(concertWire({ groups: [] })),
				})
			}
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			})
		})
		await page.route('**/ws.audioscrobbler.com/**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			}),
		)
		await seedGuest(page)
		await page.goto('/discovery')
		await expect(page.locator('discovery-route')).toBeVisible({
			timeout: 10_000,
		})

		await tab(page, 'home').click()
		// The timetable is attached and showing its loading state while the fetch
		// is still held, and Discovery is no longer on screen.
		await expect(
			page.locator('timetable-route [data-testid="timetable-loading"]').first(),
		).toBeVisible()
		await expect(page.locator('discovery-route')).toHaveCount(0)
		// Once the data arrives, the loading state clears.
		await expect(
			page.locator('timetable-route [data-testid="timetable-loading"]').first(),
		).toBeHidden({ timeout: 10_000 })
	})

	// @spec components/infrastructure/fan/web/route/timetable "Header and nav switch before the timetable renders"
	test('re-entry switches identity and shows the cached timetable together, with no skeleton', async ({
		page,
	}) => {
		const day = new Date()
		day.setDate(day.getDate() + 1)
		const localDate = {
			value: {
				year: day.getFullYear(),
				month: day.getMonth() + 1,
				day: day.getDate(),
			},
		}
		await page.route('**/liverty_music.rpc.**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: route.request().url().includes('ListByArtists')
					? JSON.stringify(
							concertWire({
								groups: [
									{
										date: localDate,
										home: [
											{
												id: { value: '00000000-0000-4000-8000-c10000000001' },
												performers: [
													{
														id: {
															value: '00000000-0000-4000-8000-a00000000001',
														},
														name: { value: 'YOASOBI' },
														mbid: { value: '' },
													},
												],
												series: {
													id: { value: '00000000-0000-4000-8000-5e0000000001' },
													title: { value: 'Live' },
												},
												localDate,
												venue: {
													name: { value: 'Zepp' },
													adminArea: { value: 'JP-13' },
												},
												sourceUrl: { value: 'https://example.com' },
											},
										],
										nearby: [],
										away: [],
									},
								],
							}),
						)
					: '{}',
			}),
		)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000001',
							name: 'YOASOBI',
							mbid: '',
						},
						hype: 'home',
					},
				]),
			)
		})

		// First visit fills the cache.
		await page.goto('/timetable')
		await page.locator('[data-live-card]').first().waitFor({ timeout: 10_000 })
		await page.locator('.nav-tab[data-nav="discovery"]').click()
		await expect(page.locator('discovery-route')).toBeVisible({
			timeout: 10_000,
		})

		// From the tap on, record each frame: the active tab, the header title,
		// whether the timetable's cards are there, and whether the skeleton is.
		await page.evaluate(() => {
			const w = window as unknown as { __frames: unknown[] }
			w.__frames = []
			const tick = () => {
				w.__frames.push({
					home:
						document
							.querySelector('.nav-tab[data-nav="home"]')
							?.getAttribute('data-active') === 'true',
					title: document.querySelector('page-header h1')?.textContent?.trim(),
					cards: !!document.querySelector('timetable-route [data-live-card]'),
					skeleton: !!document.querySelector(
						'timetable-route [data-testid="timetable-loading"]',
					),
				})
				if (w.__frames.length < 90) requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		})
		await page.locator('.nav-tab[data-nav="home"]').click()
		await page.locator('timetable-route [data-live-card]').first().waitFor()
		await page.waitForFunction(
			() =>
				(window as unknown as { __frames: unknown[] }).__frames.length >= 90,
		)

		const frames = await page.evaluate(
			() =>
				(
					window as unknown as {
						__frames: {
							home: boolean
							title: string
							cards: boolean
							skeleton: boolean
						}[]
					}
				).__frames,
		)
		// The cached timetable is never preceded by a skeleton on re-entry…
		expect(frames.some((f) => f.skeleton)).toBe(false)
		// …and in the first frame that shows it, page identity has switched too.
		const first = frames.find((f) => f.cards)
		expect(first).toMatchObject({ home: true, title: 'Timetable' })
	})
})
