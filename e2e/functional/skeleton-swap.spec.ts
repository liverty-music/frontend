import { expect, type Page, test } from '../support/test'

/**
 * The loading placeholder and the first concerts swap in the same frame. They
 * once didn't: the concerts were inserted as the window was built while the
 * placeholder went a task later, so one frame painted both and the concerts
 * then jumped up by the placeholder's height — CLS ≈ 0.5 on a cold load and on
 * a `/concerts/:id` deep-link. A slowed CPU and a delayed response make that
 * frame reliably reachable.
 */

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

const artists = Array.from({ length: 10 }, (_, i) => ({
	id: `artist-${i}`,
	name: `ARTIST ${i}`,
	mbid: '',
}))

const groups = Array.from({ length: 212 }, (_, i) => ({
	date: localDate(i + 1),
	home: Array.from({ length: 1 + (i % 3) }, (_, k) => {
		const artist = artists[(i + k) % artists.length]
		return {
			id: { value: `h-${i}-${k}` },
			performers: [
				{
					id: { value: artist.id },
					name: { value: artist.name },
					mbid: { value: '' },
				},
			],
			series: { id: { value: `s-${i}-${k}` }, title: { value: 'Live' } },
			localDate: localDate(i + 1),
			venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
			sourceUrl: { value: 'https://example.com' },
		}
	}),
	nearby: [],
	away: [],
}))

test.use({ viewport: { width: 375, height: 667 } })

async function prepare(page: Page): Promise<void> {
	await page.addInitScript((followed) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify(followed.map((artist) => ({ artist, hype: 'home' }))),
		)
		const w = window as unknown as { __cls: number; __both: number }
		w.__cls = 0
		w.__both = 0
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as (PerformanceEntry & {
				value: number
				hadRecentInput: boolean
				sources?: { node?: Node | null }[]
			})[]) {
				// A shift counts when everything it moved is in the timetable. Other
				// surfaces (the guest sign-up banner settles on its own) are not this
				// check's subject, even when one entry reports both.
				const sources = e.sources ?? []
				const inTimetable =
					sources.length > 0 &&
					sources.every((s) =>
						(s.node instanceof Element
							? s.node
							: s.node?.parentElement
						)?.closest('concert-highway'),
					)
				if (!e.hadRecentInput && inTimetable) w.__cls += e.value
			}
		}).observe({ type: 'layout-shift', buffered: true })
		// Every frame: is the placeholder on screen together with real groups?
		const tick = () => {
			const placeholder = document.querySelector(
				'[data-testid="dashboard-loading"]',
			)
			const real = document.querySelector(
				'concert-highway .date-group:not(.date-group-skeleton)',
			)
			if (placeholder && real) w.__both++
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	}, artists)
	await page.route('**/liverty_music.rpc.**', async (route) => {
		if (route.request().url().includes('ListByArtists')) {
			await new Promise((r) => setTimeout(r, 1500))
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ groups }),
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

for (const path of ['/dashboard', '/concerts/h-150-0']) {
	// @spec components/infrastructure/fan/web/route/dashboard "Viewport-scoping off-screen content does not regress sticky headers or shift layout"
	test(`the placeholder and the concerts swap in one frame (${path})`, async ({
		page,
		context,
	}) => {
		test.setTimeout(90_000)
		await prepare(page)
		// Warm the dev server's modules, then slow the CPU for the load under test.
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('discovery-route', { timeout: 20_000 })
		const cdp = await context.newCDPSession(page)
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

		await page.goto(`http://localhost:9000${path}`)
		await expect
			.poll(
				() =>
					page
						.locator('concert-highway .date-group:not(.date-group-skeleton)')
						.count(),
				{
					timeout: 60_000,
				},
			)
			.toBeGreaterThan(0)
		await page.waitForTimeout(1000)

		const result = await page.evaluate(() => {
			const w = window as unknown as { __cls: number; __both: number }
			return { both: w.__both, cls: w.__cls }
		})
		// No frame painted both, so nothing jumped. What remains is sub-pixel
		// rounding (≈ 0.000002) that DevTools reports as 0.00; the defect this
		// guards against scored 0.49.
		expect(result.both).toBe(0)
		expect(result.cls).toBeLessThan(0.001)
	})
}
