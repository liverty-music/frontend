import {
	confirmDialog,
	installConsole,
	ORG,
	type RpcLog,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	organizer,
	payoutAccount,
	type SaleSpec,
	type ScannerSpec,
	salesOf,
	scanner,
	seriesList,
	XX_SOLO,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Story: an operator takes one event from draft to the door in the console,
 * reaching every step by navigation (stories/run-an-event-from-the-organizer-console).
 * The organizer API is a small in-memory server that publishes, creates the
 * sale and issues scanners, so each screen reads what the previous step did.
 */

const STORY = 'stories/run-an-event-from-the-organizer-console'
const EVENT = 'e-1220'

interface Server {
	rpc: RpcMocks
	published: () => boolean
}

function server(): Server {
	const concert: ConcertSpec = structuredClone(XX_SOLO)
	const sales: SaleSpec[] = []
	const scanners: ScannerSpec[] = []
	const list = () => seriesList([concert])
	return {
		published: () => concert.events[0].state === 'PUBLISHED',
		rpc: {
			'SeriesService/List': () => ({ body: list() }),
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
			'ArtistService/List': {
				artists: [{ id: { value: 'a-1' }, name: { value: 'Band A' } }],
			},
			'TicketSaleService/ListByEvent': () => ({ body: salesOf(EVENT, sales) }),
			'TicketSaleService/Create': (req) => {
				const types = req.ticketTypes as Array<{
					price: { value: string }
					quantity: number
					perAccountLimit?: number
				}>
				const sale: SaleSpec = {
					id: `sale-${sales.length + 1}`,
					name: (req.name as { value: string }).value,
					method: 'LOTTERY',
					start: req.saleStartTime as string,
					end: req.saleEndTime as string,
					price: Number(types[0].price.value),
					quantity: types[0].quantity,
					perAccountLimit: types[0].perAccountLimit,
					stats: { entries: 0, requested: 0 },
				}
				sales.push(sale)
				return {
					body: {
						ticketSale: (salesOf(EVENT, [sale]).ticketSales as unknown[])[0],
					},
				}
			},
			'ScannerService/ListByEvent': () => ({
				body: { scanners: scanners.map((s) => scanner(EVENT, s)) },
			}),
			'ScannerService/Create': () => {
				const s: ScannerSpec = {
					id: `scanner-${scanners.length + 1}`,
					number: scanners.length + 1,
					status: 'UNUSED',
					token: `token-${scanners.length + 1}`,
				}
				scanners.push(s)
				return { body: { scanner: scanner(EVENT, s) } }
			},
			'ScannerService/Revoke': (req) => {
				const id = (req.scannerId as { value: string }).value
				const s = scanners.find((x) => x.id === id)
				if (s) s.status = 'REVOKED'
				return { body: { scanner: scanner(EVENT, s ?? scanners[0]) } }
			},
		},
	}
}

const navigation = (page: Page) =>
	page.getByRole('navigation', { name: 'メインナビゲーション' })

async function walk(page: Page, api: Server, log: RpcLog): Promise<void> {
	// Home lists the draft concert; its action opens the concert page.
	const draftItem = page.locator('[data-kind="draft"]')
	await expect(draftItem).toContainText('XX 単独公演')
	await draftItem.getByRole('link', { name: '開く' }).click()
	await expect(
		page.getByRole('heading', { level: 1, name: 'XX 単独公演' }),
	).toBeVisible()

	// The concert lists its 20 December date; it opens the event page.
	await page
		.getByRole('link', { name: /12月20日\(日\) 18:00 JST/ })
		.first()
		.click()
	await expect(page).toHaveURL(/\/events\/e-1220\/ticket-sales$/)

	// Publish after confirming.
	await page
		.getByRole('button', { name: '公開する', exact: true })
		.first()
		.click()
	const dialog = confirmDialog(page)
	await expect(dialog).toContainText('フォロワーに通知します')
	await dialog.getByRole('button', { name: '公開する' }).click()
	await expect(page.locator('event-route status-badge').first()).toHaveText(
		/公開中/,
	)
	expect(api.published()).toBe(true)

	// Start a lottery from the Sales tab.
	await page.getByRole('link', { name: '抽選で販売する' }).click()
	await page.getByLabel(/販売名/).fill('ファンクラブ先行')
	await page.getByLabel(/^価格/).fill('8000')
	await page.getByLabel(/^販売枚数/).fill('100')
	await page.getByRole('button', { name: '抽選販売を始める' }).click()
	await expect(page).toHaveURL(/\/events\/e-1220\/ticket-sales$/)
	const sale = page.locator('sales-tab .sale').first()
	await expect(sale).toContainText('ファンクラブ先行')
	await expect(sale).toContainText('100枚')
	await expect(sale).toContainText('8,000円')
	expect(log.calls.some((c) => c.method === 'TicketSaleService/Create')).toBe(
		true,
	)

	// Issue a scanner from the Reception tab.
	await page.getByRole('link', { name: '受付', exact: true }).click()
	await page.getByRole('button', { name: '受付リンクを発行' }).click()
	const first = page.locator('[data-scanner="1"]')
	await expect(first).toContainText('受付1')
	await expect(first).toContainText('未使用')
	await expect(first).toContainText(
		'https://reception.e2e.liverty-music.app/#token-1',
	)

	// Home no longer lists the draft item.
	await navigation(page).getByRole('link', { name: 'ホーム' }).click()
	await expect(
		page.getByRole('heading', { level: 1, name: 'ホーム' }),
	).toBeVisible()
	await expect(page.locator('[data-kind="draft"]')).toHaveCount(0)
}

test.describe('run an event from the organizer console', () => {
	test.beforeEach(async ({ page }) => {
		await page.clock.setFixedTime(new Date('2026-12-01T10:00:00+09:00'))
	})

	test(`@spec ${STORY} "Whole flow on a PC"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		const api = server()
		const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })
		await page.goto(ORG)
		await walk(page, api, log)
	})

	test(`@spec ${STORY} "Same flow on a phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		const api = server()
		const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })
		await page.goto(ORG)
		// On a phone the destinations are in the bottom bar.
		const bar = await navigation(page).boundingBox()
		expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(844)
		await walk(page, api, log)
	})

	test(`@spec ${STORY} "Publish declined"`, async ({ page }) => {
		const api = server()
		const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })
		await page.goto(`${SERIES}/s-solo/events/${EVENT}/ticket-sales`)
		await page
			.getByRole('button', { name: '公開する', exact: true })
			.first()
			.click()
		await confirmDialog(page).getByRole('button', { name: 'やめる' }).click()

		await expect(page.locator('event-route status-badge').first()).toHaveText(
			/下書き/,
		)
		expect(api.published()).toBe(false)
		expect(log.calls.some((c) => c.method === 'SeriesService/Publish')).toBe(
			false,
		)
	})

	test(`@spec ${STORY} "Scanner revoked"`, async ({ page }) => {
		const api = server()
		const log = await installConsole(page, { rpc: api.rpc, language: 'ja' })
		await page.goto(`${SERIES}/s-solo/events/${EVENT}/ticket-sales`)
		await page
			.getByRole('button', { name: '公開する', exact: true })
			.first()
			.click()
		await confirmDialog(page).getByRole('button', { name: '公開する' }).click()
		await page.getByRole('link', { name: '受付', exact: true }).click()
		await page.getByRole('button', { name: '受付リンクを発行' }).click()
		const first = page.locator('[data-scanner="1"]')
		await expect(first).toContainText('未使用')

		await first.getByRole('button', { name: '取り消す', exact: true }).click()
		const dialog = confirmDialog(page, { name: '受付1を取り消しますか？' })
		await expect(dialog).toContainText(
			'受付1を使っている端末は使えなくなります',
		)
		await dialog.getByRole('button', { name: '取り消す' }).click()

		await expect(first).toContainText('取り消し済み')
		await expect(page.locator('snack-bar [role="status"]')).toContainText(
			'受付1を取り消しました',
		)
		// The device stops working because the server revoked the Scanner.
		expect(
			log.calls.find((c) => c.method === 'ScannerService/Revoke')?.body,
		).toEqual({ scannerId: { value: 'scanner-1' } })
	})
})
