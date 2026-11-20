import {
	type Box,
	box,
	centre,
	fab,
	fabItems,
	intersects,
	nav,
	openShell,
	publishSnack,
	seedSignedInFan,
	settle,
	tabs,
	tapTab,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * The FAB in the bottom navigation bar's centre notch and its thumb arc on
 * both engines: placement, glyph, arc layout, motion, handedness, and the sink
 * under a snack bar or a bottom banner. Runs on Chromium (`functional`) and
 * WebKit (`webkit-shell`). The rest of the sink (the sunk FAB still opens the
 * arc, the FAB rises again, a snack above a banner) is checked in the app
 * shell's stories (src/app-shell.stories.ts); the collapsed state after
 * navigation in src/components/action-menu/action-menu.spec.ts.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/action-menu'
// The timetable's own actions, then the Settings item of the tab pages.
const TIMETABLE_ACTIONS = ['beam', 'filter', 'help', 'settings']

const glyph = (page: Page) => page.locator('action-menu .action-menu-glyph')
const opacity = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity))

async function openArc(page: Page): Promise<void> {
	await fab(page).click()
	await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
	await settle(page, 'action-menu')
}

/** Icon (the button's own circle) and label boxes of every open item. */
async function itemBoxes(
	page: Page,
): Promise<{ id: string; icon: Box; label: Box }[]> {
	const out = []
	for (const item of await fabItems(page).all()) {
		out.push({
			id: (await item.getAttribute('data-action-id')) ?? '',
			icon: await box(item),
			label: await box(item.locator('.fab-item-label')),
		})
	}
	return out
}

/** A CSS length, resolved to px at this viewport. */
const px = (page: Page, length: string) =>
	page.evaluate((length) => {
		const probe = document.createElement('div')
		probe.style.inlineSize = length
		probe.style.position = 'absolute'
		document.body.append(probe)
		const w = probe.getBoundingClientRect().width
		probe.remove()
		return w
	}, length)

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page)
})

test.describe('placement in the notch', () => {
	test(`@spec ${CAPABILITY} "Launcher present with the navigation bar"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await expect(page.locator('action-menu')).toHaveCount(1)
		await expect(fab(page)).toBeVisible()
		expect(await fab(page).evaluate((el) => el.matches(':popover-open'))).toBe(
			true,
		)
		await settle(page, 'action-menu')
		// @spec components/infrastructure/fan/web/global/action-menu "Navigation height is published for offset"
		// The bar is sized by the published --bottom-nav-height, and the FAB's
		// centre is the bar's top edge: that height plus the safe-area inset,
		// measured from the bottom of the viewport.
		const bar = await box(nav(page))
		expect(bar.height).toBeCloseTo(
			await px(page, 'var(--bottom-nav-height)'),
			0,
		)
		const c = centre(await box(fab(page)))
		expect(c.y).toBeCloseTo(bar.y, 0)
	})
})

test.describe('the action arc', () => {
	test(`@spec ${CAPABILITY} "Tapping the FAB expands the action list"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await openArc(page)

		const items = await itemBoxes(page)
		expect(items.map((i) => i.id)).toEqual(TIMETABLE_ACTIONS)
		const f = centre(await box(fab(page)))
		let previous = f
		for (const item of items) {
			const c = centre(item.icon)
			expect(c.y).toBeLessThan(previous.y)
			expect(c.x).toBeGreaterThan(previous.x)
			previous = c
		}
		await expect(glyph(page)).toHaveAttribute('data-open', 'true')
		expect(await opacity(page, 'action-menu .fab-close')).toBe(1)
		expect(await opacity(page, 'action-menu .fab-equalizer')).toBe(0)
	})

	test(`@spec ${CAPABILITY} "Tapping again collapses the list"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await openArc(page)

		await fab(page).click()

		await expect(fab(page)).toHaveAttribute('aria-expanded', 'false')
		await expect(page.locator('#action-menu-panel:popover-open')).toHaveCount(0)
		await settle(page, 'action-menu')
		expect(await opacity(page, 'action-menu .fab-equalizer')).toBe(1)
		expect(await opacity(page, 'action-menu .fab-close')).toBe(0)
	})

	for (const width of [320, 390]) {
		test.describe(`at ${width}px`, () => {
			test.use({ viewport: { width, height: 700 } })

			test(`@spec ${CAPABILITY} "Labels never overlap icons" (${width}px)`, {
				tag: '@webkit',
			}, async ({ page }) => {
				await openShell(page, '/timetable')
				await openArc(page)
				const items = await itemBoxes(page)
				expect(items.map((i) => i.id)).toEqual(TIMETABLE_ACTIONS)

				for (const item of items) {
					for (const other of items) {
						if (other === item) continue
						expect(intersects(item.label, other.icon)).toBe(false)
						expect(intersects(item.label, other.label)).toBe(false)
					}
					for (const b of [item.icon, item.label]) {
						expect(b.x).toBeGreaterThanOrEqual(16)
						expect(b.x + b.width).toBeLessThanOrEqual(width - 16)
						expect(b.y).toBeGreaterThanOrEqual(16)
					}
				}
			})
		})
	}

	test(`@spec ${CAPABILITY} "Expansion uses spring motion"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await settle(page, 'action-menu')
		// Read each item's travel the moment the arc opens.
		const motion = await page.evaluate(
			() =>
				new Promise<
					{
						from: string
						to: string
						easing: string
						delay: number
					}[]
				>((resolve) => {
					const toggle = document.querySelector<HTMLElement>(
						'action-menu .action-menu-toggle',
					)
					toggle?.click()
					const read = () => {
						const items = [
							...document.querySelectorAll('action-menu .fab-list-item'),
						]
						const travel = items.map((el) =>
							el
								.getAnimations()
								.find(
									(a) =>
										(a as CSSTransition).transitionProperty ===
										'offset-distance',
								),
						)
						if (items.length === 0 || travel.some((t) => !t)) {
							requestAnimationFrame(read)
							return
						}
						resolve(
							travel.map((t) => {
								const frames =
									(t?.effect as KeyframeEffect | null)?.getKeyframes() ?? []
								const timing = t?.effect?.getTiming()
								return {
									from: String(frames[0]?.offsetDistance),
									to: String(frames[frames.length - 1]?.offsetDistance),
									easing: String(timing?.easing),
									delay: Number(timing?.delay),
								}
							}),
						)
					}
					read()
				}),
		)

		expect(motion).toHaveLength(TIMETABLE_ACTIONS.length)
		for (const [i, m] of motion.entries()) {
			// Starts at the FAB and travels along the arc to its place.
			expect(m.from).toBe('0%')
			expect(Number.parseFloat(m.to)).toBeGreaterThan(0)
			// A spring: the timing curve overshoots (a control point above 1).
			const ys = m.easing
				.match(/cubic-bezier\(([^)]+)\)/)?.[1]
				.split(',')
				.map(Number)
			expect(ys?.[1] ?? 0).toBeGreaterThan(1)
			// Staggered, closest to the FAB first.
			if (i > 0) expect(m.delay).toBeGreaterThan(motion[i - 1].delay)
		}
		// The equalizer bars bounce once as the launcher opens.
		const bars = await page
			.locator('action-menu .fab-bar')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
		expect(bars).toEqual(['fab-bar-bounce', 'fab-bar-bounce', 'fab-bar-bounce'])
		expect(
			await page
				.locator('action-menu .fab-bar')
				.first()
				.evaluate((el) => getComputedStyle(el).animationIterationCount),
		).toBe('1')
		await expect(glyph(page)).toHaveAttribute('data-open', 'true')
	})
})

test.describe('handedness', () => {
	test.describe('left-handed', () => {
		test.beforeEach(async ({ page }) => {
			await seedSignedInFan(page, { handed: 'left' })
		})

		test(`@spec ${CAPABILITY} "Left-handed mode mirrors the arc"`, {
			tag: '@webkit',
		}, async ({ page }) => {
			await openShell(page, '/timetable')
			await openArc(page)
			const viewport = page.viewportSize()
			if (!viewport) throw new Error('no viewport')

			expect(centre(await box(fab(page))).x).toBeCloseTo(viewport.width / 2, 0)
			const f = centre(await box(fab(page)))
			const items = await itemBoxes(page)
			for (const [i, item] of items.entries()) {
				const c = centre(item.icon)
				expect(c.x).toBeLessThan(i === 0 ? f.x : centre(items[i - 1].icon).x)
				expect(c.y).toBeLessThan(i === 0 ? f.y : centre(items[i - 1].icon).y)
				// The label sits on the right of its icon.
				expect(item.label.x).toBeGreaterThanOrEqual(
					item.icon.x + item.icon.width,
				)
				expect(item.label.x + item.label.width).toBeLessThanOrEqual(
					viewport.width - 16,
				)
			}
		})
	})

	test(`@spec ${CAPABILITY} "Preference persists across sessions"`, async ({
		page,
	}) => {
		await openShell(page, '/settings')
		const toggle = page.getByRole('switch', { name: /Left-handed|左利き/ })
		await expect(toggle).toHaveAttribute('aria-checked', 'false')
		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-checked', 'true')

		await page.reload()
		await tabs(page).nth(3).waitFor()
		await tapTab(page, 'home')
		await page.waitForURL('**/timetable')
		await openArc(page)

		const f = centre(await box(fab(page)))
		const first = centre((await itemBoxes(page))[0].icon)
		expect(first.x).toBeLessThan(f.x)
	})
})

test.describe('sinking while a snack bar is open', () => {
	test(`@spec ${CAPABILITY} "A snack bar opens"`, { tag: '@webkit' }, async ({
		page,
	}) => {
		await openShell(page, '/timetable')
		await publishSnack(page, 'Saved', 10_000)
		await expect(page.locator('.snack-item:popover-open')).toHaveCount(1)
		await settle(page, 'action-menu')
		await settle(page, 'snack-bar')

		const f = await box(fab(page))
		expect(f.width).toBeCloseTo(40, 0)
		expect(f.height).toBeCloseTo(40, 0)
		// Entirely within the bar's height.
		const bar = await box(nav(page))
		expect(f.y).toBeGreaterThanOrEqual(bar.y - 0.5)
		expect(f.y + f.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5)
		expect(intersects(f, await box(page.locator('.snack-item')))).toBe(false)
	})
})

test.describe('sinking while a bottom banner is visible', () => {
	test.beforeEach(async ({ page }) => {
		await seedSignedInFan(page, { installBanner: true })
	})

	/** Sunk: 40px across, centred, entirely within the bar's height. */
	async function expectSunk(page: Page): Promise<Box> {
		const f = await box(fab(page))
		const viewport = page.viewportSize()
		if (!viewport) throw new Error('no viewport')
		expect(f.width).toBeCloseTo(40, 0)
		expect(centre(f).x).toBeCloseTo(viewport.width / 2, 0)
		const bar = await box(nav(page))
		expect(f.y).toBeGreaterThanOrEqual(bar.y - 0.5)
		expect(f.y + f.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5)
		return f
	}

	async function openWithBanner(page: Page): Promise<void> {
		await openShell(page, '/timetable')
		await expect(
			page.locator('pwa-install-banner .bottom-banner'),
		).toBeVisible()
		await settle(page, 'pwa-install-banner')
		await settle(page, 'action-menu')
	}

	test(`@spec ${CAPABILITY} "A bottom banner is visible"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		// Both action-menu requirements carry this scenario name; this test covers
		// both: the FAB is sunk, 40px, centred and within the bar.
		await openWithBanner(page)

		const f = await expectSunk(page)
		const b = await box(page.locator('pwa-install-banner .bottom-banner'))
		expect(intersects(f, b)).toBe(false)
		// Within the bar, the FAB covers nothing above the banner.
		expect(f.y).toBeGreaterThanOrEqual(b.y + b.height - 0.5)

		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "FAB sunk under a banner"
		// The bar keeps its notch around the sunk FAB.
		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		const notch = await nav(page).evaluate(
			(el) => getComputedStyle(el).maskImage,
		)
		const radius = await px(page, 'var(--fab-notch-radius)')
		expect(notch).toContain(`${radius}px at`)
	})
})
