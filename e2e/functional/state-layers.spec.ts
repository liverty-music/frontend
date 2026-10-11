import { expect, type Locator, type Page, test } from '../support/test'

/**
 * The fan app's state layers and motion tokens, read from the real global
 * stylesheet. Hover, focus and press are CSS pseudo-classes that only a real
 * pointer or keyboard sets, so the controls are added to a running app page
 * and driven with Playwright's mouse and keyboard.
 */

const APP = 'http://localhost:9000'

const FIXTURE = `
	<section id="state-fixture" style="display:flex; gap:1rem; padding:2rem; color:oklch(98% 0 0deg); background:oklch(20% 0.04 275deg)">
		<button id="plain" type="button">Plain</button>
		<button id="plain-next" type="button">Next</button>
		<button id="selected" type="button" data-selected-morph aria-pressed="true">Selected</button>
		<button id="pressable" type="button" class="pressable">Press</button>
		<span id="leaving" style="transition: opacity var(--md-duration-short4) var(--md-easing-emphasized-accelerate)">Leaving</span>
	</section>
`

async function openFixture(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto(`${APP}/about`)
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

/** Alphas of the color layers in the computed background-image. */
const imageLayerAlphas = (el: Locator): Promise<number[]> =>
	el
		.evaluate((node) => getComputedStyle(node).backgroundImage)
		.then((image) =>
			[...image.matchAll(/(?:oklab|oklch|color|rgba?)\([^)]*\)/g)].map((m) =>
				alphaOf(m[0]),
			),
		)

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
		expect(await backgroundAlpha(plain)).toBe(0)

		await hover(page, plain)
		await expect.poll(() => backgroundAlpha(plain)).toBeCloseTo(0.08, 5)

		// The value is the shared system token, not a literal of the fan app.
		const token = await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue('--md-sys-state-hover-opacity')
				.trim(),
		)
		expect(Number(token)).toBe(0.08)
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
		await expect.poll(() => backgroundAlpha(plain)).toBe(0)

		// Keyboard focus shows the 10% focus layer.
		await page.keyboard.press('Tab')
		await expect(next).toBeFocused()
		await expect.poll(() => backgroundAlpha(next)).toBeCloseTo(0.1, 5)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Selected state persists and stacks"`, async ({
		page,
	}) => {
		const selected = page.locator('#selected')
		await moveAway(page)
		await expect.poll(() => backgroundAlpha(selected)).toBeCloseTo(0.12, 5)
		expect(await imageLayerAlphas(selected)).toEqual([])

		await hover(page, selected)
		// The selected layer stays and the hover layer is drawn over it.
		await expect
			.poll(async () => {
				const alphas = await imageLayerAlphas(selected)
				return (
					alphas.length > 0 && alphas.every((a) => Math.abs(a - 0.08) < 1e-5)
				)
			})
			.toBe(true)
		expect(await backgroundAlpha(selected)).toBeCloseTo(0.12, 5)
	})

	test(`@spec components/infrastructure/fan/web/global/design-tokens "Press applies the shared 10% overlay"`, async ({
		page,
	}) => {
		const pressable = page.locator('#pressable')
		const layer = () =>
			pressable.evaluate((el) =>
				Number(getComputedStyle(el, '::after').opacity),
			)
		await moveAway(page)
		expect(await layer()).toBe(0)

		await hover(page, pressable)
		await page.mouse.down()
		await expect.poll(layer).toBeCloseTo(0.1, 5)
		await page.mouse.up()
		await expect.poll(layer).toBe(0)
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
