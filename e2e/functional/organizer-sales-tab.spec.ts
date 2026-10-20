import {
	connectError,
	expectGuideLink,
	installConsole,
	type RpcMocks,
	SERIES,
	shownTime,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	type SaleSpec,
	salesOf,
	seriesList,
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

function rpc(
	sales: SaleSpec[],
	options: {
		concerts?: ConcertSpec[]
		organizer?: Record<string, unknown>
	} = {},
): RpcMocks {
	return {
		'SeriesService/List': seriesList(options.concerts ?? [XX_TOUR]),
		'OrganizerService/Get': options.organizer ?? organizer(),
		'PayoutAccountService/Get': payoutAccount('ACTIVE'),
		'TicketSaleService/ListByEvent': salesOf('e-1103', sales),
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

/** A lottery of 1,200 tickets at 6,500 yen, up to 4 per account. */
function lottery(
	over: Partial<SaleSpec> & Pick<SaleSpec, 'id' | 'start'>,
): SaleSpec {
	return {
		name: 'ファンクラブ先行',
		method: 'LOTTERY',
		end: jst('2026-10-17', '23:59'),
		price: 6500,
		quantity: 1200,
		perAccountLimit: 4,
		...over,
	}
}

/** The 一般発売 first-come sale of 150 tickets. */
function firstCome(over: Partial<SaleSpec> = {}): SaleSpec {
	return {
		id: 'sale-general',
		name: '一般発売',
		method: 'FIRST_COME',
		start: jst('2026-10-20', '10:00'),
		end: jst('2026-11-03', '17:00'),
		price: 7000,
		quantity: 150,
		perAccountLimit: 4,
		typeState: 'NOT_YET_ON_SALE',
		sold: 0,
		held: 0,
		...over,
	}
}

const OPEN_LOTTERY = lottery({
	id: 'sale-open',
	start: jst('2026-10-05', '12:00'),
	end: jst('2026-10-12', '23:59'),
	stats: { entries: 412, requested: 1380 },
})

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
		await expect(row).toContainText('6,500円')
		await expect(row).toContainText('1,200枚')
		await expect(row).toContainText('1人4枚まで')
		await expect(row).toContainText('抽選')
	})

	test(`@spec ${SPEC} "Open lottery, oversubscribed"`, async ({ page }) => {
		await open(page, rpc([OPEN_LOTTERY]))

		const row = sale(page, 'sale-open')
		await expect(row.locator('status-badge')).toHaveText('受付中')
		await expect(tile(row, '応募数')).toContainText('412')
		await expect(tile(row, '申込枚数')).toContainText('1,380')
		await expect(tile(row, '販売枚数')).toContainText('1,200')
		await expect(row).toContainText('申込枚数は販売枚数の115%です。')
	})

	test(`@spec ${SPEC} "Drawn lottery"`, async ({ page }) => {
		await open(
			page,
			rpc([
				lottery({
					id: 'sale-drawn',
					start: jst('2026-09-20', '12:00'),
					end: jst('2026-09-27', '23:59'),
					drawTime: jst('2026-09-28', '12:00'),
					stats: {
						entries: 412,
						requested: 1380,
						won: 318,
						wonTickets: 1198,
						lost: 94,
					},
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
			rpc([
				firstCome({
					start: jst('2026-10-01', '10:00'),
					typeState: 'ON_SALE',
					sold: 100,
					held: 6,
				}),
			]),
		)

		const row = sale(page, 'sale-general')
		await expect(row.locator('status-badge')).toHaveText('販売中')
		await expect(row).toContainText('先着')
		await expect(tile(row, '販売済み')).toContainText('100')
		await expect(tile(row, '購入手続き中')).toContainText('6')
		await expect(tile(row, '販売枚数')).toContainText('150')
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
					drawTime: jst('2026-09-28', '12:00'),
					stats: {
						entries: 412,
						requested: 1380,
						won: 318,
						wonTickets: 1198,
						lost: 94,
					},
				}),
			]),
		)

		// One card per sale, each headed by its name right under the page title.
		await expect(
			tab(page).locator('.sales').getByRole('heading', { level: 2 }),
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
	const ON_SALE = firstCome({
		start: jst('2026-10-01', '10:00'),
		typeState: 'ON_SALE',
		sold: 57,
		held: 0,
	})

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
			const type = (body.ticketTypes as Array<Record<string, unknown>>)[0]
			created = lottery({
				id: 'sale-new',
				name: (body.name as { value: string }).value,
				start: body.saleStartTime as string,
				end: body.saleEndTime as string,
				price: Number((type.price as { value: string }).value),
				quantity: type.quantity as number,
			})
			const list = salesOf('e-1103', [created]) as { ticketSales: unknown[] }
			return { body: { ticketSale: list.ticketSales[0] } }
		}
		const log = await open(page, mocks)

		await startLottery(page).click()
		await expect(page).toHaveURL(/\/ticket-sales\/new\?method=lottery$/)
		await page.getByLabel('販売名').fill('ファンクラブ先行')
		await page.getByLabel('価格').fill('6500')
		await page.getByLabel('販売枚数').fill('1200')
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
			ticketTypes: [
				{
					eventId: { value: 'e-1103' },
					price: { value: '6500' },
					quantity: 1200,
				},
			],
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
		await expect(page.getByLabel('販売名')).toHaveValue('一般発売')
		await expect(page.getByLabel('販売開始日')).toHaveValue('2026-10-20')
		await expect.poll(() => shownTime(page, '販売開始時刻')).toBe('10:00')
		await expect(page.getByLabel('価格')).toHaveValue('7000')
		await expect(page.getByLabel('販売枚数')).toHaveValue('150')
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
		await expect(page.getByLabel('価格')).toHaveValue('6500')
		await expect(page.getByLabel('販売枚数')).toHaveValue('1200')
		await expect(page.getByLabel('1人あたりの上限枚数')).toHaveValue('4')
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
