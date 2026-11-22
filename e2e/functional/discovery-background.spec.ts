import { openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * Discovery's background: a starfield behind the rows that adds depth without
 * drawing the eye or the finger away from them. Its twinkle animates opacity,
 * which paints it with the positioned elements, so every row after it must be
 * positioned; each test below brings in the rows only its mode shows.
 */

const DISCOVERY = 'components/infrastructure/fan/web/route/discovery'

interface Look {
	image: string
	pointerEvents: string
	coversWidth: boolean
	/** The rendered boxes after the starfield that were checked. */
	checked: string[]
	/** Those the starfield is painted over. */
	covered: string[]
}

/** Read the starfield's look and which rows it is painted under. */
function look(page: Page): Promise<Look> {
	return page.locator('discovery-starfield').evaluate((el) => {
		const style = getComputedStyle(el)
		const rect = el.getBoundingClientRect()
		// Paint order: let the starfield be hit-tested for a moment, then ask
		// what lies at the centre of each visible box after it in the layout,
		// topmost first. Each must be painted above the starfield.
		const pointerEvents = style.pointerEvents
		;(el as HTMLElement).style.pointerEvents = 'auto'
		const checked: string[] = []
		const covered: string[] = []
		const name = (n: Element) =>
			n.classList[0] ? `.${n.classList[0]}` : n.tagName.toLowerCase()
		// The boxes that render: a `display: contents` host has none of its own,
		// so its children stand in for it.
		const rendered = (n: Element): Element[] =>
			getComputedStyle(n).display === 'contents'
				? [...n.children].flatMap(rendered)
				: [n]
		const after = [...(el.parentElement?.children ?? [])].filter(
			(n) => el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING,
		)
		for (const box of after.flatMap(rendered)) {
			const r = box.getBoundingClientRect()
			// Skip what paints nothing: rows another view hides, and
			// visually-hidden live regions (a clipped 1 px box).
			if (
				r.width < 2 ||
				r.height < 2 ||
				!box.checkVisibility({
					visibilityProperty: true,
					opacityProperty: true,
				})
			)
				continue
			const stack = document.elementsFromPoint(
				r.left + r.width / 2,
				r.top + r.height / 2,
			)
			const content = stack.findIndex((n) => box.contains(n))
			const stars = stack.indexOf(el)
			checked.push(name(box))
			if (stars !== -1 && (content === -1 || stars < content)) {
				covered.push(name(box))
			}
		}
		;(el as HTMLElement).style.pointerEvents = ''
		return {
			image: style.backgroundImage,
			pointerEvents,
			coversWidth: rect.width >= window.innerWidth - 1,
			checked,
			covered,
		}
	})
}

/** The starfield is under every row in view, the `rows` named among them. */
async function expectUnderRows(page: Page, rows: string[]): Promise<void> {
	const seen = await look(page)
	expect(seen.checked).toEqual(expect.arrayContaining(rows))
	expect(seen.covered).toEqual([])
}

test(`@spec ${DISCOVERY} "Background visual depth"`, async ({ page }) => {
	await seedSignedInFan(page)
	await openShell(page, '/discovery')

	const starfield = page.locator('discovery-starfield')
	await expect(starfield).toBeAttached()
	await expect(starfield).toHaveAttribute('aria-hidden', 'true')
	const seen = await look(page)

	// Depth: many small star gradients over the whole layout.
	expect(seen.coversWidth).toBe(true)
	// Subtle: every star is a dot of at most 1.5 px and at most 50% white.
	const sizes = [...seen.image.matchAll(/radial-gradient\(([\d.]+)px/g)].map(
		([, size]) => Number(size),
	)
	const alphas = [...seen.image.matchAll(/\/\s*([\d.]+)\)/g)].map(([, alpha]) =>
		Number(alpha),
	)
	expect(sizes.length).toBeGreaterThanOrEqual(5)
	expect(alphas.length).toBeGreaterThanOrEqual(5)
	expect(Math.max(...sizes)).toBeLessThanOrEqual(1.5)
	expect(Math.max(...alphas)).toBeLessThanOrEqual(0.5)
	// It never takes a tap and is drawn under the rows of the Artists view.
	expect(seen.pointerEvents).toBe('none')
	await expectUnderRows(page, ['.search-bar', '.genre-bar', '.bubble-area'])
})

test(`@spec ${DISCOVERY} "Background visual depth" (onboarding and search)`, async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'false')
		localStorage.setItem('guest.home', 'JP-13')
	})
	await page.goto('/discovery')
	await expect(page.locator('onboarding-progress')).toBeVisible({
		timeout: 30_000,
	})
	await expectUnderRows(page, ['.search-bar', '.genre-bar', '.progress-row'])

	await page.locator('.search-input').fill('a')
	await expect(page.locator('.search-results')).toBeVisible()
	await expectUnderRows(page, ['.search-bar', '.search-results'])
})

test(`@spec ${DISCOVERY} "Background visual depth" (Concerts view)`, async ({
	page,
}) => {
	await seedSignedInFan(page)
	await openShell(page, '/discovery?view=concerts')
	await expect(page.locator('discovery-concerts')).toBeAttached()
	await expectUnderRows(page, ['.concerts-view', '.swap-tile-slot'])
})
