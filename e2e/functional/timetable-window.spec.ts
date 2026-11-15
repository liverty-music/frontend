import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

/**
 * The timetable's date window across a route change, on a timetable the size of
 * the reference account (225 dates): a re-entry paints the remembered date
 * first, with no skeleton in between. The window's growth, the lanes and the
 * scroll up from a restored date are `concert-highway` stories.
 */

const DAYS = 225

test.use({ viewport: { width: 390, height: 800 } })

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

function concert(id: string, day: number, artist: string, area: string) {
	return {
		id: { value: id },
		performers: [
			{
				id: { value: artist },
				name: { value: artist.toUpperCase() },
				mbid: { value: '' },
			},
		],
		series: { id: { value: fakeId(`s-${id}`) }, title: { value: 'Live' } },
		localDate: localDate(day),
		venue: { name: { value: 'Zepp' }, adminArea: { value: area } },
		sourceUrl: { value: 'https://example.com' },
	}
}

/** 225 dates with an uneven number of concerts per lane, so group heights vary. */
function groups() {
	return Array.from({ length: DAYS }, (_, i) => {
		const day = i + 1
		return {
			date: localDate(day),
			home: Array.from({ length: 1 + (i % 3) }, (_, k) =>
				concert(
					fakeId(`h-${i}-${k}`),
					day,
					'00000000-0000-4000-8000-a00000000001',
					'JP-13',
				),
			),
			nearby:
				i % 2 === 0
					? [
							concert(
								fakeId(`n-${i}`),
								day,
								'00000000-0000-4000-8000-a00000000001',
								'JP-14',
							),
						]
					: [],
			away:
				i % 4 === 0
					? [
							concert(
								fakeId(`a-${i}`),
								day,
								'00000000-0000-4000-8000-a00000000001',
								'JP-27',
							),
						]
					: [],
		}
	})
}

async function mockRpc(page: Page): Promise<void> {
	const body = JSON.stringify(concertWire({ groups: groups() }))
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		if (url.includes('ListByArtists') || url.includes('ListByLocation')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body,
			})
		}
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: '{}',
		})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

async function openDashboard(page: Page): Promise<void> {
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
						name: 'ARTIST-1',
						mbid: '',
					},
					hype: 'home',
				},
			]),
		)
	})
	await mockRpc(page)
	await page.goto(`/dashboard`)
	await page.locator('[data-live-card]').first().waitFor({ timeout: 10000 })
	await settle(page)
}

/** Let observers report and the browser lay out. */
async function settle(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((r) => {
				let n = 0
				const tick = () => (++n >= 4 ? r() : requestAnimationFrame(tick))
				requestAnimationFrame(tick)
			}),
	)
}

function builtKeys(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[
			...document.querySelectorAll<HTMLElement>(
				'concert-highway .date-group[data-date-key]',
			),
		].map((g) => g.dataset.dateKey ?? ''),
	)
}

/** The date group at the top edge of the scroll area, and where it sits. */
function topDate(page: Page) {
	return page.evaluate(() => {
		const scroll = document.querySelector(
			'concert-highway .concert-scroll',
		) as HTMLElement
		const edge = scroll.getBoundingClientRect().top
		for (const g of scroll.querySelectorAll<HTMLElement>('[data-date-key]')) {
			const box = g.getBoundingClientRect()
			if (box.bottom > edge + 0.5)
				return { key: g.dataset.dateKey ?? '', top: box.top }
		}
		return null
	})
}

/** Scroll the timetable toward its end, a screen at a time, `screens` times. */
async function scrollDown(page: Page, screens: number): Promise<void> {
	for (let i = 0; i < screens; i++) {
		await page.evaluate(() => {
			const s = document.querySelector(
				'concert-highway .concert-scroll',
			) as HTMLElement
			s.scrollBy({ top: s.clientHeight, behavior: 'instant' })
		})
		await settle(page)
	}
}

test.describe('timetable date window', () => {
	test(`@spec components/infrastructure/fan/web/route/dashboard "Re-entry restores the same date, at any depth"`, async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollDown(page, 40)
		const left = await topDate(page)
		expect(left).not.toBeNull()
		// Deep: well past the first window.
		expect((await builtKeys(page)).indexOf(left?.key ?? '')).toBeGreaterThan(30)

		await page.locator('.nav-tab[data-nav="discovery"]').click()
		await expect(page.locator('discovery-route')).toBeVisible({
			timeout: 10000,
		})

		// Record every frame from the tap on: whether the skeleton or cards are
		// there, and which date is at the top edge.
		await page.evaluate(() => {
			const w = window as unknown as {
				__frames: { skeleton: boolean; top: string | null }[]
			}
			w.__frames = []
			const tick = () => {
				const scroll = document.querySelector(
					'dashboard-route concert-highway .concert-scroll',
				)
				let top: string | null = null
				if (scroll) {
					const edge = scroll.getBoundingClientRect().top
					for (const g of scroll.querySelectorAll<HTMLElement>(
						'[data-date-key]',
					)) {
						if (g.getBoundingClientRect().bottom > edge + 0.5) {
							top = g.dataset.dateKey ?? null
							break
						}
					}
				}
				w.__frames.push({
					skeleton: !!document.querySelector(
						'dashboard-route [data-testid="dashboard-loading"]',
					),
					top,
				})
				if (w.__frames.length < 120) requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		})
		await page.locator('.nav-tab[data-nav="home"]').click()
		await page.locator('dashboard-route [data-live-card]').first().waitFor()
		await settle(page)

		const frames = await page.evaluate(
			() =>
				(
					window as unknown as {
						__frames: { skeleton: boolean; top: string | null }[]
					}
				).__frames,
		)
		const firstWithContent = frames.find((f) => f.top !== null)
		// The first frame that shows the timetable already shows that date…
		expect(firstWithContent?.top).toBe(left?.key)
		// …and no frame showed the skeleton in between.
		expect(frames.some((f) => f.skeleton)).toBe(false)
		// Re-entry builds a window too, not the whole list.
		expect((await builtKeys(page)).length).toBeLessThanOrEqual(24)
	})
})
