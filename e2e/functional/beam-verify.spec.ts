import { expect, type Page, test } from '@playwright/test'

/**
 * Verifies that laser beams render for guest users with elevated hype.
 * Tests multiple hype levels: home, nearby, away.
 */

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

async function mockRpc(page: Page, lane: 'home' | 'nearby' | 'away'): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		if (url.includes('ListWithProximity')) {
			const group: Record<string, unknown[]> = { home: [], nearby: [], away: [] }
			group[lane] = [
				{
					id: { value: 'c-1' },
					artistId: { value: 'artist-1' },
					title: { value: 'Test Live' },
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
				body: JSON.stringify({ groups: [{ date: { value: { year: tomorrow.getFullYear(), month: tomorrow.getMonth() + 1, day: tomorrow.getDate() } }, ...group }] }),
			})
		}
		return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
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
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, hype: h }]),
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

		// Give rAF time to run
		await page.waitForTimeout(500)

		const results = await page.evaluate(() => {
			const cards = Array.from(document.querySelectorAll('[data-live-card]')).map((c) => ({
				lane: c.getAttribute('data-lane'),
				matched: c.getAttribute('data-matched'),
				beamIndex: c.getAttribute('data-beam-index'),
			}))
			const beams = Array.from(document.querySelectorAll('.laser-beam')).map((b) => ({
				anchor: (b as HTMLElement).dataset.beamAnchor,
				beamH: (b as HTMLElement).style.getPropertyValue('--beam-h'),
			}))
			return { cards, beams }
		})

		// Card must be matched
		const matchedCard = results.cards.find((c) => c.matched === 'true')
		expect(matchedCard, 'expected a matched card').toBeTruthy()
		expect(matchedCard?.beamIndex, 'beam-index must be set').not.toBeNull()

		// Laser beam must exist with non-zero height
		expect(results.beams.length, 'expected at least one laser-beam').toBeGreaterThan(0)
		const beam = results.beams[0]
		expect(beam.beamH, '--beam-h must be set').toBeTruthy()
		expect(beam.beamH, '--beam-h must not be 0').not.toBe('0')
	})
}
