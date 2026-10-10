import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

/**
 * The timetable's date window in a real browser, on a timetable the size of the
 * reference account (225 dates): only a window is built, it grows ahead of the
 * fan in both directions without moving what they are looking at, and a
 * re-entry paints the remembered date first, with no skeleton in between.
 */

const APP = 'http://localhost:9000'
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
		localStorage.setItem('onboardingStep', 'completed')
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
	await page.goto(`${APP}/dashboard`)
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
			s.scrollTop += s.clientHeight
		})
		await settle(page)
	}
}

/** Every built group's lanes line up with the stage header's columns. */
function misalignedLanes(page: Page, lanes: number) {
	return page.evaluate((expected) => {
		const host = [...document.querySelectorAll('concert-highway')].find(
			(h) => (h as HTMLElement).offsetParent !== null,
		) as HTMLElement
		const heads = [
			...host.querySelectorAll<HTMLElement>('.stage-header > span'),
		]
		const bad: string[] = []
		if (heads.length !== expected) bad.push(`header has ${heads.length} stages`)
		for (const g of host.querySelectorAll<HTMLElement>(
			'.date-group[data-date-key]',
		)) {
			const cols = [...g.querySelectorAll<HTMLElement>('.lane')]
			if (cols.length !== expected)
				bad.push(`${g.dataset.dateKey}: ${cols.length} lanes`)
			cols.forEach((lane, i) => {
				const a = lane.getBoundingClientRect()
				const b = heads[i]?.getBoundingClientRect()
				if (
					!b ||
					Math.abs(a.left - b.left) > 0.5 ||
					Math.abs(a.width - b.width) > 0.5
				) {
					bad.push(`${g.dataset.dateKey} lane ${i}`)
				}
			})
		}
		return bad
	}, lanes)
}

test.describe('timetable date window', () => {
	test(`@spec components/infrastructure/fan/web/route/dashboard "Only the window is built"`, async ({
		page,
	}) => {
		await openDashboard(page)
		const keys = await builtKeys(page)
		expect(keys.length).toBeGreaterThan(0)
		expect(keys.length).toBeLessThanOrEqual(24)
	})

	test(`@spec components/infrastructure/fan/web/route/dashboard "Scrolling down reaches every later date"`, async ({
		page,
	}) => {
		await openDashboard(page)
		const last = localDate(DAYS).value
		const lastKey = `${last.year}-${String(last.month).padStart(2, '0')}-${String(last.day).padStart(2, '0')}`

		// Later dates arrive before the end of the built content is reached:
		// stop half a screen short of it and the window has already grown.
		const before = (await builtKeys(page)).length
		await page.evaluate(() => {
			const s = document.querySelector(
				'concert-highway .concert-scroll',
			) as HTMLElement
			s.scrollTop = s.scrollHeight - s.clientHeight * 1.4
		})
		await settle(page)
		expect((await builtKeys(page)).length).toBeGreaterThan(before)

		for (
			let i = 0;
			i < 400 && !(await builtKeys(page)).includes(lastKey);
			i++
		) {
			await scrollDown(page, 1)
		}
		expect(await builtKeys(page)).toContain(lastKey)
	})

	test(`@spec components/infrastructure/fan/web/route/dashboard "Viewport-scoping off-screen content does not regress sticky headers or shift layout"`, async ({
		page,
	}) => {
		// Every layout shift the timetable causes, the way CLS counts them. Shifts
		// of other surfaces (the guest sign-up banner settles on its own) are not
		// this scenario's subject.
		await page.addInitScript(() => {
			const w = window as unknown as { __cls: number }
			w.__cls = 0
			new PerformanceObserver((list) => {
				for (const e of list.getEntries() as (PerformanceEntry & {
					value: number
					hadRecentInput: boolean
				})[]) {
					const inTimetable = (
						(e as unknown as { sources?: { node?: Node | null }[] }).sources ??
						[]
					).some((src) => src.node?.parentElement?.closest('concert-highway'))
					if (!e.hadRecentInput && inTimetable) w.__cls += e.value
				}
			}).observe({ type: 'layout-shift', buffered: true })
		})
		await openDashboard(page)
		const before = (await builtKeys(page)).length
		const clsBefore = await page.evaluate(
			() => (window as unknown as { __cls: number }).__cls,
		)

		// Scroll across enough dates that several are added to the window.
		await scrollDown(page, 20)
		expect((await builtKeys(page)).length).toBeGreaterThan(before)

		const clsAfter = await page.evaluate(
			() => (window as unknown as { __cls: number }).__cls,
		)
		expect(clsAfter - clsBefore).toBe(0)

		// One sticky behavior for every date separator, including added ones:
		// each hands off at its group boundary (sticky within its own group).
		const separators = await page.evaluate(() =>
			[
				...document.querySelectorAll<HTMLElement>(
					'concert-highway .date-separator',
				),
			].map((el) => ({
				position: getComputedStyle(el).position,
				inGroup: el.parentElement?.classList.contains('date-group') ?? false,
			})),
		)
		expect(separators.length).toBeGreaterThan(before)
		for (const sep of separators) {
			expect(sep).toEqual({ position: 'sticky', inGroup: true })
		}
	})

	test(`@spec components/infrastructure/fan/web/route/dashboard "Lanes stay aligned in every built group"`, async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollDown(page, 12)
		// Three lanes, including groups added while scrolling.
		expect(await misalignedLanes(page, 3)).toEqual([])

		// The collapsed two-lane (All Nearby) presentation, same guarantee.
		await page.click('fab-menu .fab-toggle')
		await page.click('fab-menu .fab-item[data-action-id="mode-swap"]')
		await expect(
			page
				.locator('concert-highway [data-hide-away="true"] [data-live-card]')
				.first(),
		).toBeVisible({
			timeout: 10000,
		})
		await settle(page)
		await page.evaluate(() => {
			const host = document.querySelector(
				'concert-highway:has([data-hide-away="true"])',
			) as HTMLElement
			const s = host.querySelector('.concert-scroll') as HTMLElement
			for (let i = 0; i < 12; i++) s.scrollTop += s.clientHeight
		})
		await settle(page)
		expect(await misalignedLanes(page, 2)).toEqual([])
	})

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
		await page.waitForSelector('discovery-route', { timeout: 10000 })

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

	test(`@spec components/infrastructure/fan/web/route/dashboard "Scrolling up from a restored date reaches earlier dates without a jump"`, async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollDown(page, 40)
		await page.locator('.nav-tab[data-nav="discovery"]').click()
		await page.waitForSelector('discovery-route', { timeout: 10000 })
		await page.locator('.nav-tab[data-nav="home"]').click()
		await page.locator('dashboard-route [data-live-card]').first().waitFor()
		await settle(page)

		// Scroll up a little at a time. On every step — including the steps on
		// which earlier dates are added above — the date at the top edge must
		// move by exactly what was scrolled, give or take a pixel.
		const steps = await page.evaluate(async () => {
			const frame = () =>
				new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				)
			const s = document.querySelector(
				'dashboard-route concert-highway .concert-scroll',
			) as HTMLElement
			const groups = () => [...s.querySelectorAll<HTMLElement>('.date-group')]
			const out: { grew: boolean; drift: number }[] = []
			for (let i = 0; i < 300 && s.scrollTop > 0; i++) {
				const edge = s.getBoundingClientRect().top
				const top = groups().find(
					(g) => g.getBoundingClientRect().bottom > edge,
				)
				if (!top) break
				const key = top.dataset.dateKey
				const before = top.getBoundingClientRect().top
				const firstBefore = groups()[0].dataset.dateKey
				const scrollBefore = s.scrollTop
				s.scrollTop -= 150
				const scrolled = scrollBefore - s.scrollTop
				await frame()
				const same = groups().find((g) => g.dataset.dateKey === key)
				out.push({
					grew: groups()[0].dataset.dateKey !== firstBefore,
					drift: Math.round(
						(same?.getBoundingClientRect().top ?? Number.NaN) -
							before -
							scrolled,
					),
				})
			}
			return out
		})
		// Earlier dates were added on the way up, more than once.
		expect(steps.filter((st) => st.grew).length).toBeGreaterThan(1)
		for (const st of steps) expect(Math.abs(st.drift)).toBeLessThan(2)
		// And it got all the way up: the first loaded date is built.
		const firstDay = localDate(1).value
		expect(await builtKeys(page)).toContain(
			`${firstDay.year}-${String(firstDay.month).padStart(2, '0')}-${String(firstDay.day).padStart(2, '0')}`,
		)
	})
})
