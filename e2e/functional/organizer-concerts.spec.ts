import {
	brandColoredControls,
	connectError,
	installConsole,
	ORG,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	artistList,
	type ConcertSpec,
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
 * Concerts of a represented Artist: the concerts it performs in as an M3 list
 * on a narrow window and as a table once the list is 840 px wide, each one
 * target opening its concert page; 公演をつくる as the extended FAB; the empty
 * and failed states.
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
	test(`@spec ${SPEC} "Phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)

		await expect(items(page)).toHaveCount(2)
		await expect(page.getByRole('table')).toBeHidden()

		// Each concert is one link: the whole item, with nothing else inside.
		const tour = item(page, 'XX Tour 2026')
		await expect(tour.getByRole('link')).toHaveCount(1)
		await expect(tour.getByRole('button')).toHaveCount(0)
		const tourLink = tour.getByRole('link')
		await expect(tourLink).toHaveAttribute('href', /\/series\/s-tour$/)
		// Title; first date · venue; sale state; the status at the trailing edge.
		await expect(tourLink).toHaveAccessibleName(
			/XX Tour 2026.*11月3日\(火\) 他 3公演 · Zepp Haneda 他.*受付中.*公開中/,
		)
		// No duplicate 開く: the item itself opens the concert.
		await expect(page.getByRole('link', { name: '開く' })).toHaveCount(0)

		const solo = item(page, 'XX 単独公演')
		await expect(solo).toContainText('12月20日(日)')
		await expect(solo).toContainText('Zepp Haneda')
		await expect(solo).toContainText('販売なし')
		await expect(solo).toContainText('下書き')

		// Selecting anywhere on the item opens the concert page: here, the
		// status at its trailing edge.
		await tour.getByText('公開中').click()
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
		await expect(table.getByRole('columnheader')).toHaveText([
			'公演名',
			'日程・会場',
			'販売状態',
			'状態',
		])
		const rows = table.getByRole('rowgroup').nth(1).getByRole('row')
		await expect(rows).toHaveCount(2)
		await expect(rows.nth(0)).toContainText('XX Tour 2026')
		await expect(rows.nth(0)).toContainText('受付中')
		await expect(rows.nth(1)).toContainText('XX 単独公演')
		await expect(rows.nth(1)).toContainText('下書き')

		// One link per row, and a click anywhere on the row opens the concert:
		// here, on its sale state.
		await expect(rows.nth(0).getByRole('link')).toHaveCount(1)
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

	test(`@spec ${SPEC} "Tour summary"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)
		const tour = item(page, 'XX Tour 2026')
		await expect(tour).toContainText('11月3日(火) 他 3公演 · Zepp Haneda 他')
	})
})

test.describe('concerts of an Artist', () => {
	/** Only Band B performs in YY Live. */
	const YY_LIVE: ConcertSpec = {
		id: 's-yy',
		title: 'YY Live',
		performers: [{ id: 'a-2', name: 'Band B' }],
		events: [
			{ id: 'e-yy', date: '2026-12-01', start: '19:00', venue: 'O-EAST' },
		],
	}
	const TWO_ARTISTS: RpcMocks = {
		...RPC,
		'SeriesService/List': seriesList([XX_TOUR, XX_SOLO, YY_LIVE]),
		'ArtistService/List': artistList('Band A', 'Band B'),
	}

	test(`@spec ${SPEC} "Another Artist's concert"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page, TWO_ARTISTS)
		await expect(items(page)).toHaveCount(2)
		await expect(item(page, 'XX Tour 2026')).toBeVisible()
		await expect(page.getByRole('link', { name: /YY Live/ })).toHaveCount(0)

		// Under Band A the concert is not found, though the Organizer has it.
		await page.goto(`${SERIES}/s-yy`)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演が見つかりません' }),
		).toBeVisible()

		await page.goto(`${ORG}/artists/a-2/series`)
		await expect(items(page)).toHaveCount(1)
		await expect(item(page, 'YY Live')).toBeVisible()
	})

	test(`@spec ${SPEC} "Create from an Artist"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.clock.setFixedTime(NOW)
		await installConsole(page, { rpc: TWO_ARTISTS, language: 'ja' })
		// Band B, the second Artist by name, so the default is not what is tested.
		await page.goto(`${ORG}/artists/a-2/series`)
		await fab(page).click()

		await expect(page).toHaveURL(/\/artists\/a-2\/series\/new$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '新しい公演' }),
		).toBeVisible()
		const performers = page.getByRole('group', { name: /出演者/ })
		const options = performers.getByRole('checkbox')
		// Band B first and chosen; Band A offered, not chosen.
		await expect(performers.locator('label')).toHaveText(['Band B', 'Band A'])
		await expect(options.nth(0)).toBeChecked()
		await expect(options.nth(1)).not.toBeChecked()
	})
})

test.describe('empty and failed lists', () => {
	test(`@spec ${SPEC} "First visit"`, async ({ page }) => {
		await openConcerts(page, { ...RPC, 'SeriesService/List': seriesList([]) })
		await expect(page.getByText('まだ公演がありません。')).toBeVisible()
		// The screen's one floating action opens the editor.
		await expect(
			page.getByRole('main').getByRole('link', { name: '公演をつくる' }),
		).toHaveCount(1)
		await expect(fab(page)).toBeVisible()
		await expect(fab(page)).toHaveAttribute('href', /\/series\/new$/)
	})

	test(`@spec ${SPEC} "Load fails"`, async ({ page }) => {
		let reads = 0
		await openConcerts(page, {
			...RPC,
			'SeriesService/List': () => {
				reads++
				return connectError('unavailable', 'backend down', 503)
			},
		})
		const alert = page
			.getByRole('alert')
			.filter({ hasText: '公演を読み込めませんでした。' })
		await expect(alert).toBeVisible()
		const before = reads
		await alert.getByRole('button', { name: '再試行' }).click()
		await expect.poll(() => reads).toBeGreaterThan(before)
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
