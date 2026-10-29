import {
	confirmDialog,
	connectError,
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	organizer,
	payoutAccount,
	type SaleSpec,
	type SeatTypeSpec,
	type StockSpec,
	salesOf,
	seatType,
	seatTypesOf,
	seriesList,
	stocksOf,
	ticketSale,
	ticketStock,
	XX_SOLO,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Seat types, stocks and the per-account limit from end to end (OpenSpec
 * change remodel-ticket-sales, task 10.2): a member adds S席 at 8000 yen and
 * A席 at 6000 yen to a concert, keeps its date's limit at 4, stocks the date
 * with 100 S席 and 200 A席, starts a lottery presale, and sees the event page
 * list both stocks and the sale. S席 cannot be deleted while the date stocks
 * it; the stock can, because only an abandoned checkout's Void Order names
 * it, and then S席 can too.
 *
 * The organizer API is an in-memory server that keeps the rules the backend
 * enforces for these calls: a seat type is refused while a stock uses it, and
 * a stock while an Order that is not Void names it.
 */

const EVENT = 'e-1220'
const CONCERT = `${SERIES}/s-solo`
const NOW = new Date('2026-12-01T10:00:00+09:00')

type OrderStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'VOID'

function server() {
	const concert: ConcertSpec = structuredClone(XX_SOLO)
	const seatTypes: SeatTypeSpec[] = []
	const stocks: StockSpec[] = []
	const sales: SaleSpec[] = []
	/** The Orders naming each stock, by stock id. */
	const orders = new Map<string, OrderStatus[]>()
	const list = () => seriesList([concert])
	const rpc: RpcMocks = {
		'SeriesService/List': () => ({ body: list() }),
		'SeriesService/Update': (req) => {
			const draft = req.draft as {
				events: Array<{ eventId?: { value: string }; perAccountLimit?: number }>
			}
			for (const e of draft.events) {
				const stored = concert.events.find((x) => x.id === e.eventId?.value)
				if (stored) stored.perAccountLimit = e.perAccountLimit ?? 4
			}
			const body = list()
			return {
				body: {
					series: (body.series as unknown[])[0],
					concerts: body.concerts,
					artists: body.artists,
				},
			}
		},
		'SeriesService/Publish': () => {
			concert.events[0].state = 'PUBLISHED'
			concert.state = 'PUBLISHED'
			const body = list()
			return {
				body: {
					series: (body.series as unknown[])[0],
					concerts: body.concerts,
					artists: body.artists,
				},
			}
		},
		'OrganizerService/Get': organizer(),
		'PayoutAccountService/Get': payoutAccount('ACTIVE'),
		'ScannerService/ListByEvent': { scanners: [] },
		'SeatTypeService/ListBySeries': () => ({
			body: seatTypesOf('s-solo', seatTypes),
		}),
		'SeatTypeService/Create': (req) => {
			const t: SeatTypeSpec = {
				id: `seat-${seatTypes.length + 1}`,
				name: (req.name as { value: string }).value,
				price: Number((req.price as { value: string }).value),
			}
			seatTypes.push(t)
			return { body: { seatType: seatType('s-solo', t) } }
		},
		'SeatTypeService/Delete': (req) => {
			const id = (req.seatTypeId as { value: string }).value
			if (stocks.some((s) => s.seatType.id === id)) {
				return connectError('failed_precondition', 'seat type in use')
			}
			seatTypes.splice(
				seatTypes.findIndex((t) => t.id === id),
				1,
			)
			return { body: {} }
		},
		'TicketStockService/ListByEvent': () => ({
			body: stocksOf(EVENT, stocks, 's-solo'),
		}),
		'TicketStockService/Create': (req) => {
			const id = (req.seatTypeId as { value: string }).value
			const s: StockSpec = {
				id: `stock-${id}`,
				seatType: seatTypes.find((t) => t.id === id) ?? seatTypes[0],
				quantity: req.quantity as number,
			}
			stocks.push(s)
			return { body: { ticketStock: ticketStock(EVENT, s) } }
		},
		'TicketStockService/Delete': (req) => {
			const id = (req.ticketStockId as { value: string }).value
			if ((orders.get(id) ?? []).some((o) => o !== 'VOID')) {
				return connectError('failed_precondition', 'stock has orders')
			}
			orders.delete(id)
			stocks.splice(
				stocks.findIndex((s) => s.id === id),
				1,
			)
			return { body: {} }
		},
		'TicketSaleService/ListByEvent': () => ({ body: salesOf(EVENT, sales) }),
		'TicketSaleService/Create': (req) => {
			const sale: SaleSpec = {
				id: `sale-${sales.length + 1}`,
				name: (req.name as { value: string }).value,
				method: 'LOTTERY',
				start: req.saleStartTime as string,
				end: req.saleEndTime as string,
				eventIds: (req.eventIds as Array<{ value: string }>).map(
					(e) => e.value,
				),
			}
			sales.push(sale)
			return { body: { ticketSale: ticketSale(EVENT, sale) } }
		},
	}
	return {
		rpc,
		concert,
		/** A fan abandoned a checkout of the stock: its Order is Void. */
		abandonCheckout(stockId: string) {
			orders.set(stockId, [...(orders.get(stockId) ?? []), 'VOID'])
		},
	}
}

const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method).map((c) => c.body)
const seatTypesSection = (page: Page) => page.getByTestId('seat-types')
const seatTypeItem = (page: Page, name: string) =>
	seatTypesSection(page).locator('.seat-type').filter({ hasText: name })
const stocksSection = (page: Page) => page.getByTestId('ticket-stocks')
const snack = (page: Page) => page.locator('snack-bar [role="status"]')

async function addSeatType(page: Page, name: string, price: string) {
	await seatTypesSection(page)
		.getByLabel(/席種名/)
		.fill(name)
	await seatTypesSection(page).getByLabel(/価格/).fill(price)
	await seatTypesSection(page)
		.getByRole('button', { name: '席種を追加' })
		.click()
	await confirmDialog(page, { name: /を追加しますか？/ })
		.getByRole('button', { name: '席種を追加' })
		.click()
	await expect(
		snack(page).filter({ hasText: `${name}を追加しました` }),
	).toBeVisible()
}

async function addStock(page: Page, option: string, quantity: string) {
	await stocksSection(page)
		.getByLabel(/^席種 /)
		.selectOption({ label: option })
	await stocksSection(page)
		.getByRole('spinbutton', { name: /^枚数/ })
		.fill(quantity)
	await stocksSection(page).getByRole('button', { name: '席種を追加' }).click()
	await confirmDialog(page, { name: /枚追加しますか？/ })
		.getByRole('button', { name: '席種を追加' })
		.click()
}

test("seat types, a date's stocks and limit, a presale, and deleting them", async ({
	page,
}) => {
	await page.clock.setFixedTime(NOW)
	await page.setViewportSize({ width: 1280, height: 900 })
	const api = server()
	const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })

	// 1. The concert's seat types: S席 8000 yen and A席 6000 yen.
	await page.goto(CONCERT)
	await addSeatType(page, 'S席', '8000')
	await addSeatType(page, 'A席', '6000')
	await expect(seatTypeItem(page, 'S席')).toContainText('8,000円')
	await expect(seatTypeItem(page, 'A席')).toContainText('6,000円')
	expect(calls(log, 'SeatTypeService/Create')).toEqual([
		{
			seriesId: { value: 's-solo' },
			name: { value: 'S席' },
			price: { value: '8000' },
		},
		{
			seriesId: { value: 's-solo' },
			name: { value: 'A席' },
			price: { value: '6000' },
		},
	])

	// 2. The date's per-account limit of 4, saved through the concert editor.
	await page
		.locator('concert-route header')
		.getByRole('link', { name: '編集' })
		.click()
	const limit = page.locator('[data-row="0"]').getByLabel(/1アカウントの上限/)
	await expect(limit).toHaveValue('4')
	await limit.fill('4')
	await page.getByRole('button', { name: '保存する' }).click()
	await expect(page).toHaveURL(/\/series\/s-solo$/)
	const update = calls(log, 'SeriesService/Update')[0] as {
		draft: { events: Array<{ perAccountLimit?: number }> }
	}
	expect(update.draft.events[0].perAccountLimit).toBe(4)

	// 3. Publish the date from its event page.
	await page
		.getByRole('link', { name: /12月20日\(日\) 18:00 JST/ })
		.first()
		.click()
	await expect(page).toHaveURL(/\/events\/e-1220\/ticket-sales$/)
	await page
		.getByRole('button', { name: '公開する', exact: true })
		.first()
		.click()
	await confirmDialog(page).getByRole('button', { name: '公開する' }).click()
	await expect(page.locator('event-route status-badge').first()).toHaveText(
		/公開中/,
	)
	// Published and timed, but nothing to sell yet.
	await expect(
		page.getByRole('heading', { name: '席種と枚数を追加してください' }),
	).toBeVisible()

	// 4. Stock the date: 100 S席 and 200 A席.
	await addStock(page, 'S席（8,000円）', '100')
	await expect(
		snack(page).filter({ hasText: 'S席を追加しました' }),
	).toBeVisible()
	await addStock(page, 'A席（6,000円）', '200')
	await expect(
		snack(page).filter({ hasText: 'A席を追加しました' }),
	).toBeVisible()
	expect(calls(log, 'TicketStockService/Create')).toEqual([
		{
			eventId: { value: EVENT },
			seatTypeId: { value: 'seat-1' },
			quantity: 100,
		},
		{
			eventId: { value: EVENT },
			seatTypeId: { value: 'seat-2' },
			quantity: 200,
		},
	])

	// 5. A lottery presale of the date.
	await page.getByRole('link', { name: '抽選で販売する' }).click()
	await expect(page.locator('.tickets .stock')).toHaveText([
		/S席\s*8,000円 税込 · 100枚/,
		/A席\s*6,000円 税込 · 200枚/,
	])
	await expect(page.locator('.tickets')).toContainText('1アカウント4枚まで')
	await page.getByLabel(/販売名/).fill('ファンクラブ先行')
	await page.getByRole('button', { name: '抽選販売を始める' }).click()
	await expect(page).toHaveURL(/\/events\/e-1220\/ticket-sales$/)
	expect(calls(log, 'TicketSaleService/Create')[0]).toMatchObject({
		seriesId: { value: 's-solo' },
		name: { value: 'ファンクラブ先行' },
		method: 'TICKET_SALE_METHOD_LOTTERY',
		eventIds: [{ value: EVENT }],
	})

	// 6. The event page lists both stocks and the sale.
	const sItem = page.locator('[data-stock="stock-seat-1"]')
	const aItem = page.locator('[data-stock="stock-seat-2"]')
	await expect(sItem).toContainText('S席')
	await expect(sItem).toContainText('8,000円 税込 · 100枚')
	await expect(sItem.locator('status-badge')).toHaveText('販売可')
	await expect(aItem).toContainText('A席')
	await expect(aItem).toContainText('6,000円 税込 · 200枚')
	const sale = page.locator('[data-sale="sale-1"]')
	await expect(
		sale.getByRole('heading', { name: 'ファンクラブ先行' }),
	).toBeVisible()
	await expect(sale.locator('status-badge')).toHaveText('受付中')
	await expect(page.locator('sales-tab')).toContainText(
		'1アカウントの上限は、この公演日のすべての販売を合わせて4枚です。',
	)

	// 7. S席 is stocked: the concert page refuses to delete it.
	await page
		.getByRole('navigation', { name: 'パンくずリスト' })
		.getByRole('link', { name: 'XX 単独公演' })
		.click()
	await expect(seatTypeItem(page, 'S席')).toContainText(
		'公演日に枚数があるため削除できません',
	)
	await expect(seatTypeItem(page, 'S席').getByRole('button')).toHaveCount(0)
	expect(calls(log, 'SeatTypeService/Delete')).toHaveLength(0)

	// 8. A fan abandoned a checkout of S席: only its Void Order names the
	// stock, so the stock can still be deleted.
	api.abandonCheckout('stock-seat-1')
	await page
		.getByRole('link', { name: /12月20日\(日\) 18:00 JST/ })
		.first()
		.click()
	await sItem.getByRole('button', { name: '削除' }).click()
	await confirmDialog(page, { name: 'S席を削除しますか？' })
		.getByRole('button', { name: '削除' })
		.click()
	await expect(
		snack(page).filter({ hasText: 'S席を削除しました' }),
	).toBeVisible()
	await expect(sItem).toHaveCount(0)
	await expect(aItem).toBeVisible()
	expect(calls(log, 'TicketStockService/Delete')).toEqual([
		{ ticketStockId: { value: 'stock-seat-1' } },
	])

	// 9. Now no date stocks S席: it is deleted from the concert.
	await page
		.getByRole('navigation', { name: 'パンくずリスト' })
		.getByRole('link', { name: 'XX 単独公演' })
		.click()
	await seatTypeItem(page, 'S席').getByRole('button', { name: '削除' }).click()
	await confirmDialog(page, { name: 'S席を削除しますか？' })
		.getByRole('button', { name: '削除' })
		.click()
	await expect(
		snack(page).filter({ hasText: 'S席を削除しました' }),
	).toBeVisible()
	await expect(seatTypeItem(page, 'S席')).toHaveCount(0)
	await expect(seatTypeItem(page, 'A席')).toBeVisible()
	expect(calls(log, 'SeatTypeService/Delete')).toEqual([
		{ seatTypeId: { value: 'seat-1' } },
	])
})

test('a seat type the server finds stocked is refused with its reason', async ({
	page,
}) => {
	// The page read no stock, but a date stocked S席 since (another member).
	await page.clock.setFixedTime(NOW)
	const api = server()
	api.rpc['SeatTypeService/ListBySeries'] = seatTypesOf('s-solo', [
		{ id: 'seat-1', name: 'S席', price: 8000 },
	])
	api.rpc['SeatTypeService/Delete'] = () =>
		connectError('failed_precondition', 'seat type in use')
	const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })
	await page.goto(CONCERT)

	await seatTypeItem(page, 'S席').getByRole('button', { name: '削除' }).click()
	await confirmDialog(page, { name: 'S席を削除しますか？' })
		.getByRole('button', { name: '削除' })
		.click()

	await expect(
		snack(page).filter({
			hasText: 'S席は公演日に枚数があるため削除できません。',
		}),
	).toBeVisible()
	await expect(seatTypeItem(page, 'S席')).toBeVisible()
	expect(calls(log, 'SeatTypeService/Delete')).toHaveLength(1)
})
