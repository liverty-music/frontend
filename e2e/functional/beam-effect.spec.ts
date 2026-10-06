import { expect, type Page, test } from '../support/test'

/**
 * The beam effect in a real browser: beams follow their concert's scroll
 * position through CSS view timelines, only concerts on screen are lit, and
 * the dashboard toggle lights the concerts already on screen in place.
 */

const APP = 'http://localhost:9000'
const DAYS = 30

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

/** One followed-artist concert per day, all in the HOME lane (matched). */
async function mockRpc(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		if (!route.request().url().includes('ListByArtists')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			})
		}
		const groups = Array.from({ length: DAYS }, (_, i) => ({
			date: localDate(i + 1),
			home: [
				{
					id: { value: `c-${i}` },
					performers: [
						{
							id: { value: '00000000-0000-4000-8000-a00000000001' },
							name: { value: 'YOASOBI' },
							mbid: { value: '' },
						},
					],
					series: { id: { value: `s-${i}` }, title: { value: 'Test Live' } },
					localDate: localDate(i + 1),
					venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
					sourceUrl: { value: 'https://example.com' },
				},
			],
			nearby: [],
			away: [],
		}))
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ groups }),
		})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

async function openDashboard(page: Page, beams: boolean): Promise<void> {
	await page.addInitScript((on) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('liverty:beams:enabled', on ? 'true' : 'false')
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
	}, beams)
	await mockRpc(page)
	await page.goto(`${APP}/dashboard`)
	await page.locator('[data-live-card]').first().waitFor({ timeout: 10000 })
}

/** Per beam: whether it is lit, and whether its card's top is in the scroll area. */
function beamState(page: Page) {
	return page.evaluate(() => {
		const scroll = document.querySelector('.concert-scroll') as HTMLElement
		const edge = scroll.getBoundingClientRect()
		const cards = [
			...document.querySelectorAll<HTMLElement>('[data-live-card]'),
		]
		return [...document.querySelectorAll<HTMLElement>('.laser-beam')].map(
			(beam) => {
				const name = beam.dataset.beamTimeline
				const card = cards.find((c) => c.dataset.beamName === name)
				const top = card?.getBoundingClientRect().top ?? Number.NaN
				return {
					name,
					lit: beam.getBoundingClientRect().height > 1,
					height: beam.getBoundingClientRect().height,
					onScreen: top >= edge.top && top <= edge.bottom,
				}
			},
		)
	})
}

async function supportsBeams(page: Page): Promise<boolean> {
	return page.evaluate(
		() =>
			CSS.supports(
				'(animation-timeline: view()) and (animation-range: entry)',
			) &&
			CSS.supports('view-timeline', 'attr(data-x type(<custom-ident>)) block'),
	)
}

test.describe('beam effect', () => {
	test(`@spec components/infrastructure/fan/web/global/live-highway "Only concerts on screen are lit"`, async ({
		page,
	}) => {
		await openDashboard(page, true)
		test.skip(!(await supportsBeams(page)), 'platform cannot drive the beams')

		await expect
			.poll(async () => (await beamState(page)).some((b) => b.lit))
			.toBe(true)
		const state = await beamState(page)
		expect(state.filter((b) => !b.onScreen).length).toBeGreaterThan(5)
		expect(state.filter((b) => !b.onScreen && b.lit)).toEqual([])
	})

	test(`@spec components/infrastructure/fan/web/global/live-highway "Beams track scroll position without scripting"`, async ({
		page,
	}) => {
		// Count every geometry read on a concert card from here on.
		await page.addInitScript(() => {
			const w = window as unknown as { __cardReads: number }
			w.__cardReads = 0
			const original = Element.prototype.getBoundingClientRect
			Element.prototype.getBoundingClientRect = function (this: Element) {
				if (this.matches('[data-live-card]')) w.__cardReads++
				return original.call(this)
			}
		})
		await openDashboard(page, true)
		test.skip(!(await supportsBeams(page)), 'platform cannot drive the beams')
		await expect
			.poll(async () => (await beamState(page)).some((b) => b.lit))
			.toBe(true)

		const first = (await beamState(page)).find((b) => b.lit)
		const readsBefore = await page.evaluate(
			() => (window as unknown as { __cardReads: number }).__cardReads,
		)
		await page.evaluate(() => {
			const scroll = document.querySelector('.concert-scroll') as HTMLElement
			scroll.scrollTop += 120
		})
		await page.waitForTimeout(200)
		const readsAfter = await page.evaluate(
			() => (window as unknown as { __cardReads: number }).__cardReads,
		)
		const moved = (await beamState(page)).find((b) => b.name === first?.name)

		// The beam followed its concert up the screen: shorter by the scroll.
		expect(moved?.height ?? 0).toBeLessThan((first?.height ?? 0) - 50)
		// And nothing in the page measured a card to make that happen.
		expect(readsAfter).toBe(readsBefore)
	})

	test(`@spec components/infrastructure/fan/web/global/live-highway "Turning beams on reaches the concerts already on screen"`, async ({
		page,
	}) => {
		await openDashboard(page, false)
		await expect(page.locator('.laser-beam')).toHaveCount(0)

		// Tag the built nodes so a rebuild would show up as untagged nodes.
		await page.evaluate(() => {
			for (const el of document.querySelectorAll(
				'.date-group, [data-live-card]',
			)) {
				;(el as HTMLElement & { __built?: boolean }).__built = true
			}
		})

		await page.click('fab-menu .fab-toggle')
		await page.click('fab-menu .fab-item[data-action-id="beam"]')
		await expect(page.locator('.laser-beam').first()).toBeAttached()

		const rebuilt = await page.evaluate(
			() =>
				[...document.querySelectorAll('.date-group, [data-live-card]')].filter(
					(el) => !(el as HTMLElement & { __built?: boolean }).__built,
				).length,
		)
		expect(rebuilt).toBe(0)

		if (!(await supportsBeams(page))) return
		// Lit in place: the beams follow the timelines the existing cards declare.
		await expect
			.poll(async () =>
				(await beamState(page)).some((b) => b.lit && b.onScreen),
			)
			.toBe(true)
		const named = await page.evaluate(() =>
			[
				...document.querySelectorAll<HTMLElement>(
					'[data-live-card][data-matched]',
				),
			]
				.slice(0, 3)
				.map((c) => [c.dataset.beamName, getComputedStyle(c).viewTimelineName]),
		)
		for (const [name, declared] of named) expect(declared).toBe(name)
	})
})
