import {
	confirmDialog,
	connectError,
	installConsole,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	type SeatTypeSpec,
	type StockSpec,
	salesOf,
	seatType,
	seatTypesOf,
	seriesList,
	stocksOf,
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

test.describe("the concert's seat types", () => {
	const section = (page: Page) => page.getByTestId('seat-types')
	const item = (page: Page, name: string) =>
		section(page).locator('.seat-type').filter({ hasText: name })

	/**
	 * Seat types held in memory, and the stocks of each date (by event id), so
	 * the page reads what it added or deleted.
	 */
	function seatTypeServer(
		initial: SeatTypeSpec[] = [],
		stocked: Record<string, StockSpec[]> = {},
		concert: ConcertSpec = XX_TOUR,
	) {
		const seatTypes = [...initial]
		let next = seatTypes.length
		const rpc: RpcMocks = {
			...BASE,
			'SeriesService/List': seriesList([concert]),
			'SeatTypeService/ListBySeries': () => ({
				body: seatTypesOf('s-tour', seatTypes),
			}),
			'SeatTypeService/Create': (req) => {
				const name = (req.name as { value: string }).value
				if (seatTypes.some((t) => t.name === name)) {
					return connectError('already_exists', 'seat type name taken', 409)
				}
				next += 1
				const t: SeatTypeSpec = {
					id: `seat-${next}`,
					name,
					price: Number((req.price as { value: string }).value),
				}
				seatTypes.push(t)
				return { body: { seatType: seatType('s-tour', t) } }
			},
			'SeatTypeService/Delete': (req) => {
				const id = (req.seatTypeId as { value: string }).value
				if (
					Object.values(stocked)
						.flat()
						.some((s) => s.seatType.id === id)
				) {
					return connectError('failed_precondition', 'seat type in use')
				}
				seatTypes.splice(
					seatTypes.findIndex((t) => t.id === id),
					1,
				)
				return { body: {} }
			},
			'TicketStockService/ListByEvent': (req) => {
				const id = (req.eventId as { value: string }).value
				return { body: stocksOf(id, stocked[id] ?? []) }
			},
		}
		return { rpc, seatTypes }
	}

	async function add(page: Page, name: string, price: string) {
		await section(page)
			.getByLabel(/席種名/)
			.fill(name)
		await section(page).getByLabel(/価格/).fill(price)
		await section(page).getByRole('button', { name: '席種を追加' }).click()
	}

	async function confirmAdd(page: Page) {
		const dialog = confirmDialog(page, { name: /を追加しますか？/ })
		await expect(dialog).toContainText('席種名と価格はあとから変えられません')
		await dialog.getByRole('button', { name: '席種を追加' }).click()
	}

	test(`@spec ${SPEC} "Dome tour seat types"`, async ({ page }) => {
		const server = seatTypeServer()
		await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		await expect(
			section(page).getByRole('heading', { level: 2, name: '席種' }),
		).toBeVisible()

		for (const [name, price] of [
			['S席', '12000'],
			['A席', '9000'],
			['B席', '7000'],
		]) {
			await add(page, name, price)
			await confirmAdd(page)
			await expect(item(page, name)).toBeVisible()
		}

		await expect(section(page).locator('.seat-type-name')).toHaveText([
			'S席',
			'A席',
			'B席',
		])
		await expect(item(page, 'S席')).toContainText('12,000円')
		await expect(item(page, 'A席')).toContainText('9,000円')
		await expect(item(page, 'B席')).toContainText('7,000円')
		await expect(section(page)).toContainText(
			'枚数は公演日ごとに、公演日の販売タブで決めます。',
		)
	})

	test(`@spec ${SPEC} "Price mistake before stocking"`, async ({ page }) => {
		const server = seatTypeServer([{ id: 'seat-s', name: 'S席', price: 1200 }])
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)

		await expect(item(page, 'S席')).toContainText('1,200円')
		await item(page, 'S席').getByRole('button', { name: '削除' }).click()
		await confirmDialog(page, { name: 'S席を削除しますか？' })
			.getByRole('button', { name: '削除' })
			.click()
		await expect(item(page, 'S席')).toHaveCount(0)

		await add(page, 'S席', '12000')
		await confirmAdd(page)
		await expect(item(page, 'S席')).toContainText('12,000円')
		expect(
			log.calls.find((c) => c.method === 'SeatTypeService/Delete')?.body,
		).toEqual({ seatTypeId: { value: 'seat-s' } })
	})

	test(`@spec ${SPEC} "Seat type in use"`, async ({ page }) => {
		const S: SeatTypeSpec = { id: 'seat-s', name: 'S席', price: 12000 }
		const server = seatTypeServer([S], {
			'e-1103': [{ id: 'stock-s', seatType: S, quantity: 300 }],
		})
		await openConcert(page, `${SERIES}/s-tour`, server.rpc)

		await expect(item(page, 'S席')).toContainText(
			'公演日に枚数があるため削除できません',
		)
		await expect(item(page, 'S席').getByRole('button')).toHaveCount(0)
		await expect(item(page, 'S席').getByRole('textbox')).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Name already used"`, async ({ page }) => {
		const server = seatTypeServer([{ id: 'seat-s', name: 'S席', price: 12000 }])
		const log = await openConcert(page, `${SERIES}/s-tour`, server.rpc)
		await expect(item(page, 'S席')).toBeVisible()

		await add(page, 'S席', '9000')

		await expect(
			section(page).locator('[data-field="seat-type-name"]'),
		).toContainText('「S席」はこの公演の別の席種で使われています')
		await expect(confirmDialog(page)).toHaveCount(0)
		expect(log.calls.some((c) => c.method === 'SeatTypeService/Create')).toBe(
			false,
		)
	})

	test('offers neither action once every date is cancelled', async ({
		page,
	}) => {
		const cancelled: ConcertSpec = {
			...XX_TOUR,
			events: XX_TOUR.events.map((e) => ({ ...e, state: 'CANCELLED' })),
		}
		const server = seatTypeServer(
			[{ id: 'seat-s', name: 'S席', price: 12000 }],
			{},
			cancelled,
		)
		await openConcert(page, `${SERIES}/s-tour`, server.rpc)

		await expect(item(page, 'S席')).toBeVisible()
		await expect(section(page).getByRole('button')).toHaveCount(0)
		await expect(section(page).getByLabel(/席種名/)).toHaveCount(0)
	})
})
