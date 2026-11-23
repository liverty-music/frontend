import {
	fab,
	openShell,
	seedSignedInFan,
	settle,
	tapTab,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * How the screen changes (the app-shell "Screen changes follow their
 * navigation level" requirement), read from the animations the browser runs
 * on the View Transition's pseudo-elements: which element each one fades,
 * and when it starts and ends.
 */

const SHELL = 'components/infrastructure/fan/web/global/app-shell'

interface Fade {
	pseudo: string
	start: number
	end: number
	opacity: boolean
}

interface Recorded {
	change: string | undefined
	fades: Fade[]
}

declare global {
	interface Window {
		__transitions: Recorded[]
	}
}

/** Record every View Transition's animations once they start running. */
async function recordTransitions(page: Page): Promise<void> {
	await page.context().addInitScript(() => {
		window.__transitions = []
		const original = document.startViewTransition.bind(document)
		document.startViewTransition = ((update) => {
			const transition = original(update)
			const change = document.documentElement.dataset.screenChange
			void transition.ready
				.then(() => {
					window.__transitions.push({
						change,
						fades: document
							.getAnimations()
							.filter(
								(a) =>
									a.effect instanceof KeyframeEffect &&
									a.effect.pseudoElement !== null,
							)
							.map((a) => {
								const effect = a.effect as KeyframeEffect
								const timing = effect.getComputedTiming()
								return {
									pseudo: effect.pseudoElement ?? '',
									start: Number(timing.delay),
									end: Number(timing.delay) + Number(timing.duration),
									opacity: effect
										.getKeyframes()
										.some((frame) => 'opacity' in frame),
								}
							}),
					})
				})
				.catch(() => {})
			return transition
		}) as typeof document.startViewTransition
	})
}

const transitions = (page: Page) => page.evaluate(() => window.__transitions)

/** The fades of the route area: the old one, then the new one. */
function routeFades(recorded: Recorded): { out: Fade; in: Fade } {
	const fades = recorded.fades.filter((f) => f.opacity)
	const out = fades.find((f) => f.pseudo === '::view-transition-old(root)')
	const incoming = fades.find((f) => f.pseudo === '::view-transition-new(root)')
	if (!out || !incoming) throw new Error('the route area is not fading')
	return { out, in: incoming }
}

/** Nothing of the chrome fades: the bar, header and FAB keep their own names. */
function chromeFades(recorded: Recorded): Fade[] {
	return recorded.fades.filter(
		(f) =>
			f.opacity &&
			/\((bottom-nav|page-header|action-menu-toggle)\)/.test(f.pseudo),
	)
}

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page)
	await recordTransitions(page)
})

test(`@spec ${SHELL} "Tab switch"`, async ({ page }) => {
	await openShell(page, '/timetable')
	await tapTab(page, 'my-artists')
	await page.waitForURL('**/my-artists')
	await expect.poll(async () => (await transitions(page)).length).toBe(1)

	const [recorded] = await transitions(page)
	expect(recorded.change).toBe('tab')
	const { out, in: incoming } = routeFades(recorded)
	// The old route is gone before the new one starts, and all within 200 ms.
	expect(out.end).toBeLessThanOrEqual(incoming.start)
	expect(incoming.end).toBeLessThanOrEqual(200)
	expect(chromeFades(recorded)).toEqual([])
})

test(`@spec ${SHELL} "Route change from inside a page"`, async ({ page }) => {
	await openShell(page, '/timetable')
	await fab(page).click()
	await settle(page, 'action-menu')
	await page.locator('action-menu .fab-item[data-action-id="settings"]').click()
	await page.waitForURL('**/settings')
	await expect.poll(async () => (await transitions(page)).length).toBe(1)

	const [recorded] = await transitions(page)
	expect(recorded.change).toBe('page')
	const { out, in: incoming } = routeFades(recorded)
	expect(out.end).toBeLessThanOrEqual(incoming.start)
	expect(incoming.end).toBeLessThanOrEqual(500)
	expect(chromeFades(recorded)).toEqual([])
})

test(`@spec ${SHELL} "Going back"`, async ({ page }) => {
	await openShell(page, '/timetable')
	await fab(page).click()
	await settle(page, 'action-menu')
	await page.locator('action-menu .fab-item[data-action-id="settings"]').click()
	await page.waitForURL('**/settings')
	await expect.poll(async () => (await transitions(page)).length).toBe(1)

	// Going back while the fade still runs would join it; wait for its end.
	await page.waitForFunction(
		() => document.documentElement.dataset.screenChange === undefined,
	)
	await page.goBack()
	await page.waitForURL('**/timetable')
	await expect.poll(async () => (await transitions(page)).length).toBe(2)

	const [forward, back] = await transitions(page)
	expect(back.change).toBe('page')
	// The same motion as going forward.
	expect(routeFades(back)).toEqual(routeFades(forward))
})

test(`@spec ${SHELL} "Redirect and first load"`, async ({ page }) => {
	await openShell(page, '/timetable')
	expect(await transitions(page)).toEqual([])
})

test.describe('with reduced motion', () => {
	test.use({ reducedMotion: 'reduce' })

	test(`@spec ${SHELL} "Reduced motion preference"`, async ({ page }) => {
		await openShell(page, '/timetable')
		await tapTab(page, 'my-artists')
		await page.waitForURL('**/my-artists')
		await expect.poll(async () => (await transitions(page)).length).toBe(1)

		const [recorded] = await transitions(page)
		const { out, in: incoming } = routeFades(recorded)
		expect(incoming.end).toBeLessThanOrEqual(100)
		expect(out.end).toBeLessThanOrEqual(incoming.start)
		// No movement: nothing but opacity animates the screens.
		expect(recorded.fades.filter((f) => !f.opacity)).toEqual([])
	})
})
