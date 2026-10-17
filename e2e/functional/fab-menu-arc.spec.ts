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
 * The FAB in the bottom navigation bar's centre notch and its thumb arc:
 * placement, glyph, arc layout, motion, handedness, the sink while a snack bar
 * is open, and the collapsed state after navigation. Runs on Chromium
 * (`functional`) and WebKit (`webkit-shell`).
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/fab-menu'
const DASHBOARD_ACTIONS = ['beam', 'filter', 'mode-swap', 'help']

const glyph = (page: Page) => page.locator('fab-menu .fab-glyph')
const opacity = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity))

async function openArc(page: Page): Promise<void> {
	await fab(page).click()
	await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
	await settle(page, 'fab-menu')
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
	test(`@spec ${CAPABILITY} "Launcher present with the navigation bar"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await expect(page.locator('fab-menu')).toHaveCount(1)
		await expect(fab(page)).toBeVisible()
		expect(await fab(page).evaluate((el) => el.matches(':popover-open'))).toBe(
			true,
		)
		await settle(page, 'fab-menu')
		// @spec components/infrastructure/fan/web/global/fab-menu "Navigation height is published for offset"
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

	test(`@spec ${CAPABILITY} "FAB floats in the thumb zone above content"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await settle(page, 'fab-menu')
		const f = await box(fab(page))
		const viewport = page.viewportSize()
		if (!viewport) throw new Error('no viewport')

		expect(centre(f).x).toBeCloseTo(viewport.width / 2, 0)
		expect(centre(f).y).toBeCloseTo((await box(nav(page))).y, 0)
		expect(f.width).toBeCloseTo(56, 0)
		// The notch leaves at least 6px around the FAB.
		const notchRadius = await px(page, 'var(--fab-notch-radius)')
		expect(notchRadius - f.width / 2).toBeGreaterThanOrEqual(6)
		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		// No tab's icon or label is covered.
		for (const tab of await tabs(page).all()) {
			expect(intersects(await box(tab.locator('.nav-icon')), f)).toBe(false)
			expect(intersects(await box(tab.locator('.nav-label')), f)).toBe(false)
		}
	})
})

test.describe('the action arc', () => {
	test(`@spec ${CAPABILITY} "Tapping the FAB expands the action list"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)

		const items = await itemBoxes(page)
		expect(items.map((i) => i.id)).toEqual(DASHBOARD_ACTIONS)
		const f = centre(await box(fab(page)))
		let previous = f
		for (const item of items) {
			const c = centre(item.icon)
			expect(c.y).toBeLessThan(previous.y)
			expect(c.x).toBeGreaterThan(previous.x)
			previous = c
		}
		await expect(glyph(page)).toHaveAttribute('data-open', 'true')
		expect(await opacity(page, 'fab-menu .fab-close')).toBe(1)
		expect(await opacity(page, 'fab-menu .fab-equalizer')).toBe(0)
	})

	test(`@spec ${CAPABILITY} "Tapping again collapses the list"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)

		await fab(page).click()

		await expect(fab(page)).toHaveAttribute('aria-expanded', 'false')
		await expect(page.locator('#fab-menu-panel:popover-open')).toHaveCount(0)
		await settle(page, 'fab-menu')
		expect(await opacity(page, 'fab-menu .fab-equalizer')).toBe(1)
		expect(await opacity(page, 'fab-menu .fab-close')).toBe(0)
	})

	test(`@spec ${CAPABILITY} "Idle glyph is still"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		await page.waitForTimeout(1000)
		const running = await page
			.locator('fab-menu .fab-equalizer')
			.evaluate((el) => el.getAnimations({ subtree: true }).length)
		expect(running).toBe(0)
	})

	for (const width of [320, 390]) {
		test.describe(`at ${width}px`, () => {
			test.use({ viewport: { width, height: 700 } })

			test(`@spec ${CAPABILITY} "Every item shows icon and label" (${width}px)`, async ({
				page,
			}) => {
				await openShell(page, '/dashboard')
				await openArc(page)
				for (const item of await fabItems(page).all()) {
					await expect(item.locator('svg-icon')).toBeVisible()
					await expect(item.locator('.fab-item-label')).toBeVisible()
					await expect(item.locator('.fab-item-label')).toHaveText(/\S/)
				}
			})

			test(`@spec ${CAPABILITY} "Labels never overlap icons" (${width}px)`, async ({
				page,
			}) => {
				await openShell(page, '/dashboard')
				await openArc(page)
				const items = await itemBoxes(page)
				expect(items.map((i) => i.id)).toEqual(DASHBOARD_ACTIONS)

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

			test(`@spec ${CAPABILITY} "Items are comfortably tappable" (${width}px)`, async ({
				page,
			}) => {
				await openShell(page, '/dashboard')
				await openArc(page)
				for (const item of await itemBoxes(page)) {
					expect(Math.round(item.icon.width)).toBeGreaterThanOrEqual(48)
					expect(Math.round(item.icon.height)).toBeGreaterThanOrEqual(48)
				}
			})
		})
	}

	test(`@spec ${CAPABILITY} "Expansion uses spring motion"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await settle(page, 'fab-menu')
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
						'fab-menu .fab-toggle',
					)
					toggle?.click()
					const read = () => {
						const items = [
							...document.querySelectorAll('fab-menu .fab-list-item'),
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

		expect(motion).toHaveLength(DASHBOARD_ACTIONS.length)
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
			.locator('fab-menu .fab-bar')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
		expect(bars).toEqual(['fab-bar-bounce', 'fab-bar-bounce', 'fab-bar-bounce'])
		expect(
			await page
				.locator('fab-menu .fab-bar')
				.first()
				.evaluate((el) => getComputedStyle(el).animationIterationCount),
		).toBe('1')
		await expect(glyph(page)).toHaveAttribute('data-open', 'true')
	})

	test.describe('with reduced motion', () => {
		test.use({ reducedMotion: 'reduce' })

		test(`@spec ${CAPABILITY} "Reduced motion lands the end state without bounce"`, async ({
			page,
		}) => {
			await openShell(page, '/dashboard')
			await fab(page).click()

			const items = page.locator('fab-menu .fab-list-item')
			const timing = await items.evaluateAll((els) =>
				els.map((el) => {
					const s = getComputedStyle(el)
					return {
						duration: Math.max(
							...s.transitionDuration.split(',').map(Number.parseFloat),
						),
						delay: Math.max(
							...s.transitionDelay.split(',').map(Number.parseFloat),
						),
					}
				}),
			)
			for (const t of timing) {
				expect(t.duration).toBeLessThanOrEqual(0.001)
				expect(t.delay).toBe(0)
			}
			const bars = await page
				.locator('fab-menu .fab-bar')
				.evaluateAll((els) =>
					els.map((el) => getComputedStyle(el).animationName),
				)
			expect(bars).toEqual(['none', 'none', 'none'])

			// Fully functional: the items are in place and the toggle closes.
			await settle(page, 'fab-menu')
			const f = centre(await box(fab(page)))
			for (const item of await itemBoxes(page)) {
				expect(centre(item.icon).y).toBeLessThan(f.y)
			}
			await fab(page).click()
			await expect(fab(page)).toHaveAttribute('aria-expanded', 'false')
		})
	})

	test(`@spec ${CAPABILITY} "Expanded panel keeps strong contrast"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)

		const colours = await page.evaluate(() => {
			const luminance = (css: string) => {
				const ctx = new OffscreenCanvas(1, 1).getContext('2d')
				if (!ctx) throw new Error('no 2d context')
				ctx.fillStyle = css
				ctx.fillRect(0, 0, 1, 1)
				const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((v) => {
					const c = v / 255
					return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
				})
				return 0.2126 * r + 0.7152 * g + 0.0722 * b
			}
			const ratio = (a: number, b: number) =>
				(Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
			const label = document.querySelector('fab-menu .fab-item-label')
			const item = document.querySelector(
				'fab-menu .fab-item:not([data-active="true"]):not([aria-pressed="true"])',
			)
			const panel = document.querySelector('#fab-menu-panel')
			if (!label || !item || !panel) throw new Error('arc not open')
			const labelStyle = getComputedStyle(label)
			// The page behind: the app background under the scrim.
			const ctx = new OffscreenCanvas(1, 1).getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			ctx.fillStyle = getComputedStyle(document.body).backgroundColor
			ctx.fillRect(0, 0, 1, 1)
			ctx.fillStyle = getComputedStyle(panel, '::backdrop').backgroundColor
			ctx.fillRect(0, 0, 1, 1)
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
			const dimmed = luminance(`rgb(${r}, ${g}, ${b})`)
			return {
				text: ratio(
					luminance(labelStyle.color),
					luminance(labelStyle.backgroundColor),
				),
				surface: ratio(
					luminance(getComputedStyle(item).backgroundColor),
					dimmed,
				),
			}
		})
		expect(colours.text).toBeGreaterThanOrEqual(4.5)
		// The item surface stands out from the dimmed page behind it at the
		// WCAG non-text contrast minimum for UI components (1.4.11).
		expect(colours.surface).toBeGreaterThanOrEqual(3)
	})
})

test.describe('handedness', () => {
	test(`@spec ${CAPABILITY} "Default arc curves to the right"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)
		const viewport = page.viewportSize()
		if (!viewport) throw new Error('no viewport')

		expect(centre(await box(fab(page))).x).toBeCloseTo(viewport.width / 2, 0)
		const items = await itemBoxes(page)
		for (const [i, item] of items.entries()) {
			if (i > 0) expect(item.icon.x).toBeGreaterThan(items[i - 1].icon.x)
			// The label sits on the left of its icon.
			expect(item.label.x + item.label.width).toBeLessThanOrEqual(item.icon.x)
		}
	})

	test.describe('left-handed', () => {
		test.beforeEach(async ({ page }) => {
			await seedSignedInFan(page, { handed: 'left' })
		})

		test(`@spec ${CAPABILITY} "Left-handed mode mirrors the arc"`, async ({
			page,
		}) => {
			await openShell(page, '/dashboard')
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
		await page.waitForURL('**/dashboard')
		await openArc(page)

		const f = centre(await box(fab(page)))
		const first = centre((await itemBoxes(page))[0].icon)
		expect(first.x).toBeLessThan(f.x)
	})
})

test.describe('sinking while a snack bar is open', () => {
	test(`@spec ${CAPABILITY} "A snack bar opens"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		await publishSnack(page, 'Saved', 10_000)
		await expect(page.locator('.snack-item:popover-open')).toHaveCount(1)
		await settle(page, 'fab-menu')
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

	test(`@spec ${CAPABILITY} "The sunk FAB still opens the actions"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await publishSnack(page, 'Saved', 10_000)
		await settle(page, 'fab-menu')

		await openArc(page)

		await expect(fabItems(page)).toHaveCount(DASHBOARD_ACTIONS.length)
		const f = centre(await box(fab(page)))
		for (const item of await itemBoxes(page)) {
			expect(centre(item.icon).y).toBeLessThan(f.y)
		}
	})

	test(`@spec ${CAPABILITY} "The last snack bar closes"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		await publishSnack(page, 'Saved', 1500)
		await expect(page.locator('.snack-item:popover-open')).toHaveCount(1)
		await expect(page.locator('.snack-item')).toHaveCount(0, { timeout: 5000 })
		await settle(page, 'fab-menu')

		const f = await box(fab(page))
		expect(f.width).toBeCloseTo(56, 0)
		// Protruding from the notch again.
		expect(centre(f).y).toBeCloseTo((await box(nav(page))).y, 0)
	})
})

test.describe('collapsed after navigation', () => {
	/**
	 * Navigate while the arc is open. A real tap on a tab first meets the
	 * arc's scrim, so the tab is clicked programmatically, the way a route
	 * change from code (or a fast second tap) reaches the router.
	 */
	async function clickTabBehindScrim(page: Page, icon: string) {
		await page
			.locator(`.nav-tab[data-nav="${icon}"]`)
			.evaluate((el) => (el as HTMLElement).click())
	}

	async function expectCollapsed(page: Page) {
		await expect(fab(page)).toHaveAttribute('aria-expanded', 'false')
		await expect(glyph(page)).toHaveAttribute('data-open', 'false')
		await settle(page, 'fab-menu')
		expect(await opacity(page, 'fab-menu .fab-equalizer')).toBe(1)
	}

	test(`@spec ${CAPABILITY} "Leaving with the arc open and coming back"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)

		await clickTabBehindScrim(page, 'ticket')
		await page.waitForURL('**/tickets')
		await expect(page.locator('fab-menu')).toHaveCount(0)
		await tapTab(page, 'home')
		await page.waitForURL('**/dashboard')

		await expect(fab(page)).toBeVisible()
		await expectCollapsed(page)
	})

	test(`@spec ${CAPABILITY} "Moving between two routes that both contribute actions"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openArc(page)

		await clickTabBehindScrim(page, 'my-artists')
		await page.waitForURL('**/my-artists')

		await expect(fab(page)).toBeVisible()
		await expectCollapsed(page)
	})
})

test.describe('while a bottom banner is visible', () => {
	test.beforeEach(async ({ page }) => {
		await seedSignedInFan(page, { installBanner: true })
	})

	/** The `space-s` step at this viewport, in px. */
	const spaceS = (page: Page) => px(page, 'var(--space-s)')

	test(`@spec ${CAPABILITY} "A bottom banner is visible"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		const banner = page.locator('.pwa-banner')
		await expect(banner).toBeVisible()
		await settle(page, 'pwa-install-banner')
		await settle(page, 'fab-menu')

		const f = await box(fab(page))
		const b = await box(banner)
		const viewport = page.viewportSize()
		if (!viewport) throw new Error('no viewport')
		// Centred, floating one space-s step above the banner, full size.
		expect(centre(f).x).toBeCloseTo(viewport.width / 2, 0)
		expect(b.y - (f.y + f.height)).toBeCloseTo(await spaceS(page), 0)
		expect(f.width).toBeCloseTo(56, 0)
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "FAB floating above a banner"
		// The bar shows no notch: its top edge is solid at the centre.
		const bar = await box(nav(page))
		const hit = await page.evaluate(
			({ x, y }) =>
				document.elementFromPoint(x, y)?.closest('bottom-nav-bar') != null,
			{ x: viewport.width / 2, y: bar.y + 2 },
		)
		expect(hit).toBe(true)
	})

	test(`@spec ${CAPABILITY} "A snack bar opens above a bottom banner"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await expect(page.locator('.pwa-banner')).toBeVisible()
		await publishSnack(page, 'Saved', 10_000)
		await expect(page.locator('.snack-item:popover-open')).toHaveCount(1)
		await settle(page, 'snack-bar')
		await settle(page, 'fab-menu')

		const f = await box(fab(page))
		const snack = await box(page.locator('.snack-item'))
		// @spec components/infrastructure/fan/web/global/snack-bar "The FAB floats above a visible banner"
		// The FAB keeps its size; the snack bar sits a space-s step above it.
		expect(f.width).toBeCloseTo(56, 0)
		expect(f.y - (snack.y + snack.height)).toBeCloseTo(await spaceS(page), 0)
		expect(intersects(f, snack)).toBe(false)
		expect(intersects(f, await box(page.locator('.pwa-banner')))).toBe(false)
	})
})
