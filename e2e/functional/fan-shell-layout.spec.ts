import {
	box,
	fab,
	nav,
	openShell,
	publishSnack,
	seedSignedInFan,
	settle,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * The fan app shell's grid and the bottom navigation's presence for a guest:
 * during onboarding, under the first-visit area dialog, and the tab targets
 * the onboarding coach mark points at.
 */

const NAV = 'components/infrastructure/fan/web/global/bottom-nav-bar'

/** A guest; `onboarded` marks onboarding complete, `home` saves an area. */
async function seedGuest(
	page: Page,
	{ onboarded, home }: { onboarded: boolean; home: boolean },
): Promise<void> {
	await page.addInitScript(
		({ onboarded, home }) => {
			if (onboarded) localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			if (home) localStorage.setItem('guest.home', 'JP-13')
		},
		{ onboarded, home },
	)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

test(`@spec ${NAV} "App shell uses CSS Grid layout with named areas"`, async ({
	page,
}) => {
	await seedGuest(page, { onboarded: true, home: true })
	await openShell(page, '/discovery')
	await page.locator('page-header').waitFor()

	const shell = await page.evaluate(() => {
		const style = (sel: string) => {
			const el = document.querySelector(sel)
			if (!el) throw new Error(`${sel} missing`)
			return getComputedStyle(el)
		}
		const root = style('app-shell')
		const viewport = document.querySelector('au-viewport')
		return {
			display: root.display,
			areas: root.gridTemplateAreas,
			height: document.querySelector('app-shell')?.getBoundingClientRect()
				.height,
			viewportArea: style('au-viewport').gridArea,
			viewportParent: viewport?.parentElement?.tagName.toLowerCase(),
			headerArea: style('page-header').gridArea,
			navArea: style('bottom-nav-bar').gridArea,
			navPosition: style('bottom-nav-bar nav').position,
			navHostPosition: style('bottom-nav-bar').position,
			navPopover: document
				.querySelector('bottom-nav-bar nav')
				?.hasAttribute('popover'),
		}
	})
	expect(shell.display).toBe('grid')
	expect(shell.areas).toBe('"header" "viewport" "nav"')
	expect(shell.height).toBe(844)
	expect(shell.viewportParent).toBe('app-shell')
	expect(shell.viewportArea).toContain('viewport')
	expect(shell.headerArea).toContain('header')
	expect(shell.navArea).toContain('nav')
	for (const position of [shell.navPosition, shell.navHostPosition]) {
		expect(['fixed', 'absolute']).not.toContain(position)
	}
	expect(shell.navPopover).toBe(false)
	// The nav row sits at the bottom of the 100dvh grid.
	const bar = await box(nav(page))
	expect(bar.y + bar.height).toBeCloseTo(844, 0)
})

test(`@spec ${NAV} "Navigation shown during onboarding (discover, dashboard, my-artists)"`, async ({
	page,
}) => {
	await seedGuest(page, { onboarded: false, home: false })
	await page.goto('/discovery')
	await page.locator('discovery-route').waitFor({ timeout: 30_000 })

	await expect(nav(page)).toBeVisible()
	// No click prevention of its own on the bar.
	expect(
		await nav(page).evaluate((el) => getComputedStyle(el).pointerEvents),
	).not.toBe('none')
})

test(`@spec ${NAV} "Navigation remains visible beneath area setup dialog"`, async ({
	page,
}) => {
	// Onboarded without an area: the dashboard asks for one in a modal dialog.
	await seedGuest(page, { onboarded: true, home: false })
	await openShell(page, '/dashboard')
	const dialog = page.locator('user-home-selector dialog')
	await expect(dialog).toBeVisible({ timeout: 15_000 })

	expect(await dialog.evaluate((el) => el.matches(':popover-open'))).toBe(true)
	// The bar keeps its place at the bottom of the grid, under the top layer.
	const bar = await box(nav(page))
	expect(bar.y + bar.height).toBeCloseTo(844, 0)
	const backdrop = await dialog.evaluate(
		(el) => getComputedStyle(el, '::backdrop').backgroundColor,
	)
	expect(backdrop).not.toBe('rgba(0, 0, 0, 0)')
})

test(`@spec ${NAV} "Dashboard icon data attribute for coach mark targeting"`, async ({
	page,
}) => {
	await seedGuest(page, { onboarded: true, home: true })
	await openShell(page, '/discovery')

	await expect(page.locator('.nav-tab[data-nav="home"]')).toHaveAttribute(
		'href',
		/dashboard/,
	)
	await expect(page.locator('.nav-tab[data-nav="my-artists"]')).toHaveAttribute(
		'href',
		/my-artists/,
	)
})

/**
 * The bar's labels, the floating button and where a tap in each tab lands:
 * the label type, the space between neighbouring labels and between a label
 * and the FAB, and the tab hit by each point of a 48 px square centred on it
 * (its centre and the middle of each edge, as .storybook/target-size.ts
 * probes a target).
 */
async function navAt320(page: Page) {
	return page.evaluate(() => {
		const tabs = [...document.querySelectorAll<HTMLElement>('.nav-tab')]
		const labels = tabs.map((t) => t.querySelector('.nav-label') as HTMLElement)
		const boxes = labels.map((l) => l.getBoundingClientRect())
		const fabEl = document.querySelector('fab-menu .fab-toggle') as HTMLElement
		const f = fabEl.getBoundingClientRect()
		const centre = { x: f.left + f.width / 2, y: f.top + f.height / 2 }
		// Distance from a label's box to the FAB's circle.
		const toFab = (r: DOMRect) =>
			Math.hypot(
				Math.max(r.left - centre.x, 0, centre.x - r.right),
				Math.max(r.top - centre.y, 0, centre.y - r.bottom),
			) -
			f.width / 2
		const half = 48 / 2 - 1
		return {
			fontSizes: labels.map((l) => getComputedStyle(l).fontSize),
			gaps: boxes.slice(1).map((b, i) => b.left - boxes[i].right),
			toFab: boxes.map(toFab),
			hits: tabs.flatMap((tab) => {
				const r = tab.getBoundingClientRect()
				const x = r.left + r.width / 2
				const y = r.top + r.height / 2
				return [
					[x, y],
					[x - half, y],
					[x + half, y],
					[x, y - half],
					[x, y + half],
				].map(([px, py]) => {
					const hit = document.elementFromPoint(px, py)
					if (hit && (hit === fabEl || fabEl.contains(hit))) return 'fab'
					return hit && (hit === tab || tab.contains(hit)) ? 'tab' : 'other'
				})
			}),
		}
	})
}

test(`@spec ${NAV} "Bar on a 320 px screen"`, async ({ page }) => {
	await seedSignedInFan(page, { language: 'ja' })
	await page.setViewportSize({ width: 320, height: 844 })
	await openShell(page, '/dashboard')
	await expect(fab(page)).toBeVisible()
	await page.evaluate(() => document.fonts.ready)

	const check = async () => {
		await settle(page, 'fab-menu, bottom-nav-bar')
		await expect
			.poll(async () => (await navAt320(page)).fontSizes)
			.toEqual(['11px', '11px', '11px', '11px'])
		const m = await navAt320(page)
		// No two neighbouring labels touch.
		for (const gap of m.gaps) expect(gap).toBeGreaterThanOrEqual(4)
		// No label touches the floating button.
		for (const d of m.toFab) expect(d).toBeGreaterThan(0)
		// A tap anywhere in a tab's 48 px target lands on that tab, never on
		// the floating button.
		expect(m.hits.every((h) => h === 'tab')).toBe(true)
	}

	// The FAB raised in its notch, then sunk into the bar under a snack.
	await check()
	await publishSnack(page, 'アーティストをフォローしました', 60_000)
	await expect(page.locator('.snack-item')).toBeVisible()
	await check()
})
