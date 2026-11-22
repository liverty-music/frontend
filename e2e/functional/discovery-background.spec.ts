import { openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * Discovery's background: a starfield behind the bubbles that adds depth
 * without drawing the eye or the finger away from them.
 */

const DISCOVERY = 'components/infrastructure/fan/web/route/discovery'

test(`@spec ${DISCOVERY} "Background visual depth"`, async ({ page }) => {
	await seedSignedInFan(page)
	await openShell(page, '/discovery')

	const starfield = page.locator('discovery-starfield')
	await expect(starfield).toBeAttached()
	await expect(starfield).toHaveAttribute('aria-hidden', 'true')

	const look = await starfield.evaluate((el) => {
		const style = getComputedStyle(el)
		const rect = el.getBoundingClientRect()
		// Paint order: let the starfield be hit-tested for a moment, then ask
		// what lies at the centre of each visible element after it in the
		// layout, topmost first. Each must be painted above the starfield.
		const pointerEvents = style.pointerEvents
		;(el as HTMLElement).style.pointerEvents = 'auto'
		const covered: string[] = []
		let checked = 0
		for (const sibling of [...(el.parentElement?.children ?? [])]) {
			if (
				!(
					el.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING
				)
			)
				continue
			const box = sibling.getBoundingClientRect()
			// Skip what paints nothing: hidden rows and visually-hidden live regions
			// (a clipped 1 px box).
			if (box.width < 2 || box.height < 2) continue
			const stack = document.elementsFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2,
			)
			const content = stack.findIndex((n) => sibling.contains(n))
			const stars = stack.indexOf(el)
			checked++
			if (stars !== -1 && (content === -1 || stars < content)) {
				covered.push(sibling.tagName.toLowerCase())
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

	// Depth: many small star gradients over the whole layout.
	expect(look.coversWidth).toBe(true)
	expect(
		look.image.match(/radial-gradient/g)?.length ?? 0,
	).toBeGreaterThanOrEqual(5)
	// Subtle: every star is a dot of at most 1.5 px and at most 50% white.
	const sizes = [...look.image.matchAll(/radial-gradient\(([\d.]+)px/g)].map(
		([, size]) => Number(size),
	)
	const alphas = [...look.image.matchAll(/\/\s*([\d.]+)\)/g)].map(([, alpha]) =>
		Number(alpha),
	)
	expect(sizes.length).toBeGreaterThanOrEqual(5)
	expect(alphas.length).toBeGreaterThanOrEqual(5)
	expect(Math.max(...sizes)).toBeLessThanOrEqual(1.5)
	expect(Math.max(...alphas)).toBeLessThanOrEqual(0.5)
	// It never takes a tap and is drawn under every element after it.
	expect(look.pointerEvents).toBe('none')
	expect(look.checked).toBeGreaterThanOrEqual(2)
	expect(look.covered).toEqual([])
})
