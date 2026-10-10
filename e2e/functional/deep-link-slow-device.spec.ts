import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, test } from '../support/test'

/**
 * A `/concerts/:id` deep-link on a slow device. Resolving it used to flush
 * Aurelia's task queue synchronously; on a slow CPU that flush — which also ran
 * the filtered timetable's render — exceeded the 100 ms synchronous budget,
 * threw "Potential deadlock", and dropped every queued task, so the sheet never
 * opened and the timetable stayed empty. CPU throttling reproduces the device.
 */

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

const artists = Array.from({ length: 10 }, (_, i) => ({
	id: fakeId(`artist-${i}`),
	name: `ARTIST ${i}`,
	mbid: '',
}))

function concert(id: string, day: number, artist: (typeof artists)[number]) {
	return {
		id: { value: id },
		performers: [
			{
				id: { value: artist.id },
				name: { value: artist.name },
				mbid: { value: '' },
			},
		],
		series: { id: { value: fakeId(`s-${id}`) }, title: { value: 'Live' } },
		localDate: localDate(day),
		venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
		sourceUrl: { value: 'https://example.com' },
	}
}

const groups = Array.from({ length: 212 }, (_, i) => ({
	date: localDate(i + 1),
	home: Array.from({ length: 1 + (i % 3) }, (_, k) =>
		concert(fakeId(`h-${i}-${k}`), i + 1, artists[(i + k) % artists.length]),
	),
	nearby: [],
	away: [],
}))

test.use({ viewport: { width: 375, height: 667 } })

// @spec components/infrastructure/fan/web/route/dashboard "Deferring the render preserves load-path side effects"
test('a concert deep-link opens its sheet on a slow device, and the timetable renders', async ({
	page,
	context,
}) => {
	test.setTimeout(90_000)
	await page.addInitScript((followed) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify(followed.map((artist) => ({ artist, hype: 'home' }))),
		)
	}, artists)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: route.request().url().includes('ListByArtists')
				? JSON.stringify(concertWire({ groups }))
				: '{}',
		}),
	)
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})

	// Load the app once so the dev server's modules are warm, then slow the CPU.
	await page.goto('http://localhost:9000/discovery')
	await page.waitForSelector('discovery-route', { timeout: 20_000 })
	const cdp = await context.newCDPSession(page)
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 10 })

	await page.goto(`http://localhost:9000/concerts/${fakeId('h-150-0')}`)

	// The sheet opens for the linked concert, and its URL is the final entry.
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						!!document.querySelector(
							'event-detail-sheet dialog[open], event-detail-sheet :popover-open',
						),
				),
			{ timeout: 60_000 },
		)
		.toBe(true)
	await expect(page).toHaveURL(new RegExp(`/concerts/${fakeId('h-150-0')}$`))
	// The filtered timetable rendered behind it.
	await expect
		.poll(() => page.locator('concert-highway .date-group').count())
		.toBeGreaterThan(0)
	expect(errors.filter((e) => /deadlock/i.test(e))).toEqual([])
})
