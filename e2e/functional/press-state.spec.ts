import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Press acknowledgement is CSS on `:active`: a state layer over the control and
 * a shape change. Only a real pointer press puts an element in `:active`, so
 * these run against the guest dashboard with a real mouse held down.
 */

const APP = 'http://localhost:9000'

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const localDate = {
	value: {
		year: tomorrow.getFullYear(),
		month: tomorrow.getMonth() + 1,
		day: tomorrow.getDate(),
	},
}

async function mockRpc(page: Page, withConcert: boolean): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		if (withConcert && route.request().url().includes('ListByArtists')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: localDate,
							home: [
								{
									id: { value: '00000000-0000-4000-8000-c10000000001' },
									performers: [
										{
											id: { value: '00000000-0000-4000-8000-a00000000001' },
											name: { value: 'YOASOBI' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: '00000000-0000-4000-8000-5e0000000001' },
										title: { value: 'Test Live' },
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

async function seedGuest(page: Page, followed: boolean): Promise<void> {
	await page.addInitScript((f) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify(
				f
					? [
							{
								artist: {
									id: '00000000-0000-4000-8000-a00000000001',
									name: 'YOASOBI',
									mbid: '',
								},
								hype: 'home',
							},
						]
					: [],
			),
		)
	}, followed)
}

async function openCard(page: Page): Promise<Locator> {
	await seedGuest(page, true)
	await mockRpc(page, true)
	await page.goto(`${APP}/dashboard`)
	const card = page.locator('[data-live-card]').first()
	await card.waitFor({ timeout: 10000 })
	return card
}

/** Opacity of the state layer, on whichever pseudo-element the card leaves free. */
function stateLayer(card: Locator): Promise<number> {
	return card.evaluate((el) => {
		const pseudo = el.hasAttribute('data-matched') ? '::after' : '::before'
		return Number(getComputedStyle(el, pseudo).opacity)
	})
}

async function pressCentre(page: Page, target: Locator): Promise<void> {
	const box = await target.boundingBox()
	if (!box) throw new Error('target not laid out')
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
}

test.describe('press acknowledgement', () => {
	test(`@spec components/infrastructure/fan/web/global/app-shell "Pressing a control shows the state layer and shape change"`, async ({
		page,
	}) => {
		const card = await openCard(page)
		expect(await stateLayer(card)).toBe(0)

		await pressCentre(page, card)
		await expect.poll(() => stateLayer(card)).toBeGreaterThan(0)
		await expect
			.poll(() => card.evaluate((el) => getComputedStyle(el).transform))
			.not.toBe('none')

		await page.mouse.up()
		await expect.poll(() => stateLayer(card)).toBe(0)
		await expect
			.poll(() => card.evaluate((el) => getComputedStyle(el).transform))
			.toBe('none')
	})

	test(`@spec components/infrastructure/fan/web/global/app-shell "Pressing a control shows the state layer and shape change" (discover CTA)`, async ({
		page,
	}) => {
		// The My Artists empty state: a fan who follows nobody is offered the
		// shared discover CTA.
		await seedGuest(page, false)
		await mockRpc(page, false)
		await page.goto(`${APP}/my-artists`)
		const cta = page.locator('a.discover-cta').first()
		await cta.waitFor({ timeout: 10000 })
		const layer = () =>
			cta.evaluate((el) => Number(getComputedStyle(el, '::after').opacity))
		const radius = () =>
			cta.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
		const before = await radius()
		expect(await layer()).toBe(0)

		await pressCentre(page, cta)
		await expect.poll(layer).toBeGreaterThan(0)
		await expect.poll(radius).not.toBe(before)

		// Release off the link so the press does not become a click that
		// navigates away before the release can be observed.
		await page.mouse.move(0, 0)
		await page.mouse.up()
		await expect.poll(layer).toBe(0)
		await expect.poll(radius).toBe(before)
	})

	test(`@spec components/infrastructure/fan/web/global/app-shell "Hit target is preserved during the shape change"`, async ({
		page,
	}) => {
		const card = await openCard(page)
		// Layout size, which is what the pointer hit-tests against before any
		// visual transform; a transform scales the paint, not the layout box.
		const layoutSize = () =>
			card.evaluate((el) => ({
				w: (el as HTMLElement).offsetWidth,
				h: (el as HTMLElement).offsetHeight,
			}))
		const resting = await layoutSize()
		expect(Math.min(resting.w, resting.h)).toBeGreaterThanOrEqual(44)

		await pressCentre(page, card)
		await expect.poll(() => stateLayer(card)).toBeGreaterThan(0)
		expect(await layoutSize()).toEqual(resting)
		await page.mouse.up()
	})

	test(`@spec components/infrastructure/fan/web/global/app-shell "Reduced motion still acknowledges"`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		const card = await openCard(page)
		const transition = await card.evaluate((el) => {
			const pseudo = el.hasAttribute('data-matched') ? '::after' : '::before'
			return getComputedStyle(el, pseudo).transitionDuration
		})
		expect(transition).toBe('0s')

		await pressCentre(page, card)
		// No animation to wait for: the state layer is there on the first read.
		expect(await stateLayer(card)).toBeGreaterThan(0)
		await page.mouse.up()
	})
})
