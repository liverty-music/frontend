import type { Page } from '@playwright/test'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The fan app's typefaces, as the browser actually draws them. Runs on the
 * Pixel 7 and iPhone 14 profiles (`typefaces-pixel7`, `typefaces-iphone`), both
 * on Chromium: which font drew a glyph is only reported by Chromium's DevTools
 * protocol (`CSS.getPlatformFontsForNode`).
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/design-tokens'

const BODY = '公演の詳細と会場へのアクセスを確認できます'
const HEADLINE = 'Liverty 公演の詳細 2026'

interface PlatformFont {
	familyName: string
	isCustomFont: boolean
	glyphCount: number
}

/** Opens /welcome and adds a body paragraph and a headline-small heading. */
async function openWithSamples(page: Page) {
	await page.goto('/welcome')
	await page.evaluate(
		({ body, headline }) => {
			const p = document.createElement('p')
			p.id = 'sample-body'
			p.textContent = body
			const h = document.createElement('h2')
			h.id = 'sample-headline'
			h.className = 'md-typescale-headline-small'
			h.textContent = headline
			document.body.append(p, h)
		},
		{ body: BODY, headline: HEADLINE },
	)
	// Web fonts load when text needs them; wait for the ones these samples use.
	await page.evaluate(async (text) => {
		await Promise.all([
			document.fonts.load('400 16px "Noto Sans JP"', text),
			document.fonts.load('400 24px "Righteous"', 'Liverty 2026'),
		])
		await document.fonts.ready
	}, BODY + HEADLINE)
}

/** The fonts that drew the text of the element matching `selector`. */
async function renderedFonts(
	page: Page,
	selector: string,
): Promise<PlatformFont[]> {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('DOM.enable')
	await cdp.send('CSS.enable')
	const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
	const { nodeId } = await cdp.send('DOM.querySelector', {
		nodeId: root.nodeId,
		selector,
	})
	const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
	await cdp.detach()
	// The variable Noto Sans JP names itself after its default instance
	// ("Noto Sans JP Thin"); every weight is the same family.
	return (fonts as PlatformFont[]).map((f) => ({
		...f,
		familyName: f.familyName.startsWith('Noto Sans JP')
			? 'Noto Sans JP'
			: f.familyName,
	}))
}

test(`@spec ${CAPABILITY} "Japanese text looks the same on every device"`, async ({
	page,
}) => {
	await openWithSamples(page)

	const fonts = await renderedFonts(page, '#sample-body')
	expect(fonts.map((f) => f.familyName)).toEqual(['Noto Sans JP'])
	expect(fonts[0].isCustomFont).toBe(true)
})

test(`@spec ${CAPABILITY} "Japanese in a headline"`, async ({ page }) => {
	await openWithSamples(page)

	const fonts = await renderedFonts(page, '#sample-headline')
	const byFamily = Object.fromEntries(
		fonts.map((f) => [f.familyName, f.glyphCount]),
	)
	// Latin letters and digits (and the spaces between them) in Righteous;
	// the kana and kanji, which Righteous lacks, in Noto Sans JP.
	expect(Object.keys(byFamily).sort()).toEqual(['Noto Sans JP', 'Righteous'])
	expect(byFamily['Noto Sans JP']).toBe([...'公演の詳細'].length)
})

test(`@spec ${CAPABILITY} "Offline"`, async ({ page }) => {
	// The font files cannot be fetched and none is cached.
	await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
	await page.goto('/welcome')
	await page.evaluate((body) => {
		const p = document.createElement('p')
		p.id = 'sample-body'
		p.textContent = body
		document.body.append(p)
	}, BODY)
	await page.evaluate(() => document.fonts.ready)

	const fonts = await renderedFonts(page, '#sample-body')
	// Drawn in a font installed on the device, not a downloaded web font (a
	// device may itself have Noto Sans JP installed, which is then used).
	expect(fonts.length).toBeGreaterThan(0)
	expect(fonts.every((f) => !f.isCustomFont)).toBe(true)

	// The layout stays usable: the text has a size and nothing overflows the
	// width of the screen.
	const sample = await page.locator('#sample-body').boundingBox()
	expect(sample?.width ?? 0).toBeGreaterThan(0)
	const overflow = await page.evaluate(
		() =>
			document.scrollingElement !== null &&
			document.scrollingElement.scrollWidth >
				document.scrollingElement.clientWidth,
	)
	expect(overflow).toBe(false)
})
