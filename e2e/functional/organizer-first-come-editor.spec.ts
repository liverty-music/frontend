import {
	installConsole,
	type RpcLog,
	type RpcMocks,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	type SaleSpec,
	salesOf,
	seriesList,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The first-come sale editor at `sales/first-come` under the event: a new
 * sale with sensible defaults, what can change once it has started, the
 * prerequisites, and back to the event's Sales tab.
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

const SALES = '/concerts/s-show/events/e-1120/sales'
const EDITOR = `${SALES}/first-come`

/** The first-come sale of the show: 11 November 12:00 to 20 November 18:00. */
const GENERAL: SaleSpec = {
	id: 'f-1',
	name: '一般発売',
	method: 'FIRST_COME',
	start: jst('2026-11-11', '12:00'),
	end: jst('2026-11-20', '18:00'),
	price: 6500,
	quantity: 150,
	perAccountLimit: 4,
	sold: 0,
	held: 0,
}

const PRESALE: SaleSpec = {
	id: 'l-1',
	name: 'ファンクラブ先行',
	method: 'LOTTERY',
	start: jst('2026-11-01', '12:00'),
	end: jst('2026-11-10', '12:00'),
	price: 6500,
	quantity: 100,
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([SHOW, XX_TOUR]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1120', []),
	'ScannerService/ListByEvent': { scanners: [] },
	'ArtistService/List': { artists: [] },
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
	return (
		salesOf(eventId, [sale]).ticketSales as Array<{ ticketTypes: unknown[] }>
	)[0]
}

const field = (page: Page, label: string) => page.getByLabel(label)
/** The whole field (label, control, hint and error) around a control. */
const fieldBox = (page: Page, label: string) =>
	page.locator('console-field').filter({ has: page.getByLabel(label) })
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
		await expect(field(page, '販売終了')).toHaveValue('2026-11-20T19:00')
		await expect(field(page, '販売名')).toHaveValue('一般発売')
		await expect(field(page, '1人あたりの上限枚数')).toHaveValue('4')
		await expect(fieldBox(page, '販売終了')).toContainText('JST')
	})

	test(`@spec ${SPEC} "End after the show starts"`, async ({ page }) => {
		const log = await openEditor(page)
		await field(page, '販売開始').fill('2026-11-11T12:00')
		await field(page, '販売終了').fill('2026-11-20T19:30')
		await field(page, '価格').fill('6500')
		await field(page, '販売枚数').fill('150')
		await save(page)

		await expect(fieldBox(page, '販売終了')).toContainText('販売終了は開演時刻')
		await expect(field(page, '販売終了')).toHaveAttribute(
			'aria-invalid',
			'true',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Overlapping a presale"`, async ({ page }) => {
		const log = await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': salesOf('e-1120', [PRESALE]),
		})
		await field(page, '販売開始').fill('2026-11-08T12:00')
		await field(page, '価格').fill('6500')
		await field(page, '販売枚数').fill('150')
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
		await expect(page).toHaveURL(/\/sales\/first-come$/)
		await expect(field(page, '販売名')).toHaveValue('一般発売')

		await field(page, '販売開始').fill('2026-11-11T12:00')
		await field(page, '価格').fill('6500')
		await field(page, '販売枚数').fill('150')
		await save(page)

		await expect(page).toHaveURL(/\/concerts\/s-show\/events\/e-1120\/sales$/)
		await expect(
			page.getByRole('heading', { level: 3, name: '一般発売' }),
		).toBeVisible()
		await expect(snackbar(page)).toContainText('先着販売を保存しました')
		const body = calls(log, 'TicketSaleService/Create')[0].body as {
			method: string
			saleStartTime: string
			saleEndTime: string
		}
		expect(body.method).toBe('TICKET_SALE_METHOD_FIRST_COME')
		expect(new Date(body.saleStartTime).toISOString()).toBe(
			jst('2026-11-11', '12:00'),
		)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-11-20', '19:00'),
		)
	})

	test(`@spec ${SPEC} "Breadcrumb"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openEditor(page, '/concerts/s-tour/events/e-1103/sales/first-come', {
			'TicketSaleService/ListByEvent': salesOf('e-1103', []),
		})
		const crumbs = page.getByRole('navigation', { name: 'パンくずリスト' })
		await expect(crumbs.getByRole('listitem')).toHaveText([
			'公演',
			'XX Tour 2026',
			'11月3日(火)',
			'先着で販売',
		])
		await expect(
			crumbs.getByRole('link', { name: '11月3日(火)' }),
		).toHaveAttribute('href', /\/concerts\/s-tour\/events\/e-1103\/sales$/)
	})
})

test.describe('a sale that has started', () => {
	test(`@spec ${SPEC} "Price locked"`, async ({ page }) => {
		await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': salesOf('e-1120', [
				{ ...GENERAL, held: 2 },
			]),
		})
		await expect(
			page.getByRole('heading', { level: 1, name: '先着販売を変更' }),
		).toBeVisible()
		await expect(field(page, '価格')).toBeDisabled()
		await expect(fieldBox(page, '価格')).toContainText(
			'チケットが販売済みまたは購入手続き中のため、価格は変更できません。',
		)
	})

	test(`@spec ${SPEC} "More tickets"`, async ({ page }) => {
		const store = salesStore('e-1120', [GENERAL])
		const log = await openEditor(page, EDITOR, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketTypeService/Update': () => {
				const more = { ...GENERAL, quantity: 180 }
				store.set([more])
				return { body: { ticketType: oneSale('e-1120', more).ticketTypes[0] } }
			},
		})
		await expect(field(page, '販売枚数')).toHaveValue('150')
		await field(page, '販売枚数').fill('180')
		await save(page)

		await expect(page).toHaveURL(/\/sales$/)
		await expect(
			page.getByRole('listitem').filter({ hasText: '一般発売' }),
		).toContainText('180枚')
		expect(calls(log, 'TicketTypeService/Update')[0].body).toEqual({
			ticketTypeId: { value: 'type-f-1' },
			price: { value: '6500' },
			quantity: 180,
			perAccountLimit: 4,
		})
		expect(calls(log, 'TicketSaleService/SetWindow')).toHaveLength(0)
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
		await expect(field(page, '販売終了')).toHaveValue('2026-11-20T18:00')
		await field(page, '販売終了').fill('2026-11-20T19:00')
		await save(page)

		await expect(page).toHaveURL(/\/sales$/)
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
		expect(calls(log, 'TicketTypeService/Update')).toHaveLength(0)
		const sale = page.getByRole('listitem').filter({ hasText: '一般発売' })
		await expect(sale).toContainText('6,500円')
		await expect(sale).toContainText('150枚')
		await expect(sale).toContainText('1人4枚まで')
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
		).toHaveAttribute('href', /\/concerts\/s-show\/edit$/)
		await expect(
			page.getByRole('button', { name: /先着販売を始める|保存する/ }),
		).toHaveCount(0)
	})
})
