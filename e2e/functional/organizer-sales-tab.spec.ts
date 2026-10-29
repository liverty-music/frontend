import {
	confirmDialog,
	connectError,
	expectGuideLink,
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
 * The event page's Sales tab: prerequisites, the event's sales by state,
 * starting and editing a sale and changing its verification requirement.
 * "Now" is fixed at 2026-10-08 09:00 JST.
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
const stocks = (page: Page) => tab(page).getByTestId('ticket-stocks')
const stock = (page: Page, id: string) => page.locator(`[data-stock="${id}"]`)
const tile = (scope: ReturnType<Page['locator']>, label: string) =>
	scope
		.locator('stat-tile')
		.filter({ has: scope.page().getByText(label, { exact: true }) })
const snackbar = (page: Page) =>
	page.locator('console-snackbar [role="status"]')
const startLottery = (page: Page) =>
	tab(page).getByRole('link', { name: '抽選で販売する' })
const startFirstCome = (page: Page) =>
	tab(page).getByRole('link', { name: '先着で販売する' })

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

const OPEN_LOTTERY = lottery({
	id: 'sale-open',
	start: jst('2026-10-05', '12:00'),
	end: jst('2026-10-12', '23:59'),
	stats: [{ stock: S_STOCK, entries: 412, requested: 1380 }],
})

const DRAWN_STATS = [
	{
		stock: S_STOCK,
		entries: 412,
		requested: 1380,
		won: 318,
		wonTickets: 1198,
		lost: 94,
	},
]

test.describe('prerequisites', () => {
	test(`@spec ${SPEC} "Draft event"`, async ({ page }) => {
		await open(
			page,
			rpc([], { concerts: [XX_SOLO] }),
			`${SERIES}/s-solo/events/e-1220/ticket-sales`,
		)

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', {
				name: '販売を始めるには、公演を公開してください',
			}),
		).toBeVisible()
		await expect(
			callout.getByRole('button', { name: '公開する' }),
		).toBeVisible()
		await expectGuideLink(callout, 'publish')
		await expect(startLottery(page)).toHaveCount(0)
		await expect(startFirstCome(page)).toHaveCount(0)
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

	test(`@spec ${SPEC} "No start time"`, async ({ page }) => {
		const untimed: ConcertSpec = {
			...XX_TOUR,
			events: [{ ...XX_TOUR.events[0], start: undefined }],
		}
		await open(page, rpc([], { concerts: [untimed] }))

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '開始時刻を設定してください' }),
		).toBeVisible()
		await expect(
			callout.getByRole('link', { name: '公演を編集' }),
		).toHaveAttribute('href', /\/series\/s-tour\/edit$/)
		await expectGuideLink(callout, 'publish')
		await expect(startLottery(page)).toHaveCount(0)
		await expect(startFirstCome(page)).toHaveCount(0)
	})

	test(`@spec ${SPEC} "No seat type stocked"`, async ({ page }) => {
		await open(page, rpc([], { stocks: [] }))

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '席種と枚数を追加してください' }),
		).toBeVisible()
		await expect(callout).toContainText('下の「席種と枚数」で')
		await expectGuideLink(callout, 'sell')
		await expect(startLottery(page)).toHaveCount(0)
		await expect(startFirstCome(page)).toHaveCount(0)
		// The section it points to is on the same tab, with its add form.
		await expect(
			stocks(page).getByRole('heading', { level: 2, name: '席種と枚数' }),
		).toBeVisible()
		await expect(
			stocks(page).getByRole('button', { name: '席種を追加' }),
		).toBeVisible()
	})

	test(`@spec ${SPEC} "Business details incomplete"`, async ({ page }) => {
		await open(
			page,
			rpc([], { organizer: organizer('XX Records', ['businessAddress']) }),
		)

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '事業者情報が未登録です' }),
		).toBeVisible()
		await expect(callout).toContainText(
			'審査のときに Liverty Music が登録します',
		)
		await expect(callout).toContainText(
			'Liverty Music の担当者にご連絡ください',
		)
		// No fix in the console: the only link is the guide's chapter.
		await expect(callout.getByRole('link')).toHaveCount(1)
		await expectGuideLink(callout, 'business-and-payout')
		await expect(startLottery(page)).toHaveCount(0)
		await expect(startFirstCome(page)).toHaveCount(0)
	})
})

test.describe('the sales list', () => {
	test(`@spec ${SPEC} "No sale yet"`, async ({ page }) => {
		await open(page, rpc([]))

		await expect(tab(page)).toContainText('この公演日の販売はまだありません')
		await expect(startLottery(page)).toBeVisible()
		await expect(startFirstCome(page)).toBeVisible()
		await expect(tab(page).locator('prerequisite-callout')).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Scheduled lottery"`, async ({ page }) => {
		await open(
			page,
			rpc([lottery({ id: 'sale-fc', start: jst('2026-10-10', '12:00') })]),
		)

		const row = sale(page, 'sale-fc')
		await expect(row.locator('status-badge')).toHaveText('受付開始前')
		await expect(row.locator('.countdown')).toHaveText('あと 2日 3時間')
		await expect(row).toContainText(
			'10月10日(土) 12:00 〜 10月17日(土) 23:59 JST',
		)
		await expect(row).toContainText('抽選')
		// Said once above the list: the seat types are shared, the limit is the event's.
		await expect(tab(page)).toContainText(
			'1アカウントの上限は、この公演日のすべての販売を合わせて4枚です。',
		)
	})

	test(`@spec ${SPEC} "Open lottery, oversubscribed"`, async ({ page }) => {
		await open(page, rpc([OPEN_LOTTERY]))

		const row = sale(page, 'sale-open')
		await expect(row.locator('status-badge')).toHaveText('受付中')
		const s = row.locator('[data-lottery-stock="stock-s"]')
		await expect(s.getByRole('heading', { name: 'S席' })).toBeVisible()
		await expect(tile(s, '応募数')).toContainText('412')
		await expect(tile(s, '申込枚数')).toContainText('1,380')
		await expect(tile(s, '残り')).toContainText('1,200')
		await expect(s).toContainText('申込枚数は残りの枚数の115%です。')
	})

	test(`@spec ${SPEC} "Drawn lottery"`, async ({ page }) => {
		await open(
			page,
			rpc([
				lottery({
					id: 'sale-drawn',
					start: jst('2026-09-20', '12:00'),
					end: jst('2026-09-27', '23:59'),
					stats: DRAWN_STATS,
				}),
			]),
		)

		const row = sale(page, 'sale-drawn')
		await expect(row.locator('status-badge')).toHaveText('抽選済み')
		await expect(tile(row, '当選')).toContainText('318')
		await expect(tile(row, '当選枚数')).toContainText('1,198')
		await expect(tile(row, '落選')).toContainText('94')
	})

	test(`@spec ${SPEC} "First-come sale on sale"`, async ({ page }) => {
		await open(
			page,
			rpc([firstCome({ start: jst('2026-10-01', '10:00') })], {
				stocks: [
					{
						id: 'stock-s',
						seatType: S_SEAT,
						quantity: 150,
						sold: 100,
						held: 6,
					},
				],
			}),
		)

		const row = sale(page, 'sale-general')
		await expect(row.locator('status-badge')).toHaveText('受付中')
		await expect(row).toContainText('先着')
		const s = stock(page, 'stock-s')
		await expect(s.getByRole('heading', { name: 'S席' })).toBeVisible()
		await expect(tile(s, '販売済み')).toContainText('100')
		await expect(tile(s, '購入手続き中')).toContainText('6')
		await expect(tile(s, '販売枚数')).toContainText('150')
	})

	test(`@spec ${SPEC} "Presale drawn, general sale scheduled"`, async ({
		page,
	}) => {
		// The general sale is listed first by the server; the tab orders by start.
		await open(
			page,
			rpc([
				firstCome(),
				lottery({
					id: 'sale-fc',
					start: jst('2026-09-20', '12:00'),
					end: jst('2026-09-27', '23:59'),
					stats: DRAWN_STATS,
				}),
			]),
		)

		// One card per sale, each headed by its name under the section 販売.
		await expect(
			tab(page).getByRole('heading', { level: 2, name: '販売', exact: true }),
		).toBeVisible()
		await expect(
			tab(page).locator('.sales').getByRole('heading', { level: 3 }),
		).toHaveText(['ファンクラブ先行', '一般発売'])
		await expect(sale(page, 'sale-fc').locator('status-badge')).toHaveText(
			'抽選済み',
		)
		await expect(sale(page, 'sale-general').locator('status-badge')).toHaveText(
			'受付開始前',
		)
		await expect(startLottery(page)).toBeVisible()
		// The event already has its first-come sale.
		await expect(startFirstCome(page)).toHaveCount(0)
		// Starting a sale is an outlined button above the cards.
		await expect(startLottery(page)).toHaveAttribute('data-variant', 'outlined')
		const above = await tab(page).evaluate((host) => {
			const start = host.querySelector('.start-actions')
			const list = host.querySelector('.sales')
			return !!(
				start &&
				list &&
				start.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
			)
		})
		expect(above).toBe(true)
	})
})

test.describe('purchases per referral code', () => {
	const referrals = (page: Page) => tab(page).getByTestId('referrals')
	const ON_SALE = firstCome({ start: jst('2026-10-01', '10:00') })

	function withReferrals(stats: Record<string, unknown>[]): RpcMocks {
		const mocks = rpc([ON_SALE])
		mocks['TicketSaleService/ListByEvent'] = {
			...(salesOf('e-1103', [ON_SALE]) as Record<string, unknown>),
			referralCodeStats: stats,
		}
		return mocks
	}

	test(`@spec ${SPEC} "Two codes and direct purchases"`, async ({ page }) => {
		// The server lists the direct group among the codes by Order count;
		// the tab moves it last.
		await open(
			page,
			withReferrals([
				{ orderCount: 40, ticketCount: 71, amount: '461500' },
				{
					code: { value: 'member-a' },
					orderCount: 12,
					ticketCount: 21,
					amount: '136500',
				},
				{
					code: { value: 'member-b' },
					orderCount: 5,
					ticketCount: 8,
					amount: '52000',
				},
			]),
		)

		const section = referrals(page)
		await expect(
			section.getByRole('heading', { level: 2, name: '紹介コード別の購入' }),
		).toBeVisible()
		await expect(section).toContainText('支払い済みの購入だけを数えます。')
		await expect(section).toContainText('返金された購入は数えません。')
		await expect(section).toContainText(
			'抽選は、当選して決済されたときに数えます。',
		)
		const table = section.getByRole('table', { name: '紹介コード別の購入' })
		const rows = table.getByRole('row')
		await expect(rows).toHaveCount(4)
		const expected = [
			['member-a', '12件', '21枚', '136,500円'],
			['member-b', '5件', '8枚', '52,000円'],
			['直接（コードなし）', '40件', '71枚', '461,500円'],
		]
		for (const [i, cells] of expected.entries()) {
			await expect(rows.nth(i + 1).getByRole('cell')).toHaveText(cells.slice(1))
			await expect(rows.nth(i + 1).getByRole('rowheader')).toHaveText(cells[0])
		}
		// Read-only: codes are not registered, edited or removed here.
		await expect(section.getByRole('button')).toHaveCount(0)
		await expect(section.getByRole('link')).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Sale with no purchase yet"`, async ({ page }) => {
		await open(page, withReferrals([]))

		await expect(referrals(page)).toContainText('まだ購入はありません')
		await expect(referrals(page).getByRole('table')).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Event without a sale"`, async ({ page }) => {
		await open(page, rpc([]))

		await expect(tab(page)).toContainText('この公演日の販売はまだありません')
		await expect(referrals(page)).toHaveCount(0)
		await expect(tab(page)).not.toContainText('紹介コード別の購入')
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

	test(`@spec ${SPEC} "Edit a lottery before it opens"`, async ({ page }) => {
		await open(
			page,
			rpc([
				lottery({
					id: 'sale-tomorrow',
					start: jst('2026-10-09', '12:00'),
					end: jst('2026-10-16', '23:59'),
				}),
			]),
		)

		await sale(page, 'sale-tomorrow')
			.getByRole('link', { name: '編集' })
			.click()
		await expect(page).toHaveURL(/\/ticket-sales\/sale-tomorrow\/edit$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '抽選販売を変更' }),
		).toBeVisible()
		await expect(page.getByLabel('受付開始日')).toHaveValue('2026-10-09')
		await expect.poll(() => shownTime(page, '受付開始時刻')).toBe('12:00')
		await expect(page.getByLabel('受付終了日')).toHaveValue('2026-10-16')
		// A minute off the 5-minute steps is shown as saved.
		expect(await shownTime(page, '受付終了時刻')).toBe('23:59')
		await expect(
			page.locator('lottery-sale-editor-route .fixed'),
		).toContainText('ファンクラブ先行')
	})

	test(`@spec ${SPEC} "Lottery already open"`, async ({ page }) => {
		await open(page, rpc([OPEN_LOTTERY]))

		const row = sale(page, 'sale-open')
		await expect(row.getByRole('button', { name: '編集' })).toBeDisabled()
		await expect(row.getByRole('link', { name: '編集' })).toHaveCount(0)
		await expect(row).toContainText('受付開始後は変更できません')
	})
})

test.describe('verification requirement', () => {
	const select = (page: Page) =>
		sale(page, 'sale-open').getByLabel('本人確認', { exact: true })

	test(`@spec ${SPEC} "Tighten while open"`, async ({ page }) => {
		const mocks = rpc([OPEN_LOTTERY])
		const updated = salesOf('e-1103', [
			{ ...OPEN_LOTTERY, verification: 'JPKI_ONLY' },
		]) as {
			ticketSales: unknown[]
		}
		mocks['TicketSaleService/SetVerificationRequirement'] = {
			ticketSale: updated.ticketSales[0],
		}
		const log = await open(page, mocks)

		await expect(select(page).locator('option:checked')).toHaveText(
			'本人確認なし',
		)
		await expect(sale(page, 'sale-open')).toContainText(
			'すでに受け付けた申込は確認し直しません',
		)
		await select(page).selectOption({
			label: 'マイナンバーカードで本人確認済み',
		})

		await expect(
			snackbar(page).filter({ hasText: '本人確認の設定を変更しました' }),
		).toBeVisible()
		await expect(select(page).locator('option:checked')).toHaveText(
			'マイナンバーカードで本人確認済み',
		)
		const call = log.calls.find(
			(c) => c.method === 'TicketSaleService/SetVerificationRequirement',
		)
		expect(call?.body).toEqual({
			ticketSaleId: { value: 'sale-open' },
			verificationRequirement: 'VERIFICATION_REQUIREMENT_JPKI_ONLY',
		})
	})

	test(`@spec ${SPEC} "Change fails"`, async ({ page }) => {
		const mocks = rpc([OPEN_LOTTERY])
		mocks['TicketSaleService/SetVerificationRequirement'] = () =>
			connectError('unavailable', 'network down', 503)
		await open(page, mocks)

		await select(page).selectOption({
			label: 'マイナンバーカードで本人確認済み',
		})

		const error = snackbar(page).filter({
			hasText: '本人確認の設定を変更できませんでした',
		})
		await expect(error).toBeVisible()
		await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
		await expect(select(page).locator('option:checked')).toHaveText(
			'本人確認なし',
		)
		await expect(select(page)).toHaveValue('0')
	})
})

test.describe('seat types and quantities', () => {
	test(`@spec ${SPEC} "Two seat types stocked"`, async ({ page }) => {
		const stocked: StockSpec[] = []
		const mocks = rpc([], { stocks: [] })
		mocks['TicketStockService/ListByEvent'] = () => ({
			body: stocksOf('e-1103', stocked),
		})
		mocks['TicketStockService/Create'] = (body) => {
			const seat = [S_SEAT, A_SEAT].find(
				(t) => t.id === (body.seatTypeId as { value: string }).value,
			)
			const added: StockSpec = {
				id: `stock-${seat?.id}`,
				seatType: seat ?? S_SEAT,
				quantity: body.quantity as number,
			}
			stocked.push(added)
			return {
				body: {
					ticketStock: (
						stocksOf('e-1103', [added]) as { ticketStocks: unknown[] }
					).ticketStocks[0],
				},
			}
		}
		const log = await open(page, mocks)

		for (const [label, quantity] of [
			['S席（8,000円）', '300'],
			['A席（6,000円）', '700'],
		]) {
			await stocks(page)
				.getByLabel(/^席種 /)
				.selectOption({ label })
			await stocks(page)
				.getByRole('spinbutton', { name: /^枚数/ })
				.fill(quantity)
			await stocks(page).getByRole('button', { name: '席種を追加' }).click()
			const dialog = confirmDialog(page)
			await expect(dialog).toContainText('枚数はあとから変えられません')
			await expect(dialog).toContainText('すべての販売が、この枚数から売ります')
			await dialog.getByRole('button', { name: '席種を追加' }).click()
		}

		await expect(stock(page, 'stock-seat-s')).toContainText(
			'8,000円 税込 · 300枚',
		)
		await expect(stock(page, 'stock-seat-a')).toContainText(
			'6,000円 税込 · 700枚',
		)
		for (const id of ['stock-seat-s', 'stock-seat-a']) {
			await expect(stock(page, id).locator('status-badge')).toHaveText('販売可')
			await expect(tile(stock(page, id), '販売済み')).toContainText('0')
			await expect(tile(stock(page, id), '購入手続き中')).toContainText('0')
		}
		expect(
			log.calls
				.filter((c) => c.method === 'TicketStockService/Create')
				.map((c) => c.body),
		).toEqual([
			{
				eventId: { value: 'e-1103' },
				seatTypeId: { value: 'seat-s' },
				quantity: 300,
			},
			{
				eventId: { value: 'e-1103' },
				seatTypeId: { value: 'seat-a' },
				quantity: 700,
			},
		])
		// Every seat type of the concert is stocked: nothing left to add.
		await expect(
			stocks(page).getByRole('button', { name: '席種を追加' }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "More tickets later"`, async ({ page }) => {
		const ANNOTATED = { id: 'seat-note', name: '注釈付き指定席', price: 7000 }
		await open(
			page,
			rpc([], {
				stocks: [{ id: 'stock-s', seatType: S_SEAT, quantity: 300, sold: 300 }],
				seatTypes: [S_SEAT, ANNOTATED],
			}),
		)

		const s = stock(page, 'stock-s')
		await expect(s.locator('status-badge')).toHaveText('完売')
		// No field or action changes a stock's quantity.
		await expect(s.getByRole('spinbutton')).toHaveCount(0)
		await expect(s.getByRole('button')).toHaveCount(0)
		// The concert's other seat type can be stocked instead.
		const options = stocks(page)
			.getByLabel(/^席種 /)
			.locator('option')
		await expect(options).toHaveText([
			'選んでください',
			'注釈付き指定席（7,000円）',
		])
	})

	test(`@spec ${SPEC} "Stock already ordered"`, async ({ page }) => {
		await open(
			page,
			rpc([], {
				stocks: [
					{ id: 'stock-s', seatType: S_SEAT, quantity: 300, sold: 2 },
					{ id: 'stock-a', seatType: A_SEAT, quantity: 700 },
				],
			}),
		)

		await expect(
			stock(page, 'stock-s').getByRole('button', { name: '削除' }),
		).toHaveCount(0)
		await expect(
			stock(page, 'stock-a').getByRole('button', { name: '削除' }),
		).toBeVisible()
	})

	test('says a stock with an entry cannot be deleted when the server refuses', async ({
		page,
	}) => {
		const mocks = rpc([], {
			stocks: [{ id: 'stock-a', seatType: A_SEAT, quantity: 700 }],
		})
		mocks['TicketStockService/Delete'] = () =>
			connectError('failed_precondition', 'stock has orders')
		await open(page, mocks)

		await stock(page, 'stock-a').getByRole('button', { name: '削除' }).click()
		await confirmDialog(page, { name: 'A席を削除しますか？' })
			.getByRole('button', { name: '削除' })
			.click()

		await expect(
			snackbar(page).filter({
				hasText: 'A席は申込または購入があるため削除できません。',
			}),
		).toBeVisible()
		await expect(stock(page, 'stock-a')).toBeVisible()
	})

	test(`@spec ${SPEC} "Concert without seat types"`, async ({ page }) => {
		await open(page, rpc([], { stocks: [], seatTypes: [] }))

		await expect(stocks(page)).toContainText(
			'この公演にはまだ席種がありません。公演ページで席種を追加してください。',
		)
		await expect(
			stocks(page).getByRole('link', { name: '公演ページへ' }),
		).toHaveAttribute('href', /\/series\/s-tour$/)
		await expect(
			stocks(page).getByRole('button', { name: '席種を追加' }),
		).toHaveCount(0)
	})
})
