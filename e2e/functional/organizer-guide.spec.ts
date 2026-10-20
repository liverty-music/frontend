import { readFileSync } from 'node:fs'
import { installConsole, type RpcMocks, SERIES } from '../support/organizer'
import {
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The members' guide and the console's way to it: the guide page on a phone,
 * and 使い方 in the top bar, which opens the guide at the screen's chapter in a
 * new tab. The guide is served at /guide.html by the organizer image; on the
 * dev server its source is at /organizer/guide/guide.html, so the new tab is
 * answered from that file.
 */

const GUIDE_SPEC = 'components/infrastructure/organizer/web/route/guide'
const SHELL_SPEC =
	'components/infrastructure/organizer/web/global/organizer-shell'

const GUIDE = readFileSync(
	new URL('../../organizer/guide/guide.html', import.meta.url),
	'utf8',
)

const RPC: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1103', []),
	'ScannerService/ListByEvent': { scanners: [] },
}

async function open(page: Page, path: string) {
	await installConsole(page, { rpc: RPC, language: 'ja' })
	await page.context().route('**/guide.html', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			body: GUIDE,
		}),
	)
	await page.goto(path)
}

test(`@spec ${GUIDE_SPEC} "Opened on a phone"`, async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/organizer/guide/guide.html')
	await expect(
		page.getByRole('heading', { level: 1, name: '主催者コンソールの使い方' }),
	).toBeVisible()

	const { scrollWidth, clientWidth } = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}))
	expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
	// No chapter is wider than the window either.
	for (const section of await page.locator('main > section').all()) {
		const box = await section.boundingBox()
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
	}
})

test(`@spec ${SHELL_SPEC} "Help while editing"`, async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page, `${SERIES}/s-tour/edit`)
	const title = page.getByLabel('公演名')
	await expect(title).toBeVisible()
	await title.fill('XX Tour 2026 追加公演')

	let dialogs = 0
	page.on('dialog', (dialog) => {
		dialogs++
		void dialog.dismiss()
	})
	const [guide] = await Promise.all([
		page.context().waitForEvent('page'),
		page.getByRole('banner').getByRole('link', { name: '使い方' }).click(),
	])
	await guide.waitForLoadState()

	expect(new URL(guide.url()).pathname).toBe('/guide.html')
	expect(new URL(guide.url()).hash).toBe('#publish')
	await expect(
		guide.getByRole('heading', { level: 2, name: '公演をつくって公開する' }),
	).toBeInViewport()

	// The console's tab kept the editor and what was typed, with no dialog.
	expect(dialogs).toBe(0)
	await expect(
		page.getByRole('dialog', { name: '変更を破棄しますか？' }),
	).toHaveCount(0)
	await expect(page).toHaveURL(/\/series\/s-tour\/edit$/)
	await expect(title).toHaveValue('XX Tour 2026 追加公演')
})

test(`@spec ${SHELL_SPEC} "Help on a phone"`, async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await open(page, `${SERIES}/s-tour/events/e-1103/ticket-sales`)
	await expect(
		page.getByRole('heading', { level: 1, name: /11月3日\(火\)/ }),
	).toBeVisible()

	const bar = page.getByRole('banner')
	const parts = {
		back: bar.getByTestId('back'),
		title: bar.locator('.title'),
		help: bar.getByRole('link', { name: '使い方' }),
		account: bar.getByRole('button', { name: 'アカウント' }),
	}
	const boxes = []
	for (const [name, part] of Object.entries(parts)) {
		await expect(part, name).toBeAttached()
		const box = await part.boundingBox()
		expect(box, name).not.toBeNull()
		if (!box) return
		boxes.push({ name, ...box })
	}
	// In this order along the bar, none overlapping, all inside the window.
	for (let i = 1; i < boxes.length; i++) {
		const [prev, next] = [boxes[i - 1], boxes[i]]
		expect(
			prev.x + prev.width,
			`${prev.name} | ${next.name}`,
		).toBeLessThanOrEqual(next.x)
	}
	const last = boxes.at(-1)
	expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(390)
	// The targets keep their 48 px.
	for (const { name, width, height } of boxes) {
		if (name === 'title') continue
		expect([width, height], name).toEqual([48, 48])
	}
	await expect(parts.help).toHaveAttribute('href', '/guide.html#sell')
})
