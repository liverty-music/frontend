import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Touch targets on the welcome page, measured the way a tap finds them: the
 * browser's hit test at the centre and just inside the middle of each edge
 * of a 48 × 48 px square centred on the control lands on that control (a
 * transparent `::after` target hit-tests as its element). The component
 * stories measure the same with `.storybook/target-size.ts`.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })

const WELCOME = 'components/infrastructure/fan/web/route/welcome'

/** The probes of the 48 px square that miss `control`, as text. */
function missedTaps(control: Locator): Promise<string[]> {
	return control.evaluate((el) => {
		el.scrollIntoView({ block: 'center' })
		const r = el.getBoundingClientRect()
		const cx = r.left + r.width / 2
		const cy = r.top + r.height / 2
		const half = 23
		const probes: Array<[number, number]> = [
			[cx, cy],
			[cx - half, cy],
			[cx + half, cy],
			[cx, cy - half],
			[cx, cy + half],
		]
		return probes
			.filter(([x, y]) => {
				const hit = document.elementFromPoint(x, y)
				return !(hit && (hit === el || el.contains(hit)))
			})
			.map(([x, y]) => `(${Math.round(x)}, ${Math.round(y)})`)
	})
}

async function openWelcome(page: Page, query = ''): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto(`/welcome${query}`)
	await expect(page.locator('welcome-route')).toBeVisible({ timeout: 30_000 })
}

test(`@spec ${WELCOME} "Scroll affordance button is rendered when preview is available"`, async ({
	page,
}) => {
	// The dev server's static preview data renders the demo and its cue.
	await openWelcome(page, '?devPreview=1')
	const cue = page.locator('.welcome-scroll-action')
	await expect(cue).toBeVisible()
	// A labelled <button>.
	expect(await cue.evaluate((el) => el.tagName)).toBe('BUTTON')
	await expect(cue).toHaveAccessibleName(/\S/)
	// The Material 3 small button: 40 px to see, 48 px to tap (its ::after).
	expect((await cue.boundingBox())?.height).toBe(40)
	expect(await missedTaps(cue)).toEqual([])
	// The Tab key reaches it, and it shows the focus ring.
	let reached = false
	for (let i = 0; i < 30 && !reached; i++) {
		await page.keyboard.press('Tab')
		reached = await cue.evaluate((el) => el === document.activeElement)
	}
	expect(reached).toBe(true)
	const ring = await cue.evaluate((el) => {
		const style = getComputedStyle(el)
		return { style: style.outlineStyle, width: style.outlineWidth }
	})
	expect(ring).toEqual({ style: 'solid', width: '3px' })
})

// The 48 px part of welcome "Link below Log In"; its place below Log In is
// checked in test/routes/welcome-cant-sign-in.spec.ts.
test('the link below Log In takes a 48 px tap', async ({ page }) => {
	// No preview data: Screen 1 shows Log In and the help link below it.
	await openWelcome(page)
	const link = page.getByTestId('welcome-cant-sign-in').first()
	await expect(link).toBeVisible()
	expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(48)
})

test('the two language choices each take a 48 px tap of their own', async ({
	page,
}) => {
	await openWelcome(page)
	const labels = page.locator('.welcome-lang-label')
	await expect(labels).toHaveCount(2)
	for (const label of await labels.all()) {
		expect(await missedTaps(label)).toEqual([])
	}
})
