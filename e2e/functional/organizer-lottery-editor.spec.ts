import {
	chooseTime,
	expectGuideLink,
	installConsole,
	type RpcLog,
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
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The lottery sale editor: a new lottery for one event, or a change to one
 * before it opens, with the window in Japan time, and back to the event's
 * Sales tab.
 */

const SPEC = 'components/infrastructure/organizer/web/route/ticket-sale-editor'
const SNACKBAR = 'components/infrastructure/organizer/web/global/snack-bar'
const I18N = 'components/infrastructure/organizer/web/global/i18n'

/** Thursday 1 October 2026, 12:00 JST. */
const NOW = new Date('2026-10-01T12:00:00+09:00')

const SALES = `${SERIES}/s-tour/events/e-1103/ticket-sales`
const NEW_LOTTERY = `${SALES}/new?method=lottery`

/** An unopened lottery for 3 November: 10 to 17 October, 100 tickets at 8000 yen. */
const PRESALE: SaleSpec = {
	id: 'l-1',
	name: 'ファンクラブ先行',
	method: 'LOTTERY',
	start: jst('2026-10-10', '12:00'),
	end: jst('2026-10-17', '12:00'),
	price: 8000,
	quantity: 100,
	perAccountLimit: 4,
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1103', []),
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

/** Opens the editor at `path` and waits for its form. */
async function openEditor(
	page: Page,
	path: string,
	rpc: RpcMocks = {},
	now = NOW,
) {
	const log = await boot(page, rpc, now)
	await page.goto(path)
	await expect(
		page.getByRole('button', { name: /抽選販売を始める|保存する/ }),
	).toBeVisible()
	return log
}

/** Sales of the event that change once a sale is created or changed. */
function salesStore(eventId: string, initial: SaleSpec[]) {
	let sales = [...initial]
	return {
		answer: () => ({ body: salesOf(eventId, sales) }),
		set(next: SaleSpec[]) {
			sales = next
		},
		get: () => sales,
	}
}

const field = (page: Page, label: string) =>
	page.getByLabel(label, { exact: false })
const snackbar = (page: Page) => page.locator('.snack-item')
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)
const fieldBox = (page: Page, name: string) =>
	page.locator(`[data-field="${name}"]`)

/** Enters when the window opens (`start`) or closes (`end`), in JST. */
async function enterWindow(
	page: Page,
	which: 'start' | 'end',
	date: string,
	time: string,
) {
	const label = which === 'start' ? '受付開始' : '受付終了'
	await field(page, `${label}日`).fill(date)
	await chooseTime(page, `${label}時刻`, time)
}

/** The window's opening or closing date and time as the form shows them. */
async function shownWindow(page: Page, which: 'start' | 'end') {
	const label = which === 'start' ? '受付開始' : '受付終了'
	return `${await field(page, `${label}日`).inputValue()} ${await shownTime(page, `${label}時刻`)}`
}

async function fillPresale(page: Page, opts: { name?: string } = {}) {
	if (opts.name !== '')
		await field(page, '販売名').fill(opts.name ?? 'ファンクラブ先行')
	await field(page, '販売枚数').fill('100')
	await field(page, '価格').fill('8000')
}

interface CreateBody {
	name: { value: string }
	method: string
	saleStartTime: string
	saleEndTime: string
	ticketTypes: Array<{
		eventId: { value: string }
		price: { value: string }
		quantity: number
		perAccountLimit: number
	}>
}

test.describe('a new lottery', () => {
	test(`@spec ${SPEC} "Blank lottery form"`, async ({ page }) => {
		await openEditor(page, NEW_LOTTERY)
		await expect(
			page.getByRole('heading', { level: 1, name: '抽選で販売する' }),
		).toBeVisible()
		await expect.poll(() => shownWindow(page, 'start')).toBe('2026-10-01 12:00')
		expect(await shownWindow(page, 'end')).toBe('2026-10-11 12:00')
		await expect(field(page, '1人あたりの上限枚数')).toHaveValue('4')
	})

	test(`@spec ${SPEC} "Window too long"`, async ({ page }) => {
		const log = await openEditor(page, NEW_LOTTERY)
		await fillPresale(page)
		await enterWindow(page, 'end', '2026-10-16', '12:00')
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(fieldBox(page, 'end')).toContainText(
			'受付期間は1〜14日にしてください',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Presale for one event"`, async ({ page }) => {
		const log = await openEditor(page, NEW_LOTTERY, {
			'TicketSaleService/Create': {
				ticketSale: (
					salesOf('e-1103', [
						{
							...PRESALE,
							start: jst('2026-10-01', '12:00'),
							end: jst('2026-10-11', '12:00'),
						},
					]).ticketSales as unknown[]
				)[0],
			},
		})
		await fillPresale(page)
		await page.getByRole('button', { name: '抽選販売を始める' }).click()
		await expect
			.poll(() => calls(log, 'TicketSaleService/Create').length)
			.toBe(1)

		const body = calls(log, 'TicketSaleService/Create')[0]
			.body as unknown as CreateBody
		expect(body.name).toEqual({ value: 'ファンクラブ先行' })
		expect(body.method).toBe('TICKET_SALE_METHOD_LOTTERY')
		expect(new Date(body.saleStartTime).toISOString()).toBe(
			jst('2026-10-01', '12:00'),
		)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-10-11', '12:00'),
		)
		expect(body.ticketTypes).toEqual([
			{
				eventId: { value: 'e-1103' },
				price: { value: '8000' },
				quantity: 100,
				perAccountLimit: 4,
			},
		])
	})

	test(`@spec ${SPEC} "Missing name"`, async ({ page }) => {
		const log = await openEditor(page, NEW_LOTTERY)
		await fillPresale(page, { name: '' })
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(fieldBox(page, 'name')).toContainText(
			'販売名を入力してください',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SNACKBAR} "Missing sale name"`, async ({ page }) => {
		const log = await openEditor(page, NEW_LOTTERY)
		await fillPresale(page, { name: '' })
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(fieldBox(page, 'name')).toContainText(
			'販売名を入力してください',
		)
		await expect(field(page, '販売名')).toHaveAttribute('aria-invalid', 'true')
		await expect(snackbar(page)).toHaveCount(0)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Overlapping window"`, async ({ page }) => {
		const log = await openEditor(
			page,
			`${SERIES}/s-tour/events/e-1124/ticket-sales/new?method=lottery`,
			{
				'TicketSaleService/ListByEvent': salesOf('e-1124', [
					{
						...PRESALE,
						id: 'l-early',
						name: '最速先行',
						start: jst('2026-11-01', '00:00'),
						end: jst('2026-11-10', '23:59'),
					},
				]),
			},
		)
		await fillPresale(page)
		await enterWindow(page, 'start', '2026-11-08', '12:00')
		await enterWindow(page, 'end', '2026-11-18', '12:00')
		await page.getByRole('button', { name: '抽選販売を始める' }).click()

		await expect(fieldBox(page, 'end')).toContainText('販売「最速先行」')
		await expect(fieldBox(page, 'end')).toContainText('と期間が重なっています')
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Start time not set"`, async ({ page }) => {
		const untimed: ConcertSpec = {
			...XX_TOUR,
			events: [{ ...XX_TOUR.events[0], start: undefined }],
		}
		await boot(page, { 'SeriesService/List': seriesList([untimed]) })
		await page.goto(NEW_LOTTERY)

		await expect(
			page.getByRole('heading', { name: '開始時刻を設定してください' }),
		).toBeVisible()
		await expect(
			page.getByText('販売を始めるには、公演日の開始時刻が必要です。'),
		).toBeVisible()
		await expect(
			page.getByRole('link', { name: '公演を編集' }),
		).toHaveAttribute('href', /\/series\/s-tour\/edit$/)
		await expectGuideLink(page.locator('prerequisite-callout'), 'publish')
		await expect(
			page.getByRole('button', { name: '抽選販売を始める' }),
		).toHaveCount(0)
		await expect(field(page, '販売名')).toHaveCount(0)
	})

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
			page.getByRole('heading', { level: 2, name: 'ファンクラブ先行' }),
		).toBeVisible()
		await expect(snackbar(page)).toContainText(
			'「ファンクラブ先行」の抽選販売をつくりました',
		)
		expect(calls(log, 'TicketSaleService/Create')).toHaveLength(1)
	})

	test(`@spec ${SPEC} "Breadcrumb"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openEditor(page, NEW_LOTTERY)
		const trail = page
			.getByRole('navigation', { name: 'パンくずリスト' })
			.getByRole('listitem')
		await expect(trail).toHaveText([
			'公演',
			'XX Tour 2026',
			'11月3日(火)',
			'抽選で販売',
		])
		await expect(
			page
				.getByRole('navigation', { name: 'パンくずリスト' })
				.getByRole('link', { name: '11月3日(火)' }),
		).toHaveAttribute('href', /\/series\/s-tour\/events\/e-1103\/ticket-sales$/)
	})
})

test.describe('times in another time zone', () => {
	test.use({ timezoneId: 'Europe/London' })

	test(`@spec ${SPEC} "Device in another time zone"`, async ({ page }) => {
		const log = await openEditor(page, NEW_LOTTERY, {
			'TicketSaleService/Create': {
				ticketSale: (salesOf('e-1103', [PRESALE]).ticketSales as unknown[])[0],
			},
		})
		await fillPresale(page)
		await enterWindow(page, 'start', '2026-10-10', '12:00')
		await enterWindow(page, 'end', '2026-10-17', '12:00')
		await expect(fieldBox(page, 'start-time')).toContainText('JST')
		// Hours 00 to 23 on the 24-hour clock, whatever the device's clock.
		await expect(
			fieldBox(page, 'start-time')
				.getByRole('combobox', { name: '時' })
				.locator('option', { hasText: '23' }),
		).toHaveCount(1)
		await page.getByRole('button', { name: '抽選販売を始める' }).click()
		await expect
			.poll(() => calls(log, 'TicketSaleService/Create').length)
			.toBe(1)

		const body = calls(log, 'TicketSaleService/Create')[0]
			.body as unknown as CreateBody
		// 12:00 JST on 10 October is 03:00 UTC, whatever the device's zone.
		expect(body.saleStartTime).toMatch(/^2026-10-10T03:00:00(\.0+)?Z$/)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-10-17', '12:00'),
		)
	})
})

test.describe('times on a 12-hour device', () => {
	// An English (United States) device writes 18:00 as 6:00 PM.
	test.use({ locale: 'en-US' })

	test(`@spec ${I18N} "Device on a 12-hour clock"`, async ({ page }) => {
		await openEditor(page, NEW_LOTTERY)
		expect(
			await page.evaluate(() =>
				new Date(2026, 9, 10, 18).toLocaleTimeString(undefined, {
					hour: 'numeric',
					minute: '2-digit',
				}),
			),
		).toMatch(/PM/)

		const start = fieldBox(page, 'start-time')
		const texts = async (name: string) =>
			(
				await start
					.getByRole('combobox', { name })
					.locator('option')
					.allTextContents()
			)
				.map((t) => t.trim())
				.filter((t) => t !== '--')
		const two = (n: number) => String(n).padStart(2, '0')
		expect(await texts('時')).toEqual(
			Array.from({ length: 24 }, (_, h) => two(h)),
		)
		expect(await texts('分')).toEqual(
			Array.from({ length: 12 }, (_, i) => two(i * 5)),
		)
		await expect(start).not.toContainText(/AM|PM|午前|午後/)
	})
})

test.describe('changing a lottery before it opens', () => {
	const EDIT = `${SALES}/l-1/edit`

	test(`@spec ${SPEC} "Move the window before it opens"`, async ({ page }) => {
		const store = salesStore('e-1103', [PRESALE])
		const moved: SaleSpec = {
			...PRESALE,
			start: jst('2026-10-12', '12:00'),
			end: jst('2026-10-19', '12:00'),
		}
		const log = await openEditor(page, EDIT, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketSaleService/SetWindow': () => {
				store.set([moved])
				return {
					body: {
						ticketSale: (
							salesOf('e-1103', [moved]).ticketSales as unknown[]
						)[0],
					},
				}
			},
		})
		await expect(
			page.getByRole('heading', { level: 1, name: '抽選販売を変更' }),
		).toBeVisible()
		await expect(
			page.getByRole('main').getByText('ファンクラブ先行').first(),
		).toBeVisible()
		await expect(field(page, '販売名')).toHaveCount(0)
		await expect.poll(() => shownWindow(page, 'start')).toBe('2026-10-10 12:00')

		await enterWindow(page, 'start', '2026-10-12', '12:00')
		await enterWindow(page, 'end', '2026-10-19', '12:00')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(page).toHaveURL(
			/\/series\/s-tour\/events\/e-1103\/ticket-sales$/,
		)
		const sale = page
			.getByRole('listitem')
			.filter({ hasText: 'ファンクラブ先行' })
		await expect(sale).toContainText('10月12日')
		await expect(sale).toContainText('10月19日')
		const body = calls(log, 'TicketSaleService/SetWindow')[0].body as {
			ticketSaleId: { value: string }
			saleStartTime: string
			saleEndTime: string
		}
		expect(body.ticketSaleId).toEqual({ value: 'l-1' })
		expect(new Date(body.saleStartTime).toISOString()).toBe(
			jst('2026-10-12', '12:00'),
		)
		expect(new Date(body.saleEndTime).toISOString()).toBe(
			jst('2026-10-19', '12:00'),
		)
		expect(calls(log, 'TicketTypeService/Update')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Change the price before it opens"`, async ({ page }) => {
		const store = salesStore('e-1103', [PRESALE])
		const log = await openEditor(page, EDIT, {
			'TicketSaleService/ListByEvent': store.answer,
			'TicketTypeService/Update': () => {
				const cheaper = { ...PRESALE, price: 7500 }
				store.set([cheaper])
				const sale = (
					salesOf('e-1103', [cheaper]).ticketSales as Array<{
						ticketTypes: unknown[]
					}>
				)[0]
				return { body: { ticketType: sale.ticketTypes[0] } }
			},
		})
		await expect(field(page, '価格')).toHaveValue('8000')
		await field(page, '価格').fill('7500')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(page).toHaveURL(
			/\/series\/s-tour\/events\/e-1103\/ticket-sales$/,
		)
		await expect(
			page.getByRole('listitem').filter({ hasText: 'ファンクラブ先行' }),
		).toContainText('7,500円')
		expect(calls(log, 'TicketTypeService/Update')[0].body).toEqual({
			ticketTypeId: { value: 'type-l-1' },
			price: { value: '7500' },
			quantity: 100,
			perAccountLimit: 4,
		})
		expect(calls(log, 'TicketSaleService/SetWindow')).toHaveLength(0)
	})

	test(`@spec ${SPEC} "Sale opened while editing"`, async ({ page }) => {
		const log = await openEditor(page, EDIT, {
			'TicketSaleService/ListByEvent': salesOf('e-1103', [PRESALE]),
		})
		await field(page, '価格').fill('7500')
		// The window opens while the member is still editing.
		await page.clock.setFixedTime(new Date('2026-10-10T12:30:00+09:00'))
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(page.getByRole('alert')).toContainText(
			'受付が始まった抽選は変更できません。何も保存していません。',
		)
		await expect(page).toHaveURL(/\/ticket-sales\/l-1\/edit$/)
		expect(calls(log, 'TicketSaleService/SetWindow')).toHaveLength(0)
		expect(calls(log, 'TicketTypeService/Update')).toHaveLength(0)
	})
})
