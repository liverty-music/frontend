import { openShell, seedSignedInFan, tapTab } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

const SHELL = 'components/infrastructure/fan/web/global/app-shell'

interface Recorded {
	ready: 'pending' | 'ok' | string
	finished: 'pending' | 'ok' | string
	/** The View Transition animations seen once `ready` settled. */
	animations: { pseudo: string; duration: number }[]
}

/**
 * Record every View Transition the app starts: whether its `ready` and
 * `finished` promises settle (a TimeoutError means the update callback waited
 * for a frame the browser never produced), and which pseudo-element
 * animations ran.
 */
async function recordTransitions(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const log: Recorded[] = []
		;(window as unknown as { __vt: Recorded[] }).__vt = log
		const start = document.startViewTransition.bind(document)
		document.startViewTransition = ((arg: ViewTransitionUpdateCallback) => {
			const entry: Recorded = {
				ready: 'pending',
				finished: 'pending',
				animations: [],
			}
			log.push(entry)
			const transition = start(arg)
			transition.ready.then(
				() => {
					entry.ready = 'ok'
					entry.animations = document
						.getAnimations()
						.filter((a) =>
							(a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
								'::view-transition',
							),
						)
						.map((a) => ({
							pseudo: (a.effect as KeyframeEffect).pseudoElement ?? '',
							duration: Number(a.effect?.getComputedTiming().duration ?? 0),
						}))
				},
				(e: Error) => {
					entry.ready = e.name
				},
			)
			transition.finished.then(
				() => {
					entry.finished = 'ok'
				},
				(e: Error) => {
					entry.finished = e.name
				},
			)
			return transition
		}) as typeof document.startViewTransition
	})
}

const transitions = (page: Page) =>
	page.evaluate(() => (window as unknown as { __vt: Recorded[] }).__vt)

/** Wait for the last recorded transition to finish and return it. */
async function lastFinished(page: Page): Promise<Recorded> {
	await expect
		.poll(async () => (await transitions(page)).at(-1)?.finished, {
			timeout: 10_000,
		})
		.not.toBe('pending')
	const all = await transitions(page)
	return all[all.length - 1]
}

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page)
	await recordTransitions(page)
})

test.describe('tab switches', () => {
	test(`@spec ${SHELL} "Tab switch"`, async ({ page }) => {
		await openShell(page, '/dashboard')

		// Home → My Artists → Discovery → Home: each switch is one transition
		// that settles (no TimeoutError: the update callback never waits for a
		// frame).
		const steps: [string, RegExp][] = [
			['my-artists', /\/my-artists$/],
			['discovery', /\/discovery/],
			['home', /\/dashboard$/],
		]
		for (const [icon, url] of steps) {
			const before = (await transitions(page)).length
			await tapTab(page, icon)
			await expect(page).toHaveURL(url)
			const vt = await lastFinished(page)
			expect((await transitions(page)).length).toBe(before + 1)
			expect(vt.ready).toBe('ok')
			expect(vt.finished).toBe('ok')

			// The route area (root) fades out and in within 250-350 ms; the
			// navigation bar and the page header do not fade.
			const root = vt.animations.filter((a) =>
				/^::view-transition-(old|new)\(root\)$/.test(a.pseudo),
			)
			expect(root.map((a) => a.pseudo).sort()).toEqual([
				'::view-transition-new(root)',
				'::view-transition-old(root)',
			])
			for (const a of root) {
				expect(a.duration).toBeGreaterThanOrEqual(250)
				expect(a.duration).toBeLessThanOrEqual(350)
			}
			const chrome = vt.animations.filter(
				(a) =>
					/\((bottom-nav|page-header)\)$/.test(a.pseudo) &&
					!a.pseudo.startsWith('::view-transition-group'),
			)
			expect(chrome).toEqual([])
		}
	})

	test(`@spec ${SHELL} "Reduced motion preference"`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await openShell(page, '/dashboard')

		await tapTab(page, 'my-artists')
		await expect(page).toHaveURL(/\/my-artists$/)
		const vt = await lastFinished(page)
		expect(vt.finished).toBe('ok')
		// No View Transition animation runs: the new route shows at once.
		expect(vt.animations).toEqual([])
	})

	test(`@spec ${SHELL} "Route change from inside a page"`, async ({ page }) => {
		// A route opened from inside a page (here the page header's bell, which
		// opens the notification center) changes without a page transition, as
		// the timetable's event page does: only a tab tap starts one.
		await openShell(page, '/dashboard')
		await page.getByTestId('notification-bell').click()
		await expect(page).toHaveURL(/\/notifications$/)
		expect(await transitions(page)).toEqual([])
	})
})
