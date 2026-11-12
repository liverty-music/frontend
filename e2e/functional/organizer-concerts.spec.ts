import {
	brandColoredControls,
	installConsole,
	ORG,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	artistList,
	jst,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Concerts of a represented Artist in the real console: the list on a narrow
 * window and the table once the list is 840 px wide, each one target opening
 * its concert page; 公演をつくる as the extended FAB. What the items, rows and
 * the empty and failed states say is checked against the rendered route in
 * `test/organizer/concerts/concerts-route.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concerts'
const TOKENS = 'components/infrastructure/organizer/web/global/design-tokens'

const NOW = new Date('2026-10-28T10:00:00+09:00')

/** XX Tour's first date has a lottery open now; every other event has no sale. */
const RPC: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
	'TicketSaleService/ListByEvent': (body) => {
		const id = JSON.stringify(body)
		return {
			body: id.includes('e-1103')
				? salesOf('e-1103', [
						{
							id: 'sale-1',
							name: '最速先行',
							method: 'LOTTERY',
							start: jst('2026-10-20', '12:00'),
							end: jst('2026-11-01', '23:59'),
						},
					])
				: salesOf('none', []),
		}
	},
}

async function openConcerts(page: Page, rpc: RpcMocks = RPC) {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, { rpc, language: 'ja' })
	await page.goto(SERIES)
	await expect(
		page.getByRole('heading', { level: 1, name: '公演' }),
	).toBeVisible()
	return log
}

const items = (page: Page) =>
	page.getByRole('list', { name: '公演', exact: true }).getByRole('listitem')

function item(page: Page, title: string): Locator {
	return items(page).filter({ hasText: title })
}

/** 公演をつくる, the screen's extended FAB. */
const fab = (page: Page) =>
	page.locator('concerts-route extended-fab').getByRole('link')

test.describe('a list or a table', () => {
	// What each item and row shows is checked against the rendered route in
	// test/organizer/concerts/concerts-route.spec.ts; the browser decides here
	// which form the window gets and what a click anywhere on it does.
	test(`@spec ${SPEC} "Phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)

		await expect(items(page)).toHaveCount(2)
		await expect(page.getByRole('table')).toBeHidden()

		// Selecting anywhere on the item opens the concert page: here, the
		// status at its trailing edge.
		await item(page, 'XX Tour 2026').getByText('公開中').click()
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()
	})

	test(`@spec ${SPEC} "PC"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcerts(page)

		const table = page.getByRole('table')
		await expect(table).toBeVisible()
		await expect(items(page).first()).toBeHidden()
		const rows = table.getByRole('rowgroup').nth(1).getByRole('row')
		await expect(rows).toHaveCount(2)

		// A click anywhere on the row opens the concert: here, on its sale state.
		await rows.nth(0).click()
		await expect(page).toHaveURL(/\/series\/s-tour$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()

		// Narrowing the window turns the rows into list items.
		await page.goBack()
		await expect(table).toBeVisible()
		await page.setViewportSize({ width: 390, height: 844 })
		await expect(table).toBeHidden()
		await expect(items(page).first()).toBeVisible()
	})
})

test.describe('concerts of an Artist', () => {
	// The unit tests check the FAB's link and the editor's performers apart; only
	// the real router joins them (the address names the Artist the editor reads).
	test(`@spec ${SPEC} "Create from an Artist"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.clock.setFixedTime(NOW)
		await installConsole(page, {
			rpc: { ...RPC, 'ArtistService/List': artistList('Band A', 'Band B') },
			language: 'ja',
		})
		// Band B, the second Artist by name, so the default is not what is tested.
		await page.goto(`${ORG}/artists/a-2/series`)
		await page.locator('concerts-route extended-fab').getByRole('link').click()

		await expect(page).toHaveURL(/\/artists\/a-2\/series\/new$/)
		const performers = page.getByRole('group', { name: /出演者/ })
		const options = performers.getByRole('checkbox')
		// Band B first and chosen; Band A offered, not chosen.
		await expect(performers.locator('label')).toHaveText(['Band B', 'Band A'])
		await expect(options.nth(0)).toBeChecked()
		await expect(options.nth(1)).not.toBeChecked()
	})
})

test.describe('公演をつくる', () => {
	test('is an extended FAB at the bottom trailing corner, above the bar on a phone', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)
		const fabBox = await fab(page).boundingBox()
		const bar = await page
			.getByRole('navigation', { name: 'メインナビゲーション' })
			.boundingBox()
		expect(fabBox?.height).toBe(56)
		// Trailing edge, 16 px in, just above the navigation bar.
		expect(Math.round((fabBox?.x ?? 0) + (fabBox?.width ?? 0))).toBe(390 - 16)
		expect((fabBox?.y ?? 0) + (fabBox?.height ?? 0)).toBeLessThanOrEqual(
			bar?.y ?? 0,
		)

		await page.setViewportSize({ width: 1280, height: 800 })
		const wide = await fab(page).boundingBox()
		expect(Math.round((wide?.x ?? 0) + (wide?.width ?? 0))).toBe(1280 - 16)
		expect(Math.round((wide?.y ?? 0) + (wide?.height ?? 0))).toBe(800 - 16)
	})
})

test.describe('brand color', () => {
	test(`@spec ${TOKENS} "One primary action"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcerts(page)
		await expect(page.getByRole('table')).toBeVisible()
		await expect(page.getByRole('table')).toContainText('受付中')

		// The logo may use it too (design-tokens); nothing else but 公演をつくる.
		expect(await brandColoredControls(page)).toEqual(['公演をつくる'])
		// Each concert row is a link too, and none of them is brand-colored.
		await expect(
			page.getByRole('link', { name: /XX Tour 2026/ }).first(),
		).toBeVisible()
	})
})
