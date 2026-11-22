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
		const centre = document.elementFromPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2,
		)
		return {
			image: style.backgroundImage,
			pointerEvents: style.pointerEvents,
			coversWidth: rect.width >= window.innerWidth - 1,
			// Whatever sits at the centre of the screen, it is not the starfield.
			onTop: centre === el,
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
	// It never takes a tap and is never drawn over the content.
	expect(look.pointerEvents).toBe('none')
	expect(look.onTop).toBe(false)
})
