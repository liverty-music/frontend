import { expect, type Page, test } from '../support/test'

/**
 * Verifies that laser beams render for guest users with elevated hype.
 * Tests multiple hype levels: home, nearby, away.
 */

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

async function mockRpc(
	page: Page,
	lane: 'home' | 'nearby' | 'away',
): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		if (url.includes('ListByArtists')) {
			const group: Record<string, unknown[]> = {
				home: [],
				nearby: [],
				away: [],
			}
			group[lane] = [
				{
					id: { value: 'c-1' },
					performers: [
						{
							id: { value: 'artist-1' },
							name: { value: 'YOASOBI' },
							mbid: { value: '' },
						},
					],
					series: {
						id: { value: 's-1' },
						title: { value: 'Test Live' },
					},
					localDate: {
						value: {
							year: tomorrow.getFullYear(),
							month: tomorrow.getMonth() + 1,
							day: tomorrow.getDate(),
						},
					},
					venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
					sourceUrl: { value: 'https://example.com' },
				},
			]
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: {
								value: {
									year: tomorrow.getFullYear(),
									month: tomorrow.getMonth() + 1,
									day: tomorrow.getDate(),
								},
							},
							...group,
						},
					],
				}),
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

async function seedGuest(page: Page, hype: string): Promise<void> {
	await page.addInitScript((h) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('liverty:beams:enabled', 'true')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, hype: h },
			]),
		)
	}, hype)
}

for (const hype of ['home', 'nearby', 'away'] as const) {
	test(`laser beam renders for guest with hype="${hype}"`, async ({ page }) => {
		await seedGuest(page, hype)
		await mockRpc(page, hype)

		await page.goto('http://localhost:9000/dashboard')
		await page.waitForLoadState('networkidle')
		await page.waitForSelector('[data-live-card]', { timeout: 10000 })

		// Nothing to wait for: the beams follow their concert's scroll position
		// through a CSS view timeline, so there is no frame loop to settle.
		const results = await page.evaluate(() => {
			const cards = Array.from(
				document.querySelectorAll('[data-live-card]'),
			).map((c) => ({
				lane: c.getAttribute('data-lane'),
				matched: c.getAttribute('data-matched'),
				beamIndex: c.getAttribute('data-beam-index'),
				viewTimeline: getComputedStyle(c).viewTimelineName,
			}))
			const beams = Array.from(document.querySelectorAll('.laser-beam')).map(
				(b) => ({
					anchor: (b as HTMLElement).dataset.beamAnchor,
					timeline: getComputedStyle(b as HTMLElement).animationTimeline,
				}),
			)
			const host = document.querySelector('concert-highway')
			return {
				cards,
				beams,
				scope: host ? getComputedStyle(host).timelineScope : '',
				supportsScrollDriven: CSS.supports(
					'(animation-timeline: view()) and (animation-range: entry)',
				),
			}
		})

		// Card must be matched
		const matchedCard = results.cards.find((c) => c.matched === 'true')
		expect(matchedCard, 'expected a matched card').toBeTruthy()
		expect(matchedCard?.beamIndex, 'beam-index must be set').not.toBeNull()

		expect(
			results.beams.length,
			'expected at least one laser-beam',
		).toBeGreaterThan(0)

		// The beam is no longer positioned by script writing --beam-h each frame;
		// it follows its anchor concert's view timeline. So the contract to hold is
		// the link: the card names a timeline, the beam binds to that same name, and
		// a common ancestor scopes it — the beam lives in a viewport-fixed overlay
		// and is not the card's descendant, so without the scope it silently does
		// nothing.
		// Where the platform cannot drive a scroll-driven animation the beams are
		// simply absent — decorative degradation, per beam-effect-toggle — so the
		// wiring assertions only apply where it can.
		if (!results.supportsScrollDriven) return

		const beam = results.beams[0]
		const expectedName = `--beam-${beam.anchor}`
		expect(beam.timeline, 'beam must bind its anchor timeline').toBe(
			expectedName,
		)
		expect(results.scope, 'the timeline name must be in scope').toContain(
			expectedName,
		)
		expect(
			results.cards.some((c) => c.viewTimeline === expectedName),
			'the anchor card must declare that timeline',
		).toBe(true)
	})
}
