import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

const PRIMITIVES = 'components/infrastructure/fan/web/global/ui-primitives'

test(`@spec ${PRIMITIVES} "License text opens"`, async ({ page }) => {
	await page.goto('/legal/licenses')
	const details = page.locator('licenses-route details.licenses-text').first()
	await details.waitFor({ timeout: 30_000 })
	const closed = (await details.boundingBox())?.height ?? 0

	// Open it and sample its height every frame until it stops changing: it
	// grows through heights between closed and open, not in one step.
	await details.locator('summary').click()
	const heights = await details.evaluate(
		(el) =>
			new Promise<number[]>((resolve) => {
				const seen: number[] = []
				const tick = () => {
					seen.push(el.getBoundingClientRect().height)
					if (seen.length < 40) requestAnimationFrame(tick)
					else resolve(seen)
				}
				requestAnimationFrame(tick)
			}),
	)
	const open = heights[heights.length - 1]
	expect(open).toBeGreaterThan(closed + 50)
	const between = heights.filter((h) => h > closed + 1 && h < open - 1)
	expect(between.length).toBeGreaterThan(2)
})
