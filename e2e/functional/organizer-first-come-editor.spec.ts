import {
	chooseTime,
	expectGuideLink,
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
	shownTime,
	timeField,
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
 * The first-come sale editor at `sales/first-come` under the event: a new
 * sale with sensible defaults that sells the event's seat types, only its
 * window changing once it exists, the prerequisites, and back to the event's
 * Sales tab.
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
const EDITOR = `${SALES}/new?method=first-come`

/** The first-come sale of the show: 11 November 12:00 to 20 November 18:00. */
const GENERAL: SaleSpec = {
	id: 'f-1',
	name: '一般発売',
	method: 'FIRST_COME',
	start: jst('2026-11-11', '12:00'),
	end: jst('2026-11-20', '18:00'),
}

const PRESALE: SaleSpec = {
	id: 'l-1',
	name: 'ファンクラブ先行',
	method: 'LOTTERY',
	start: jst('2026-11-01', '12:00'),
	end: jst('2026-11-10', '12:00'),
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

async function openEditor(page: Page, path = EDITOR, rpc: RpcMocks = {}) {
	const log = await boot(page, rpc)
	await page.goto(path)
	await expect(
		page.getByRole('button', { name: /先着販売を始める|保存する/ }),
	).toBeVisible()
	return log
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
/** The whole field (label, control, hint and error) around a control. */
const fieldBox = (page: Page, label: string) =>
	page.locator('console-field').filter({ has: page.getByLabel(label) })
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

/** The sale's opening or closing date and time as the form shows them. */
async function shownWindow(page: Page, which: 'start' | 'end') {
	const label = which === 'start' ? '販売開始' : '販売終了'
	return `${await field(page, `${label}日`).inputValue()} ${await shownTime(page, `${label}時刻`)}`
}
const snackbar = (page: Page) => page.locator('.snack-item')
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)
const save = (page: Page) =>
	page.getByRole('button', { name: /先着販売を始める|保存する/ }).click()

test.describe('a new first-come sale', () => {
	test(`@spec ${SPEC} "Blank form"`, async ({ page }) => {
		await openEditor(page)
		await expect(
			page.getByRole('heading', { level: 1, name: '先着で販売する' }),
		).toBeVisible()
		await expect.poll(() => shownWindow(page, 'end')).toBe('2026-11-20 19:00')
		await expect(field(page, '販売名')).toHaveValue('一般発売')
		const tickets = page.locator('.tickets')
		await expect(tickets.locator('.stock')).toHaveText([
			/S席\s*8,000円 税込 · 300枚/,
			/A席\s*6,000円 税込 · 700枚/,
		])
		await expect(tickets).toContainText('すべての席種を売ります')
		await expect(tickets).toContainText('1アカウント4枚まで')
		// The sale has no price, quantity or limit of its own.
		await expect(page.getByLabel('価格')).toHaveCount(0)
		await expect(page.getByLabel('1人あたりの上限枚数')).toHaveCount(0)
		await expect(fieldBox(page, '販売終了日')).toContainText('JST')
		await expect(timeField(page, '販売終了時刻')).toContainText('JST')
	})

	test(`@spec ${SPEC} "End after the show starts"`, async ({ page }) => {
		const log = await openEditor(page)
		await enterWindow(page, 'start', '2026-11-11', '12:00')
		await enterWindow(page, 'end', '2026-11-20', '19:30')
		await save(page)

		await expect(fieldBox(page, '販売終了日')).toContainText(
			'販売終了は開演時刻',
		)
		await expect(field(page, '販売終了日')).toHaveAttribute(
			'aria-invalid',
			'true',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Overlapping a presale"`, async ({ page }) => {
		const log = await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': salesOf('e-1120', [PRESALE]),
		})
		await enterWindow(page, 'start', '2026-11-08', '12:00')
		await save(page)

		await expect(
			page.getByText(/販売「ファンクラブ先行」.*と期間が重なっています/),
		).toBeVisible()
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

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

	test(`@spec ${SPEC} "Breadcrumb"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openEditor(
			page,
			`${SERIES}/s-tour/events/e-1103/ticket-sales/new?method=first-come`,
			{
				'TicketSaleService/ListByEvent': salesOf('e-1103', []),
			},
		)
		const crumbs = page.getByRole('navigation', { name: 'パンくずリスト' })
		await expect(crumbs.getByRole('listitem')).toHaveText([
			'公演',
			'XX Tour 2026',
			'11月3日(火)',
			'先着で販売',
		])
		await expect(
			crumbs.getByRole('link', { name: '11月3日(火)' }),
		).toHaveAttribute('href', /\/series\/s-tour\/events\/e-1103\/ticket-sales$/)
	})
})

test.describe('a sale that has started', () => {
	test(`@spec ${SPEC} "Nothing else to edit"`, async ({ page }) => {
		await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': salesOf('e-1120', [GENERAL]),
		})
		await expect(
			page.getByRole('heading', { level: 1, name: '先着販売を変更' }),
		).toBeVisible()
		// The name is shown, the window is the only thing to change.
		await expect(page.locator('.fixed')).toContainText('一般発売')
		await expect(page.locator('form console-field')).toHaveCount(2)
		await expect(page.getByLabel('価格')).toHaveCount(0)
		await expect(page.getByLabel('販売枚数')).toHaveCount(0)
		await expect(page.getByLabel('1人あたりの上限枚数')).toHaveCount(0)
		await expect(field(page, '販売開始日')).toBeVisible()
		await expect(field(page, '販売終了日')).toBeVisible()
	})

	test(`@spec ${SPEC} "Sale extended"`, async ({ page }) => {
		const store = salesStore('e-1120', [GENERAL])
		const log = await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketSaleService/SetWindow': () => {
				const longer = { ...GENERAL, end: jst('2026-11-20', '19:00') }
				store.set([longer])
				return { body: { ticketSale: oneSale('e-1120', longer) } }
			},
		})
		await expect.poll(() => shownWindow(page, 'end')).toBe('2026-11-20 18:00')
		await chooseTime(page, '販売終了時刻', '19:00')
		await save(page)

		await expect(page).toHaveURL(/\/ticket-sales$/)
		const body = calls(log, 'TicketSaleService/SetWindow')[0].body as {
			ticketSaleId: { value: string }
			saleStartTime: string
			saleEndTime: string
		}
		expect(body.ticketSaleId).toEqual({ value: 'f-1' })
		expect(new Date(body.saleStartTime).toISOString()).toBe(
			jst('2026-11-11', '12:00'),
		)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-11-20', '19:00'),
		)
		const sale = page.locator('[data-sale="f-1"]')
		await expect(sale).toContainText('11月20日(金) 19:00')
	})
})

test.describe('prerequisites', () => {
	test(`@spec ${SPEC} "No start time"`, async ({ page }) => {
		const untimed: ConcertSpec = {
			...SHOW,
			events: [{ ...SHOW.events[0], start: undefined }],
		}
		await boot(page, { 'SeriesService/List': seriesList([untimed]) })
		await page.goto(EDITOR)

		await expect(
			page.getByRole('heading', { name: '開始時刻を設定してください' }),
		).toBeVisible()
		await expect(
			page.getByRole('link', { name: '公演を編集' }),
		).toHaveAttribute('href', /\/series\/s-show\/edit$/)
		await expectGuideLink(
			page.locator('prerequisite-callout').filter({
				hasText: '開始時刻を設定してください',
			}),
			'publish',
		)
		await expect(
			page.getByRole('button', { name: /先着販売を始める|保存する/ }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "No seat type stocked"`, async ({ page }) => {
		await boot(page, {
			'TicketStockService/ListByEvent': stocksOf('e-1120', []),
		})
		await page.goto(EDITOR)

		const callout = page.locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '席種と枚数を追加してください' }),
		).toBeVisible()
		await expect(
			callout.getByRole('link', { name: '席種と枚数へ' }),
		).toHaveAttribute('href', /\/series\/s-show\/events\/e-1120\/ticket-sales$/)
		await expectGuideLink(callout, 'sell')
		await expect(
			page.getByRole('button', { name: /先着販売を始める|保存する/ }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Business details incomplete"`, async ({ page }) => {
		await boot(page, {
			'OrganizerService/Get': organizer('XX Records', ['businessPhoneNumber']),
		})
		await page.goto(EDITOR)

		const callout = page.locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '事業者情報が未登録です' }),
		).toBeVisible()
		await expect(callout).toContainText(
			'審査のときに Liverty Music が登録します',
		)
		await expectGuideLink(callout, 'business-and-payout')
		await expect(
			page.getByRole('button', { name: /先着販売を始める|保存する/ }),
		).toHaveCount(0)
	})
})
