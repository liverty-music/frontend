import {
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
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
 * The lottery sale editor reached from the event's Sales tab: only the
 * journey across two screens stays here (the form, its validation, its
 * prerequisites and its Japan-time window are tested in
 * test/organizer/lottery-sale-editor/).
 */

const SPEC = 'components/infrastructure/organizer/web/route/ticket-sale-editor'

/** Thursday 1 October 2026, 12:00 JST. */
const NOW = new Date('2026-10-01T12:00:00+09:00')

const SALES = `${SERIES}/s-tour/events/e-1103/ticket-sales`

/** An unopened lottery for 3 November: 10 to 17 October. */
const PRESALE: SaleSpec = {
	id: 'l-1',
	name: 'ファンクラブ先行',
	method: 'LOTTERY',
	start: jst('2026-10-10', '12:00'),
	end: jst('2026-10-17', '12:00'),
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1103', []),
	// The event's one stock: S席 8,000円 × 100.
	'TicketStockService/ListByEvent': stocksOf('e-1103', [
		{ id: 'stock-s', seatType: S_SEAT, quantity: 100 },
	]),
	'ScannerService/ListByEvent': { scanners: [] },
}

async function boot(
	page: Page,
	rpc: RpcMocks = {},
	now = NOW,
): Promise<RpcLog> {
	await page.clock.setFixedTime(now)
	return installConsole(page, { rpc: { ...BASE, ...rpc }, language: 'ja' })
}

/** Sales of the event that change once a sale is created or changed. */
function salesStore(eventId: string, initial: SaleSpec[]) {
	let sales = [...initial]
	return {
		answer: () => ({ body: salesOf(eventId, sales) }),
		set(next: SaleSpec[]) {
			sales = next
		},
	}
}

const field = (page: Page, label: string) =>
	page.getByLabel(label, { exact: false })
const snackbar = (page: Page) => page.locator('.snack-item')
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)
async function fillPresale(page: Page, opts: { name?: string } = {}) {
	if (opts.name !== '')
		await field(page, '販売名').fill(opts.name ?? 'ファンクラブ先行')
}

test.describe('a new lottery', () => {
	test(`@spec ${SPEC} "Back after creating"`, async ({ page }) => {
		const store = salesStore('e-1103', [])
		const log = await boot(page, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketSaleService/Create': () => {
				const created = {
					...PRESALE,
					start: jst('2026-10-01', '12:00'),
					end: jst('2026-10-11', '12:00'),
				}
				store.set([created])
				return {
					body: {
						ticketSale: (
							salesOf('e-1103', [created]).ticketSales as unknown[]
						)[0],
					},
				}
			},
		})
		await page.goto(SALES)
		await page.getByRole('link', { name: '抽選で販売する' }).click()
		await expect(page).toHaveURL(/\/ticket-sales\/new\?method=lottery$/)
		await expect(field(page, '販売名')).toBeVisible()

		await fillPresale(page)
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(page).toHaveURL(
			/\/series\/s-tour\/events\/e-1103\/ticket-sales$/,
		)
		await expect(
			page.getByRole('heading', { level: 3, name: 'ファンクラブ先行' }),
		).toBeVisible()
		await expect(snackbar(page)).toContainText(
			'「ファンクラブ先行」の抽選販売をつくりました',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(1)
	})
})
