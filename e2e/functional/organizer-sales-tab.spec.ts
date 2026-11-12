import {
	installConsole,
	type RpcMocks,
	SERIES,
	shownTime,
} from '../support/organizer'
import {
	A_SEAT,
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	S_SEAT,
	type SaleSpec,
	type StockSpec,
	salesOf,
	seatTypesOf,
	seriesList,
	stocksOf,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The event page's Sales tab where it needs the real console: the publish
 * callout's colour and the dialog it opens, and the journeys from the tab to
 * a sale editor and back. What the tab renders and sends is tested in
 * test/organizer/event/sales-tab.spec.ts. "Now" is fixed at 2026-10-08 09:00
 * JST.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'
const NOW = new Date('2026-10-08T09:00:00+09:00')
const SALES = `${SERIES}/s-tour/events/e-1103/ticket-sales`

/** S席 of the 3 November event: 1,500 tickets, 300 sold, so 1,200 remain. */
const S_STOCK: StockSpec = {
	id: 'stock-s',
	seatType: S_SEAT,
	quantity: 1500,
	sold: 300,
}

function rpc(
	sales: SaleSpec[],
	options: {
		concerts?: ConcertSpec[]
		organizer?: Record<string, unknown>
		stocks?: StockSpec[]
		seatTypes?: (typeof S_SEAT)[]
	} = {},
): RpcMocks {
	return {
		'SeriesService/List': seriesList(options.concerts ?? [XX_TOUR]),
		'OrganizerService/Get': options.organizer ?? organizer(),
		'PayoutAccountService/Get': payoutAccount('ACTIVE'),
		'TicketSaleService/ListByEvent': salesOf('e-1103', sales),
		'TicketStockService/ListByEvent': stocksOf(
			'e-1103',
			options.stocks ?? [S_STOCK],
		),
		'SeatTypeService/ListBySeries': seatTypesOf(
			's-tour',
			options.seatTypes ?? [S_SEAT, A_SEAT],
		),
		'ScannerService/ListByEvent': { scanners: [] },
	}
}

async function open(page: Page, mocks: RpcMocks, path = SALES) {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, { rpc: mocks, language: 'ja' })
	await page.goto(path)
	return log
}

const tab = (page: Page) => page.locator('sales-tab')
const sale = (page: Page, id: string) => page.locator(`[data-sale="${id}"]`)
const snackbar = (page: Page) =>
	page.locator('console-snackbar [role="status"]')
const startLottery = (page: Page) =>
	tab(page).getByRole('link', { name: '抽選で販売する' })
/** A lottery of the event, drawing from its stocks. */
function lottery(
	over: Partial<SaleSpec> & Pick<SaleSpec, 'id' | 'start'>,
): SaleSpec {
	return {
		name: 'ファンクラブ先行',
		method: 'LOTTERY',
		end: jst('2026-10-17', '23:59'),
		...over,
	}
}

/** The 一般発売 first-come sale. */
function firstCome(over: Partial<SaleSpec> = {}): SaleSpec {
	return {
		id: 'sale-general',
		name: '一般発売',
		method: 'FIRST_COME',
		start: jst('2026-10-20', '10:00'),
		end: jst('2026-11-03', '17:00'),
		...over,
	}
}

test.describe('prerequisites', () => {
	test(`@spec ${SPEC} "Draft event"`, async ({ page }) => {
		await open(
			page,
			rpc([], { concerts: [XX_SOLO] }),
			`${SERIES}/s-solo/events/e-1220/ticket-sales`,
		)

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('button', { name: '公開する' }),
		).toBeVisible()
		// The fix is in the callout's own text color, not the brand color,
		// which marks only the page's primary action (design-tokens).
		const colorOf = (el: Element) => getComputedStyle(el).color
		const fixColor = await callout
			.getByRole('button', { name: '公開する' })
			.evaluate(colorOf)
		expect(fixColor).toBe(await callout.getByRole('heading').evaluate(colorOf))
		expect(fixColor).not.toBe(
			await page
				.locator('event-route console-button[data-action="publish"]')
				.evaluate(
					(el) =>
						getComputedStyle(el.shadowRoot?.querySelector('button') ?? el)
							.backgroundColor,
				),
		)

		// The link opens the event's publish confirmation.
		await callout.getByRole('button', { name: '公開する' }).click()
		await expect(
			page.getByRole('dialog', { name: /公開しますか/ }),
		).toBeVisible()
	})
})

test.describe('starting and editing a sale', () => {
	test(`@spec ${SPEC} "Lottery created"`, async ({ page }) => {
		let created: SaleSpec | null = null
		const mocks = rpc([])
		mocks['TicketSaleService/ListByEvent'] = () => ({
			body: salesOf('e-1103', created ? [created] : []),
		})
		mocks['TicketSaleService/Create'] = (body) => {
			created = lottery({
				id: 'sale-new',
				name: (body.name as { value: string }).value,
				start: body.saleStartTime as string,
				end: body.saleEndTime as string,
			})
			const list = salesOf('e-1103', [created]) as { ticketSales: unknown[] }
			return { body: { ticketSale: list.ticketSales[0] } }
		}
		const log = await open(page, mocks)

		await startLottery(page).click()
		await expect(page).toHaveURL(/\/ticket-sales\/new\?method=lottery$/)
		await page.getByLabel('販売名').fill('ファンクラブ先行')
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(page).toHaveURL(/\/events\/e-1103\/ticket-sales$/)
		const row = sale(page, 'sale-new')
		await expect(row.locator('.sale-name')).toHaveText('ファンクラブ先行')
		await expect(row.locator('status-badge')).toHaveText(
			/^\s*(受付開始前|受付中)\s*$/,
		)
		await expect(
			snackbar(page).filter({
				hasText: '「ファンクラブ先行」の抽選販売をつくりました',
			}),
		).toBeVisible()

		const create = log.calls.find(
			(c) => c.method === 'TicketSaleService/Create',
		)
		expect(create?.body).toMatchObject({
			seriesId: { value: 's-tour' },
			name: { value: 'ファンクラブ先行' },
			method: 'TICKET_SALE_METHOD_LOTTERY',
			eventIds: [{ value: 'e-1103' }],
		})
	})

	test(`@spec ${SPEC} "Edit a first-come sale"`, async ({ page }) => {
		await open(page, rpc([firstCome()]))

		// 編集 is a text button on the sale's card.
		await expect(
			sale(page, 'sale-general').getByRole('link', { name: '編集' }),
		).toHaveAttribute('data-variant', 'text')
		await sale(page, 'sale-general').getByRole('link', { name: '編集' }).click()
		await expect(page).toHaveURL(
			/\/events\/e-1103\/ticket-sales\/sale-general\/edit$/,
		)
		await expect(
			page.getByRole('heading', { level: 1, name: '先着販売を変更' }),
		).toBeVisible()
		await expect(page.getByLabel('販売開始日')).toHaveValue('2026-10-20')
		await expect.poll(() => shownTime(page, '販売開始時刻')).toBe('10:00')
		// The name is shown, not edited.
		await expect(page.locator('.fixed')).toContainText('一般発売')
	})
})
