import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	type Box,
	box,
	centre,
	fab,
	intersects,
	publishSnack,
	settle,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

/**
 * Discovery's swap tile beside the orb: where it sits against the bubble field
 * and the largest orb on a 375px phone, the switch to the All Nearby view and
 * back, and how it behaves under an open snack bar and an open FAB arc.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ viewport: { width: 375, height: 812 } })

const CAPABILITY = 'components/infrastructure/fan/web/route/discovery'

/** The fan's follows, so the field is seeded from them. */
const FOLLOWED = Array.from({ length: 10 }, (_, i) => ({
	id: fakeId(`followed-${i}`),
	name: `FOLLOWED ${i}`,
	mbid: '',
}))

const bubbleArtists = (prefix: string) => ({
	artists: Array.from({ length: 50 }, (_, i) => ({
		id: { value: fakeId(`${prefix}-${i}`) },
		name: { value: `${prefix.toUpperCase()} ${i}` },
		mbid: { value: '' },
	})),
})

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

const nearbyGroups = Array.from({ length: 5 }, (_, i) => ({
	date: localDate(i + 1),
	home: [
		{
			id: { value: fakeId(`home-${i}`) },
			performers: [
				{
					id: { value: fakeId(`band-${i}`) },
					name: { value: `BAND ${i}` },
					mbid: { value: '' },
				},
			],
			series: { id: { value: fakeId(`s-${i}`) }, title: { value: 'Live' } },
			localDate: localDate(i + 1),
			venue: { name: { value: 'Zepp Fukuoka' }, adminArea: { value: 'JP-40' } },
			sourceUrl: { value: 'https://example.com' },
		},
	],
	nearby: [],
	away: [],
}))

interface Seed {
	handed?: 'left' | 'right'
}

async function openDiscovery(
	page: Page,
	path = '/discovery',
	seed: Seed = {},
): Promise<void> {
	await page.addInitScript(
		({ followed, handed }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem('guest.home', 'JP-40')
			localStorage.setItem('language', 'ja')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify(followed.map((artist) => ({ artist, hype: 'home' }))),
			)
			if (handed) localStorage.setItem('fab.handed', handed)
		},
		{ followed: FOLLOWED, handed: seed.handed },
	)
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body),
			})
		if (url.includes('ListTop')) return json(bubbleArtists('top'))
		if (url.includes('ListSimilar')) return json(bubbleArtists('similar'))
		if (url.includes('ListByLocation'))
			return json(concertWire({ groups: nearbyGroups }))
		return json({})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto(path)
	await page.locator('discovery-route').waitFor({ timeout: 60_000 })
}

const tile = (page: Page) => page.getByTestId('discovery-swap')
const tileBox = (page: Page) =>
	box(page.locator('discovery-swap-button .swap-tile'))

/** The bubbles and the orb as drawn on the canvas, in page coordinates. */
function drawn(page: Page) {
	return page.evaluate(() => {
		const el = document.querySelector('dna-orb-canvas') as HTMLElement & {
			$au: Record<string, { viewModel: unknown }>
		}
		const vm = el.$au['au:resource:custom-element'].viewModel as {
			physics: {
				getBubbles(): {
					body: { position: { x: number; y: number } }
					radius: number
					scale: number
				}[]
			}
			orbRenderer: { orbX: number; orbY: number; orbRadius: number }
			canvas: HTMLCanvasElement
		}
		const canvas = vm.canvas.getBoundingClientRect()
		return {
			bubbles: vm.physics.getBubbles().map((b) => ({
				x: canvas.x + b.body.position.x,
				y: canvas.y + b.body.position.y,
				r: b.radius * b.scale,
			})),
			orb: {
				x: canvas.x + vm.orbRenderer.orbX,
				y: canvas.y + vm.orbRenderer.orbY,
				r: vm.orbRenderer.orbRadius,
			},
		}
	})
}

/** Whether a circle reaches into a box. */
function circleHits(c: { x: number; y: number; r: number }, b: Box): boolean {
	const nx = Math.max(b.x, Math.min(c.x, b.x + b.width))
	const ny = Math.max(b.y, Math.min(c.y, b.y + b.height))
	return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r ** 2
}

test.describe('Discovery swap tile', () => {
	test(`@spec ${CAPABILITY} "The tile never covers the bubble field"`, async ({
		page,
	}) => {
		await openDiscovery(page)
		await expect(tile(page)).toBeVisible()
		// Let the bubbles arrive and fall into place, and the orb grow.
		await expect
			.poll(async () => (await drawn(page)).bubbles.length, { timeout: 20_000 })
			.toBeGreaterThan(20)
		// The orb grows one stage per follow made in this visit; grow it to its
		// largest (the narrow-screen ceiling, 56px) as ten follows would.
		await page.evaluate(() => {
			const el = document.querySelector('dna-orb-canvas') as HTMLElement & {
				$au: Record<string, { viewModel: unknown }>
			}
			const vm = el.$au['au:resource:custom-element'].viewModel as {
				activationLevel: number
				applyLevel(level: number): void
			}
			vm.activationLevel = 10
			vm.applyLevel(10)
		})
		await expect
			.poll(async () => Math.round((await drawn(page)).orb.r), {
				timeout: 10_000,
			})
			.toBe(56)
		await page.waitForTimeout(2500)

		const t = await tileBox(page)
		const c = centre(t)
		expect(c.x).toBeGreaterThanOrEqual(260)
		expect(c.x).toBeLessThanOrEqual(300)

		// Sample the moving field for a while: nothing is ever drawn under it.
		for (let i = 0; i < 10; i++) {
			const { bubbles, orb } = await drawn(page)
			expect(circleHits(orb, t)).toBe(false)
			expect(bubbles.filter((b) => circleHits(b, t))).toEqual([])
			await page.waitForTimeout(200)
		}

		// The bubble field is as tall as it is without the tile.
		const area = page.locator('.bubble-area')
		const withTile = (await box(area)).height
		await page.locator('discovery-swap-button').evaluate((el) => {
			;(el as HTMLElement).style.display = 'none'
		})
		const without = (await box(area)).height
		expect(withTile).toBe(without)
	})

	test(`@spec ${CAPABILITY} "Switching to the All Nearby view"`, async ({
		page,
	}) => {
		await openDiscovery(page)
		await tile(page).click()

		const view = page.locator('nearby-concerts')
		await expect(view).toBeVisible()
		await expect(page).toHaveURL(/\/discovery\?view=nearby$/)
		await expect(view.getByTestId('nearby-area-chip')).toContainText('福岡県')
		await expect(view.getByTestId('nearby-date-chip')).toContainText('7日以内')
		await expect(view.locator('[data-live-card]').first()).toBeVisible({
			timeout: 15_000,
		})
		await expect(tile(page)).toHaveAccessibleName('アーティスト')
		await expect(page.locator('.search-bar')).toBeHidden()

		// @spec components/infrastructure/fan/web/route/discovery "Switching back to the artist bubbles"
		await tile(page).click()
		await expect(view).toHaveCount(0)
		await expect(page).toHaveURL(/\/discovery$/)
		await expect(page.locator('.search-bar')).toBeVisible()
		await expect(page.locator('.genre-bar')).toBeVisible()
		await expect(tile(page)).toHaveAccessibleName('近くのライブ')
	})

	test(`@spec ${CAPABILITY} "Left-handed mode"`, async ({ page }) => {
		await openDiscovery(page, '/discovery', { handed: 'left' })
		const c = centre(await tileBox(page))
		// Mirrored about the orb's centre line: 375 - (260..300).
		expect(c.x).toBeGreaterThanOrEqual(75)
		expect(c.x).toBeLessThanOrEqual(115)
	})

	test(`@spec ${CAPABILITY} "A snack bar is open"`, async ({ page }) => {
		await openDiscovery(page)
		await expect(tile(page)).toBeVisible()
		const before = await tileBox(page)
		const floor = await page.locator('.bubble-area').evaluate((area) => {
			const r = area.getBoundingClientRect()
			const orbFloor = Number.parseFloat(
				getComputedStyle(area).getPropertyValue('--orb-floor'),
			)
			// The bubbles' floor: 130px above the orb floor (bubble-physics.ts).
			return r.bottom - orbFloor - 130
		})

		await publishSnack(
			page,
			'BAND 1 の開催予定のライブが見つかりました！',
			4000,
		)
		const snack = page.locator('.snack-item:popover-open')
		await expect(snack).toBeVisible()
		await settle(page, 'discovery-route')
		await settle(page, 'snack-bar')

		const lifted = await tileBox(page)
		const s = await box(snack)
		expect(lifted.y).toBeLessThan(before.y)
		expect(intersects(lifted, s)).toBe(false)
		expect(lifted.y + lifted.height).toBeLessThanOrEqual(s.y)
		expect(lifted.y).toBeGreaterThanOrEqual(floor)

		// Still tappable while lifted.
		await tile(page).click()
		await expect(page.locator('nearby-concerts')).toBeVisible()

		await expect(snack).toHaveCount(0, { timeout: 10_000 })
		await settle(page, 'discovery-route')
		expect((await tileBox(page)).y).toBeCloseTo(before.y, 0)
	})

	test(`@spec ${CAPABILITY} "The FAB menu is open"`, async ({ page }) => {
		await openDiscovery(page)
		await fab(page).click()
		await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
		await settle(page, 'fab-menu')

		const c = centre(await tileBox(page))
		await page.mouse.click(c.x, c.y)

		await expect(fab(page)).toHaveAttribute('aria-expanded', 'false')
		await expect(page.locator('nearby-concerts')).toHaveCount(0)
		await expect(page).toHaveURL(/\/discovery$/)
	})

	test(`@spec ${CAPABILITY} "Closing the detail sheet returns to the list"`, async ({
		page,
	}) => {
		await openDiscovery(page, '/discovery?view=nearby')
		const view = page.locator('nearby-concerts')
		const cards = view.locator('[data-live-card]')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })
		const scroll = view.locator('.concert-scroll')
		await scroll.evaluate((s) => {
			s.scrollTop = 40
		})
		const scrolled = await scroll.evaluate((s) => s.scrollTop)

		await cards.first().click()
		const sheet = page.locator(
			'event-detail-sheet dialog[open], event-detail-sheet :popover-open',
		)
		await expect(sheet.first()).toBeVisible()
		await expect(page).toHaveURL(/\/concerts\//)

		await page.keyboard.press('Escape')
		await expect(sheet).toHaveCount(0)
		await expect(page).toHaveURL(/\/discovery\?view=nearby$/)
		await expect(view).toBeVisible()
		await expect(view.getByTestId('nearby-area-chip')).toContainText('福岡県')
		await expect(view.getByTestId('nearby-date-chip')).toContainText('7日以内')
		expect(await scroll.evaluate((s) => s.scrollTop)).toBe(scrolled)
	})

	test(`@spec ${CAPABILITY} "Link to the All Nearby view"`, async ({
		page,
	}) => {
		await openDiscovery(page, '/discovery?view=nearby')
		await expect(page.locator('nearby-concerts')).toBeVisible()
		await expect(tile(page)).toHaveAccessibleName('アーティスト')
	})
})
