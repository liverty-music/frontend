import { openShell, seedSignedInFan } from '../support/fan-shell'
import { installConsole, SERIES } from '../support/organizer'
import { expect, type Page, test } from '../support/test'

/**
 * One keyboard focus ring in both apps: a real keyboard tabs through a real
 * screen, and every element that takes focus shows the shared ring (3 px, in
 * the app's ring colour, 2 px outside the element). A pointer click shows
 * none. The ring colour reaches 3:1 against every surface tier.
 *
 * A few controls draw the ring for something else, and are where the ring
 * is looked for: a field around its input, a chip around its hidden
 * checkbox. A few draw it inside their edges because they reach both sides
 * of their container (a menu item, a list row, the console's page area); the
 * offset is then minus the thickness.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

const FAN_TOKENS = 'components/infrastructure/fan/web/global/design-tokens'
const CONSOLE_TOKENS =
	'components/infrastructure/organizer/web/global/design-tokens'

interface Ring {
	/** What took focus, for the failure message. */
	focused: string
	/** The element that draws the ring (the focused one or a field around it). */
	holder: string
	style: string
	width: string
	offset: string
	color: string
	/** The app's ring colour, resolved the way the outline colour is. */
	token: string
}

/**
 * The ring around the element that has focus now, looking through shadow
 * roots, on it or on the nearest of three ancestors that draws one (a field
 * or a chip around a control it stands for). Null when nothing draws one.
 */
function focusedRing(page: Page): Promise<Ring | null> {
	return page.evaluate(() => {
		let active: Element | null = document.activeElement
		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement
		}
		if (!active || active === document.body) return null
		const name = (el: Element) =>
			`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`
		// The ring colour is a root token in both apps, so a probe in the
		// document body resolves it as the holder does.
		const resolve = (value: string) => {
			const probe = document.createElement('span')
			probe.style.color = value
			document.body.append(probe)
			const color = getComputedStyle(probe).color
			probe.remove()
			return color
		}
		const parent = (el: Element): Element | null =>
			el.parentElement ??
			((el.getRootNode() as ShadowRoot).host as Element | undefined) ??
			null
		// A label chip and a hype dot draw the ring for a hidden radio on a
		// sibling or a child; search the focused element's label too.
		const candidates: Element[] = []
		let el: Element | null = active
		for (let i = 0; el && i < 4; i++, el = parent(el)) {
			candidates.push(el)
			if (el.tagName === 'LABEL') {
				candidates.push(...el.querySelectorAll(':scope > *'))
			}
		}
		const holder = candidates.find(
			(c) => getComputedStyle(c).outlineStyle !== 'none',
		)
		if (!holder) {
			return {
				focused: name(active),
				holder: '',
				style: 'none',
				width: '',
				offset: '',
				color: '',
				token: '',
			}
		}
		const style = getComputedStyle(holder)
		const token = style.getPropertyValue('--md-sys-color-focus-indicator')
		return {
			focused: name(active),
			holder: name(holder),
			style: style.outlineStyle,
			width: style.outlineWidth,
			offset: style.outlineOffset,
			color: style.outlineColor,
			token: resolve(token),
		}
	})
}

/** Tab `presses` times and read the ring after each press. */
async function tabThrough(page: Page, presses: number): Promise<Ring[]> {
	const rings: Ring[] = []
	for (let i = 0; i < presses; i++) {
		await page.keyboard.press('Tab')
		const ring = await focusedRing(page)
		if (ring) rings.push(ring)
	}
	return rings
}

function expectSharedRing(rings: Ring[]): void {
	expect(rings.length).toBeGreaterThan(5)
	for (const ring of rings) {
		const where = `${ring.focused} (ring on ${ring.holder || 'nothing'})`
		expect(ring.style, where).toBe('solid')
		expect(ring.width, where).toBe('3px')
		expect(ring.color, where).toBe(ring.token)
		// Outside the element, or inside one that reaches both sides of its
		// container.
		expect(['2px', '-3px'], where).toContain(ring.offset)
	}
	// Most controls carry it outside.
	const outside = rings.filter((r) => r.offset === '2px').length
	expect(outside / rings.length).toBeGreaterThan(0.5)
}

/** WCAG contrast of the ring colour against each surface tier the app defines. */
function ringContrastOnSurfaces(page: Page): Promise<Record<string, number>> {
	return page.evaluate(() => {
		const rgb = (value: string): [number, number, number] => {
			const probe = document.createElement('span')
			probe.style.color = value
			document.body.append(probe)
			const ctx = document.createElement('canvas').getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			ctx.fillStyle = getComputedStyle(probe).color
			probe.remove()
			ctx.fillRect(0, 0, 1, 1)
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
			return [r, g, b]
		}
		const lum = (c: [number, number, number]) => {
			const [r, g, b] = c.map((v) => {
				const s = v / 255
				return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
			})
			return 0.2126 * r + 0.7152 * g + 0.0722 * b
		}
		const ratio = (a: string, b: string) => {
			const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x)
			return (hi + 0.05) / (lo + 0.05)
		}
		const root = getComputedStyle(document.documentElement)
		const out: Record<string, number> = {}
		for (const tier of [
			'surface',
			'surface-container-lowest',
			'surface-container-low',
			'surface-container',
			'surface-container-high',
			'surface-container-highest',
		]) {
			if (root.getPropertyValue(`--md-sys-color-${tier}`).trim() === '')
				continue
			out[tier] = ratio(
				'var(--md-sys-color-focus-indicator)',
				`var(--md-sys-color-${tier})`,
			)
		}
		return out
	})
}

/** A real pointer click on `selector`'s centre. */
async function click(page: Page, selector: string): Promise<void> {
	const target = page.locator(selector).first()
	await target.scrollIntoViewIfNeeded()
	const box = await target.boundingBox()
	if (!box) throw new Error(`${selector} not laid out`)
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.describe('fan app', () => {
	test.use({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })

	test.beforeEach(async ({ page }) => {
		await seedSignedInFan(page, { language: 'ja' })
		await openShell(page, '/settings')
		await expect(page.locator('settings-route')).toBeVisible()
	})

	test(`@spec ${FAN_TOKENS} "Tabbing through a screen"`, async ({ page }) => {
		expectSharedRing(await tabThrough(page, 30))
	})

	test(`@spec ${FAN_TOKENS} "Pointer click"`, async ({ page }) => {
		const button = 'settings-route .settings-expand'
		await click(page, button)
		const style = await page
			.locator(button)
			.first()
			.evaluate((el) => ({
				focused: el === document.activeElement,
				outline: getComputedStyle(el).outlineStyle,
			}))
		expect(style.focused).toBe(true)
		expect(style.outline).toBe('none')
	})

	test('the ring colour reaches 3:1 on every surface tier', async ({
		page,
	}) => {
		const ratios = await ringContrastOnSurfaces(page)
		expect(Object.keys(ratios).length).toBe(6)
		for (const [tier, ratio] of Object.entries(ratios)) {
			expect(ratio, tier).toBeGreaterThanOrEqual(3)
		}
	})
})

test.describe('organizer console', () => {
	for (const scheme of ['light', 'dark'] as const) {
		test.describe(`${scheme}`, () => {
			test.beforeEach(async ({ page }) => {
				await page.setViewportSize({ width: 1440, height: 900 })
				await page.emulateMedia({ colorScheme: scheme })
				await installConsole(page)
				await page.goto(SERIES)
				await expect(page.locator('organizer-shell h1').first()).toBeVisible()
			})

			test(`@spec ${CONSOLE_TOKENS} "Tabbing through a console screen" (${scheme})`, async ({
				page,
			}) => {
				expectSharedRing(await tabThrough(page, 30))
			})

			test(`@spec ${CONSOLE_TOKENS} "Pointer click" (${scheme})`, async ({
				page,
			}) => {
				// The first button of the page, in its component's shadow root.
				const target = page.locator('organizer-shell').getByRole('button')
				const first = target.first()
				const box = await first.boundingBox()
				if (!box) throw new Error('no button laid out')
				await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
				const ring = await focusedRing(page)
				expect(ring?.focused).toMatch(/^button/)
				expect(ring?.style).toBe('none')
			})
		})
	}
})
