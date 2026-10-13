import {
	confirmDialog,
	installConsole,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * One concert: its event dates, each one target opening its event page, with
 * the summary beside them from 840 px and below them on narrower windows; the
 * header's 公開する, 編集 and overflow menu (公演を中止).
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert'

const NOW = new Date('2026-10-28T10:00:00+09:00')

/** XX Tour 2026 with three dates, listed by the server out of date order. */
const TOUR_OF_THREE: ConcertSpec = {
	...XX_TOUR,
	events: [XX_TOUR.events[2], XX_TOUR.events[0], XX_TOUR.events[1]],
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([TOUR_OF_THREE]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
	'TicketSaleService/ListByEvent': (body) => ({
		body: JSON.stringify(body).includes('e-1103')
			? salesOf('e-1103', [
					{
						id: 'sale-1',
						name: '最速先行',
						method: 'LOTTERY',
						start: jst('2026-10-20', '12:00'),
						end: jst('2026-11-01', '23:59'),
						price: 6800,
						quantity: 1000,
					},
				])
			: salesOf('none', []),
	}),
}

async function openConcert(page: Page, path: string, rpc: RpcMocks = BASE) {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, { rpc, language: 'ja' })
	await page.goto(path)
	return log
}

test.describe('summary and event dates', () => {
	test(`@spec ${SPEC} "Tour with three dates"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcert(page, `${SERIES}/s-tour`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()

		// The dates in date order, each one item that is one link.
		const dates = page
			.getByRole('list', { name: '公演日' })
			.getByRole('listitem')
		await expect(dates).toHaveCount(3)
		await expect(dates.nth(0)).toContainText('11月3日(火) 18:00 JST')
		await expect(dates.nth(0)).toContainText('Zepp Haneda')
		await expect(dates.nth(0)).toContainText('受付中')
		await expect(dates.nth(0)).toContainText('公開中')
		await expect(dates.nth(1)).toContainText('11月10日(火) 18:00 JST')
		await expect(dates.nth(1)).toContainText('Zepp Osaka Bayside')
		await expect(dates.nth(1)).toContainText('販売なし')
		await expect(dates.nth(1)).toContainText('公開中')
		await expect(dates.nth(2)).toContainText('11月17日(火) 18:00 JST')
		await expect(dates.nth(2)).toContainText('Zepp Nagoya')
		await expect(dates.nth(2)).toContainText('公開中')
		for (const date of await dates.all()) {
			await expect(date.getByRole('link')).toHaveCount(1)
			await expect(date.getByRole('button')).toHaveCount(0)
		}

		// The summary sits beside the dates on a 1280 px window.
		const summary = page.getByRole('complementary', { name: '概要' })
		await expect(summary).toContainText('ツアー')
		await expect(summary).toContainText('Band A')
		const list = await page.getByRole('list', { name: '公演日' }).boundingBox()
		const aside = await summary.boundingBox()
		expect(aside?.x).toBeGreaterThan((list?.x ?? 0) + (list?.width ?? 0) - 1)

		await dates.nth(0).getByRole('link').click()
		await expect(page).toHaveURL(
			/\/series\/s-tour\/events\/e-1103(\/ticket-sales)?$/,
		)
	})

	test('The summary goes below the dates on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcert(page, `${SERIES}/s-tour`)
		const list = await page.getByRole('list', { name: '公演日' }).boundingBox()
		const aside = await page
			.getByRole('complementary', { name: '概要' })
			.boundingBox()
		expect(aside?.y).toBeGreaterThan((list?.y ?? 0) + (list?.height ?? 0) - 1)
	})

	test(`@spec ${SPEC} "Unknown concert"`, async ({ page }) => {
		await openConcert(page, `${SERIES}/s-other`)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演が見つかりません' }),
		).toBeVisible()
		const back = page
			.getByRole('main')
			.getByRole('link', { name: '公演一覧へ' })
		await expect(back).toHaveAttribute('href', /\/series$/)
		await back.click()
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()
	})
})

/**
 * A small concert server: Publish publishes the named DRAFT dates and Cancel
 * cancels every date, so the page reads what the action did.
 */
function concertServer(concert: ConcertSpec) {
	const state: ConcertSpec = structuredClone(concert)
	const body = () => seriesList([state])
	const rpc: RpcMocks = {
		...BASE,
		'SeriesService/List': () => ({ body: body() }),
		'SeriesService/Publish': (req) => {
			const ids = ((req.eventIds ?? []) as Array<{ value: string }>).map(
				(e) => e.value,
			)
			for (const e of state.events) {
				if (e.state === 'DRAFT' && (ids.length === 0 || ids.includes(e.id))) {
					e.state = 'PUBLISHED'
				}
			}
			const b = body()
			return { body: { ...b, series: (b.series as unknown[])[0] } }
		},
		'SeriesService/Cancel': () => {
			state.events = state.events
				.filter((e) => e.state !== 'DRAFT')
				.map((e) => ({ ...e, state: 'CANCELLED' as const }))
			return { body: {} }
		},
	}
	return { rpc, state }
}

const DRAFT_TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({ ...e, state: 'DRAFT' as const })),
}

const publishDialog = (page: Page) =>
	confirmDialog(page, { name: 'XX Tour 2026 の公演日を公開しますか？' })

/** The publish state at the trailing edge of each date. */
const badges = (page: Page) =>
	page.getByRole('list', { name: '公演日' }).locator('status-badge')

/** Opens the header's overflow menu and chooses an item. */
async function chooseFromMenu(page: Page, name: string): Promise<void> {
	await page
		.locator('concert-route header')
		.getByRole('button', { name: 'その他の操作' })
		.click()
	const menu = page.getByRole('menu', { name: 'その他の操作' })
	await expect(menu).toBeVisible()
	await menu.getByRole('menuitem', { name }).click()
}

test.describe('publish or cancel the dates together', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
	})

	test(`@spec ${SPEC} "New tour published at once"`, async ({ page }) => {
		const server = concertServer(DRAFT_TOUR)
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()

		const dialog = publishDialog(page)
		await expect(dialog.getByRole('checkbox')).toHaveCount(4)
		for (const box of await dialog.getByRole('checkbox').all()) {
			await expect(box).toBeChecked()
		}
		await expect(dialog).toContainText('出演者のフォロワーに1回通知します')
		await dialog.getByRole('button', { name: '公開する' }).click()

		const publishes = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publishes).toHaveLength(1)
		expect(publishes[0].body.eventIds).toEqual(
			['e-1103', 'e-1110', 'e-1117', 'e-1124'].map((value) => ({ value })),
		)
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'公開中',
		])
		await expect(page.locator('.snack-item')).toContainText(
			'4件の公演日を公開しました',
		)
	})

	test(`@spec ${SPEC} "Additional date on a published tour"`, async ({
		page,
	}) => {
		const withAddition: ConcertSpec = {
			...XX_TOUR,
			events: XX_TOUR.events.map((e, i) =>
				i === 3 ? { ...e, state: 'DRAFT' as const } : e,
			),
		}
		const server = concertServer(withAddition)
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()
		const dialog = publishDialog(page)
		await expect(dialog.getByRole('checkbox')).toHaveCount(1)
		await dialog.getByRole('button', { name: '公開する' }).click()

		const [publish] = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publish.body.eventIds).toEqual([{ value: 'e-1124' }])
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'公開中',
		])
	})

	test(`@spec ${SPEC} "One date left out"`, async ({ page }) => {
		const server = concertServer(DRAFT_TOUR)
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()
		const dialog = publishDialog(page)
		await dialog.getByRole('checkbox', { name: /11月24日/ }).uncheck()
		await dialog.getByRole('button', { name: '公開する' }).click()

		const [publish] = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publish.body.eventIds).toEqual(
			['e-1103', 'e-1110', 'e-1117'].map((value) => ({ value })),
		)
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'下書き',
		])
	})

	test(`@spec ${SPEC} "Whole concert cancelled"`, async ({ page }) => {
		const server = concertServer(XX_TOUR)
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		// Out of the header's row of buttons: in its overflow menu.
		await expect(
			page.locator('concert-route header').getByRole('button', {
				name: '公演を中止',
			}),
		).toHaveCount(0)
		await chooseFromMenu(page, '公演を中止')
		const dialog = confirmDialog(page, {
			name: 'XX Tour 2026 を中止しますか？',
		})
		await expect(dialog).toContainText('ファンに1回知らされます')
		await dialog.getByRole('button', { name: '公演を中止' }).click()

		const cancels = log.calls.filter((c) => c.method === 'SeriesService/Cancel')
		expect(cancels).toHaveLength(1)
		expect(cancels[0].body.eventIds ?? []).toEqual([])
		await expect(badges(page)).toHaveText(['中止', '中止', '中止', '中止'])
		// Nothing left to cancel: the item stays in the menu, disabled.
		await page
			.locator('concert-route header')
			.getByRole('button', { name: 'その他の操作' })
			.click()
		await expect(
			page
				.getByRole('menu', { name: 'その他の操作' })
				.getByRole('menuitem', { name: '公演を中止' }),
		).toHaveAttribute('aria-disabled', 'true')
	})

	test(`@spec ${SPEC} "Nothing to publish"`, async ({ page }) => {
		await openConcert(page, `${SERIES}/s-tour`, concertServer(XX_TOUR).rpc)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()
		await expect(
			page.getByRole('button', { name: '公開する', exact: true }),
		).toHaveCount(0)
	})

	test('Publish is the one filled action, edit outlined, cancel in the menu', async ({
		page,
	}) => {
		await openConcert(page, `${SERIES}/s-tour`, concertServer(DRAFT_TOUR).rpc)
		const header = page.locator('concert-route header')
		const variant = (name: string) =>
			header
				.locator('console-button')
				.filter({ has: page.locator(`[data-variant="${name}"]`) })
		await expect(variant('filled')).toHaveText([/公開する/])
		await expect(variant('outlined')).toHaveText([/編集/])
		await expect(header.getByRole('link', { name: '編集' })).toHaveAttribute(
			'href',
			/\/series\/s-tour\/edit$/,
		)

		// The menu opens on its first item and Escape returns to its button.
		const more = header.getByRole('button', { name: 'その他の操作' })
		await more.click()
		await expect(
			page.getByRole('menuitem', { name: '公演を中止' }),
		).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByRole('menu', { name: 'その他の操作' })).toBeHidden()
		await expect(more).toBeFocused()
	})
})
