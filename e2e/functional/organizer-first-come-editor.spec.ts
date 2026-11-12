import {
	chooseTime,
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	A_SEAT,
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	S_SEAT,
	type SaleSpec,
	salesOf,
	seriesList,
	stocksOf,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The first-come sale editor reached from the event's Sales tab: only the
 * journey across two screens stays here (the form, its prerequisites and its
 * validation are tested in test/organizer/ticket-sale-editor/).
 */

const SPEC = 'components/infrastructure/organizer/web/route/ticket-sale-editor'

/** Thursday 1 October 2026, 12:00 JST. */
const NOW = new Date('2026-10-01T12:00:00+09:00')

/** A published concert with one date starting 2026-11-20 19:00 JST. */
const SHOW: ConcertSpec = {
	id: 's-show',
	title: 'XX 秋の単独公演',
	performers: [{ id: 'a-1', name: 'Band A' }],
	events: [
		{
			id: 'e-1120',
			date: '2026-11-20',
			start: '19:00',
			venue: 'Zepp Haneda',
			placeId: 'ChIJ-haneda',
			state: 'PUBLISHED',
		},
	],
}

const SALES = `${SERIES}/s-show/events/e-1120/ticket-sales`

/** The first-come sale of the show: 11 November 12:00 to 20 November 18:00. */
const GENERAL: SaleSpec = {
	id: 'f-1',
	name: '一般発売',
	method: 'FIRST_COME',
	start: jst('2026-11-11', '12:00'),
	end: jst('2026-11-20', '18:00'),
}

/** The show's stocks: S席 8,000円 × 300 and A席 6,000円 × 700. */
const STOCKS = stocksOf(
	'e-1120',
	[
		{ id: 'stock-s', seatType: S_SEAT, quantity: 300 },
		{ id: 'stock-a', seatType: A_SEAT, quantity: 700 },
	],
	's-show',
)

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([SHOW, XX_TOUR]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1120', []),
	'TicketStockService/ListByEvent': STOCKS,
	'ScannerService/ListByEvent': { scanners: [] },
}

async function boot(page: Page, rpc: RpcMocks = {}): Promise<RpcLog> {
	await page.clock.setFixedTime(NOW)
	return installConsole(page, { rpc: { ...BASE, ...rpc }, language: 'ja' })
}

/** Sales of the event that change once the sale is saved. */
function salesStore(eventId: string, initial: SaleSpec[]) {
	let sales = [...initial]
	return {
		answer: () => ({ body: salesOf(eventId, sales) }),
		set(next: SaleSpec[]) {
			sales = next
		},
	}
}

function oneSale(eventId: string, sale: SaleSpec) {
	return (salesOf(eventId, [sale]).ticketSales as unknown[])[0]
}

const field = (page: Page, label: string) => page.getByLabel(label)
/** Enters when the sale opens (`start`) or closes (`end`), in JST. */
async function enterWindow(
	page: Page,
	which: 'start' | 'end',
	date: string,
	time: string,
) {
	const label = which === 'start' ? '販売開始' : '販売終了'
	await field(page, `${label}日`).fill(date)
	await chooseTime(page, `${label}時刻`, time)
}

const snackbar = (page: Page) => page.locator('.snack-item')
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)
const save = (page: Page) =>
	page.getByRole('button', { name: /先着販売を始める|保存する/ }).click()

test.describe('a new first-come sale', () => {
	test(`@spec ${SPEC} "Back after saving"`, async ({ page }) => {
		const store = salesStore('e-1120', [])
		const log = await boot(page, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketSaleService/Create': () => {
				const created = { ...GENERAL, end: jst('2026-11-20', '19:00') }
				store.set([created])
				return { body: { ticketSale: oneSale('e-1120', created) } }
			},
		})
		await page.goto(SALES)
		await page.getByRole('link', { name: '先着で販売する' }).click()
		await expect(page).toHaveURL(/\/ticket-sales\/new\?method=first-come$/)
		await expect(field(page, '販売名')).toHaveValue('一般発売')

		await enterWindow(page, 'start', '2026-11-11', '12:00')
		await save(page)

		await expect(page).toHaveURL(
			/\/series\/s-show\/events\/e-1120\/ticket-sales$/,
		)
		await expect(
			page.getByRole('heading', { level: 3, name: '一般発売' }),
		).toBeVisible()
		await expect(snackbar(page)).toContainText('先着販売を保存しました')
		const body = calls(log, 'TicketSaleService/Create')[0].body as {
			method: string
			saleStartTime: string
			saleEndTime: string
			eventIds: unknown
		}
		expect(body.method).toBe('TICKET_SALE_METHOD_FIRST_COME')
		expect(body.eventIds).toEqual([{ value: 'e-1120' }])
		expect(new Date(body.saleStartTime).toISOString()).toBe(
			jst('2026-11-11', '12:00'),
		)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-11-20', '19:00'),
		)
	})
})
