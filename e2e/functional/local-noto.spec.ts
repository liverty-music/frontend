import type { Page } from '@playwright/test'
import { expect, test } from '../support/test'

/**
 * The installed Noto before a download (shared/styles/m3-sys.css, the
 * `Local Noto Sans JP` face). Runs in `functional` (Chromium) and
 * `webkit-shell` (WebKit, iPhone 14). Whether Chromium finds a local Noto
 * depends on the machine: with the variable Noto Sans JP installed (the
 * NotoSansJP-VF.ttf Windows ships) the first test runs, otherwise it is
 * skipped and the download is checked instead.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

const CAPABILITY = 'components/infrastructure/fan/web/global/design-tokens'

const TEXT = '公演の詳細と会場へのアクセスを確認できます'

/** Whether a font answering to this `local()` name is installed. */
function hasLocal(page: Page, name: string): Promise<boolean> {
	return page.evaluate(
		(n) =>
			new FontFace('probe', `local("${n}")`).load().then(
				() => true,
				() => false,
			),
		name,
	)
}

/**
 * Opens /welcome, adds regular and bold Japanese text in the plain typeface,
 * waits for its fonts, and returns the Noto Sans JP files fetched meanwhile.
 */
async function openAndCollectNotoDownloads(page: Page): Promise<string[]> {
	const fetched: string[] = []
	page.on('request', (request) => {
		// Google Fonts serves Noto Sans JP from /s/notosansjp/.
		if (/fonts\.gstatic\.com\/s\/notosansjp\//.test(request.url()))
			fetched.push(request.url())
	})
	await page.goto('/welcome')
	await page.evaluate(async (text) => {
		for (const weight of ['400', '700']) {
			const p = document.createElement('p')
			p.className = 'md-typescale-body-large'
			p.style.fontWeight = weight
			p.textContent = text
			document.body.append(p)
		}
		await document.fonts.ready
	}, TEXT)
	return fetched
}

test(`@spec ${CAPABILITY} "Windows with Noto Sans JP installed"`, async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'Safari does not use local() fonts')
	await page.goto('/welcome')
	test.skip(
		!(await hasLocal(page, 'Noto Sans JP')),
		'no variable Noto Sans JP installed on this machine',
	)

	const fetched = await openAndCollectNotoDownloads(page)
	expect(fetched).toEqual([])
	// The alias draws both weights: it is loaded at 400 and at 700.
	const loaded = await page.evaluate(() =>
		[...document.fonts]
			.filter((f) => f.family === '"Local Noto Sans JP"')
			.map((f) => f.status),
	)
	expect(loaded).toEqual(['loaded'])
	expect(
		await page.evaluate((text) => {
			return (
				document.fonts.check('400 16px "Local Noto Sans JP"', text) &&
				document.fonts.check('700 16px "Local Noto Sans JP"', text)
			)
		}, TEXT),
	).toBe(true)
})

test(`@spec ${CAPABILITY} "iPhone"`, { tag: '@webkit' }, async ({
	page,
	browserName,
}) => {
	// Safari draws no local() font it does not ship, and Apple devices have no
	// Noto; Chromium on a machine without the variable Noto behaves the same.
	await page.goto('/welcome')
	test.skip(
		browserName === 'chromium' && (await hasLocal(page, 'Noto Sans JP')),
		'this machine has a variable Noto Sans JP installed',
	)

	const fetched = await openAndCollectNotoDownloads(page)
	expect(fetched.length).toBeGreaterThan(0)
})
