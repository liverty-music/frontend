import { expect, type Locator, type Page, test } from '../support/test'

/**
 * The fan app's state layers and motion tokens, read from the real global
 * stylesheet. Hover, focus and press are CSS pseudo-classes that only a real
 * pointer or keyboard sets, so the controls are added to a running app page
 * and driven with Playwright's mouse and keyboard.
 */

const FIXTURE = `
	<section id="state-fixture" style="display:flex; gap:1rem; padding:2rem; color:oklch(98% 0 0deg); background:oklch(20% 0.04 275deg)">
		<button id="bare" type="button">Bare</button>
		<button id="plain" type="button" class="state-layer">Plain</button>
		<button id="plain-next" type="button" class="state-layer">Next</button>
		<button id="selected" type="button" class="state-layer" data-selected-morph aria-pressed="true">Selected</button>
		<button id="disabled" type="button" class="state-layer" disabled>Disabled</button>
		<span id="leaving" style="transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized-accelerate)">Leaving</span>
	</section>
`

async function openFixture(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto(`/about`)
	await page.locator('au-viewport').first().waitFor({ timeout: 10000 })
	await page.evaluate((html) => {
		document.body.insertAdjacentHTML('afterbegin', html)
	}, FIXTURE)
}

/** Alpha of a computed color (`oklab(… / 0.08)`, `rgba(0, 0, 0, 0)`, …). */
function alphaOf(color: string): number {
	const slash = color.match(/\/\s*([\d.]+)\s*\)$/)
	if (slash) return Number(slash[1])
	const rgba = color.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/)
	if (rgba) return Number(rgba[1])
	return 1
}

const backgroundAlpha = (el: Locator): Promise<number> =>
	el.evaluate((node) => getComputedStyle(node).backgroundColor).then(alphaOf)

/** Opacity of the shared state layer (`::before`). */
const layer = (el: Locator): Promise<number> =>
	el.evaluate((node) => Number(getComputedStyle(node, '::before').opacity))

async function hover(page: Page, el: Locator): Promise<void> {
	const box = await el.boundingBox()
	if (!box) throw new Error('target not laid out')
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function moveAway(page: Page): Promise<void> {
	const box = await page.locator('#state-fixture').boundingBox()
	if (!box) throw new Error('fixture not laid out')
	// Inside the fixture's padding, over no control.
	await page.mouse.move(box.x + 4, box.y + 4)
}

test.describe('state layers and motion tokens', () => {
	test.beforeEach(async ({ page }) => {
		await openFixture(page)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Hover applies the shared 8% overlay"`, async ({
		page,
	}) => {
		const plain = page.locator('#plain')
		await moveAway(page)
		expect(await layer(plain)).toBe(0)

		await hover(page, plain)
		await expect.poll(() => layer(plain)).toBeCloseTo(0.08, 5)
		// The layer is the content colour over the control, not a new fill.
		expect(await backgroundAlpha(plain)).toBe(0)

		// The value is the shared system token, not a literal of the fan app.
		const token = await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue('--md-sys-state-hover-opacity')
				.trim(),
		)
		expect(Number(token)).toBe(0.08)

		// A control without the `state-layer` class draws none, and a disabled
		// one shows none.
		const bare = page.locator('#bare')
		await hover(page, bare)
		expect(
			await bare.evaluate((el) => getComputedStyle(el, '::before').content),
		).toBe('none')
		expect(await backgroundAlpha(bare)).toBe(0)
		await hover(page, page.locator('#disabled'))
		expect(await layer(page.locator('#disabled'))).toBe(0)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Keyboard focus uses focus-visible"`, async ({
		page,
	}) => {
		const plain = page.locator('#plain')
		const next = page.locator('#plain-next')

		// A mouse click focuses the button but leaves no layer once the
		// pointer has moved away.
		await plain.click()
		await moveAway(page)
		await expect(plain).toBeFocused()
		await expect.poll(() => layer(plain)).toBe(0)

		// Keyboard focus shows the 10% focus layer.
		await page.keyboard.press('Tab')
		await expect(next).toBeFocused()
		await expect.poll(() => layer(next)).toBeCloseTo(0.1, 5)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Selected state persists and stacks"`, async ({
		page,
	}) => {
		const selected = page.locator('#selected')
		await moveAway(page)
		await expect.poll(() => backgroundAlpha(selected)).toBeCloseTo(0.12, 5)
		expect(await layer(selected)).toBe(0)

		await hover(page, selected)
		// The selected layer stays and the hover layer is drawn over it.
		await expect.poll(() => layer(selected)).toBeCloseTo(0.08, 5)
		expect(await backgroundAlpha(selected)).toBeCloseTo(0.12, 5)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Press applies the shared 10% overlay"`, async ({
		page,
	}) => {
		const plain = page.locator('#plain')
		await moveAway(page)
		expect(await layer(plain)).toBe(0)

		await hover(page, plain)
		await page.mouse.down()
		await expect.poll(() => layer(plain)).toBeCloseTo(0.1, 5)
		// Material 3 scales no pressed control.
		expect(await plain.evaluate((el) => getComputedStyle(el).transform)).toBe(
			'none',
		)
		await page.mouse.up()
		await expect.poll(() => layer(plain)).toBeCloseTo(0.08, 5)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Leaving element accelerates"`, async ({
		page,
	}) => {
		const easing = await page
			.locator('#leaving')
			.evaluate((el) => getComputedStyle(el).transitionTimingFunction)
		expect(easing).toBe('cubic-bezier(0.3, 0, 0.8, 0.15)')
	})
})
