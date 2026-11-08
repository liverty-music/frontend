import { installConsole, SERIES } from '../support/organizer'
import type { Page } from '../support/test'
import { expect, test } from '../support/test'

/**
 * The organizer console's type: fixed sizes on any window, tabular figures,
 * and Noto Sans JP on every device, as drawn. Which font drew the text is read
 * from Chromium's DevTools protocol (`CSS.getPlatformFontsForNode`), so this
 * runs in the Chromium `functional` project.
 */

const CAPABILITY =
	'components/infrastructure/organizer/web/global/design-tokens'

interface PlatformFont {
	familyName: string
	isCustomFont: boolean
}

async function openConcerts(page: Page, width: number): Promise<void> {
	await page.setViewportSize({ width, height: 900 })
	await installConsole(page)
	await page.goto(SERIES)
	await expect(page.locator('organizer-shell h1').first()).toBeVisible()
	await page.evaluate(() => document.fonts.ready)
}

/** A script that finds the first match of `selector`, inside shadow roots too. */
const deepQuery = (selector: string) => `(() => {
	const visit = (root) => {
		const hit = root.querySelector(${JSON.stringify(selector)})
		if (hit) return hit
		for (const el of root.querySelectorAll('*')) {
			if (el.shadowRoot) {
				const found = visit(el.shadowRoot)
				if (found) return found
			}
		}
		return null
	}
	return visit(document)
})()`

/** The fonts that drew the text of the first element matching `selector`. */
async function renderedFonts(
	page: Page,
	selector: string,
): Promise<PlatformFont[]> {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('DOM.enable')
	await cdp.send('CSS.enable')
	await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
	const { result } = await cdp.send('Runtime.evaluate', {
		expression: deepQuery(selector),
	})
	if (!result.objectId) throw new Error(`no element ${selector}`)
	const { nodeId } = await cdp.send('DOM.requestNode', {
		objectId: result.objectId,
	})
	const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
	await cdp.detach()
	// The variable Noto Sans JP names itself after its default instance.
	return (fonts as PlatformFont[]).map((f) => ({
		...f,
		familyName: f.familyName.startsWith('Noto Sans JP')
			? 'Noto Sans JP'
			: f.familyName,
	}))
}

/** Font size of the page title and of body text, in px. */
async function sizes(page: Page): Promise<{ title: string; body: string }> {
	return page.evaluate(() => ({
		title: getComputedStyle(
			document.querySelector('organizer-shell h1') ?? document.body,
		).fontSize,
		body: getComputedStyle(document.body).fontSize,
	}))
}

test(`@spec ${CAPABILITY} "Same size on PC and phone"`, async ({ page }) => {
	await openConcerts(page, 1440)
	const pc = await sizes(page)
	await openConcerts(page, 390)
	const phone = await sizes(page)

	expect(pc).toEqual({ title: '24px', body: '14px' })
	expect(phone).toEqual(pc)
})

test(`@spec ${CAPABILITY} "Counts line up"`, async ({ page }) => {
	await openConcerts(page, 1440)

	// Inside a console component's shadow root, where the counts render: the
	// console's shared rules make every digit the same width.
	const widths = await page.evaluate(() => {
		const host = [...document.querySelectorAll('*')].find((el) => el.shadowRoot)
		const root = host?.shadowRoot
		if (!root) throw new Error('no console shadow root')
		const measure = (text: string) => {
			const span = document.createElement('span')
			span.className = 'md-typescale-body-medium'
			span.textContent = text
			root.append(span)
			const width = span.getBoundingClientRect().width
			const numeric = getComputedStyle(span).fontVariantNumeric
			span.remove()
			return { width, numeric }
		}
		return { ones: measure('1111'), zeros: measure('0000') }
	})
	expect(widths.ones.numeric).toBe('tabular-nums')
	expect(widths.ones.width).toBeCloseTo(widths.zeros.width, 1)
})

test(`@spec ${CAPABILITY} "Same typeface on Windows and on a Mac"`, async ({
	page,
}) => {
	await openConcerts(page, 1440)
	// Body text as a console component renders it: a paragraph in a shadow
	// root, Japanese and Latin together.
	await page.evaluate(async () => {
		const host = [...document.querySelectorAll('*')].find((el) => el.shadowRoot)
		const root = host?.shadowRoot
		if (!root) throw new Error('no console shadow root')
		const p = document.createElement('p')
		p.id = 'sample-body'
		p.textContent = '公演の詳細と販売の状況 Sales 2026'
		root.append(p)
		await document.fonts.load('400 14px "Noto Sans JP"', p.textContent)
		await document.fonts.ready
	})

	// The page title and the body text are drawn in the downloaded Noto Sans
	// JP, not in whatever face the device has.
	for (const selector of ['organizer-shell h1', '#sample-body']) {
		const fonts = await renderedFonts(page, selector)
		expect(fonts.length, selector).toBeGreaterThan(0)
		expect(
			fonts.every((f) => f.familyName === 'Noto Sans JP' && f.isCustomFont),
			selector,
		).toBe(true)
	}
})

test(`@spec ${CAPABILITY} "Font cannot be loaded"`, async ({ page }) => {
	await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
	await openConcerts(page, 390)

	const fonts = await renderedFonts(page, 'organizer-shell h1')
	expect(fonts.length).toBeGreaterThan(0)
	expect(fonts.every((f) => !f.isCustomFont)).toBe(true)

	const overflow = await page.evaluate(
		() =>
			document.scrollingElement !== null &&
			document.scrollingElement.scrollWidth >
				document.scrollingElement.clientWidth,
	)
	expect(overflow).toBe(false)
})
