import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type TicketSale,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { ReferralCodeStatsSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	businessDetailsComplete,
	IEventPage,
} from '../../../organizer/event/event-page'
import { SalesTab } from '../../../organizer/event/sales-tab/sales-tab'
import {
	ConsoleI18nConfiguration,
	LANGUAGE_STORAGE_KEY,
} from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import ja from '../../../organizer/locales/ja/translation.json'
import { IClock } from '../../../organizer/services/clock'
import { ISeatTypeClient } from '../../../organizer/services/seat-type-client'
import {
	type EventTicketSales,
	ITicketSaleClient,
} from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConfirmDialog } from '../../../organizer/ui/confirm-dialog/confirm-dialog'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleField } from '../../../organizer/ui/console-field/console-field'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { DataList } from '../../../organizer/ui/data-list/data-list'
import { PrerequisiteCallout } from '../../../organizer/ui/prerequisite-callout/prerequisite-callout'
import { StatTile } from '../../../organizer/ui/stat-tile/stat-tile'
import { StatusBadge } from '../../../organizer/ui/status-badge/status-badge'
import {
	A_SEAT,
	controlsNamed,
	deepAll,
	deepOne,
	deepText,
	eventInit,
	jst,
	lotteryEntryStats,
	organizerWithout,
	S_SEAT,
	type SaleInit,
	type SeatInit,
	type StockInit,
	seatType,
	stocksOf,
	stubBrowserOverlays,
	ticketSale,
	tourWith,
} from './event-tab-support'

const SPEC = 'components/infrastructure/organizer/web/route/event'

/** "Now" is fixed at 2026-10-08 09:00 JST. */
const NOW = jst('2026-10-08', '09:00').getTime()

/** S席 of the 3 November event: 1,500 tickets, 300 sold, so 1,200 remain. */
const S_STOCK: StockInit = {
	id: 'stock-s',
	seat: S_SEAT,
	quantity: 1500,
	sold: 300,
}

/** A lottery of the event, drawing from its stocks. */
function lottery(
	over: Partial<SaleInit> & Pick<SaleInit, 'id' | 'start'>,
): SaleInit {
	return {
		name: 'ファンクラブ先行',
		method: 'LOTTERY',
		end: jst('2026-10-17', '23:59'),
		...over,
	}
}

/** The 一般発売 first-come sale. */
function firstCome(over: Partial<SaleInit> = {}): SaleInit {
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
})
const OPEN_STATS = [{ stock: S_STOCK, entries: 412, requested: 1380 } as const]
const DRAWN_STATS = [
	{
		stock: S_STOCK,
		entries: 412,
		requested: 1380,
		won: 318,
		wonTickets: 1198,
		lost: 94,
	} as const,
]

interface Setup {
	/** The sales, each with the entry counts of a lottery per stock. */
	sales: Array<{
		sale: SaleInit
		stats?: ReadonlyArray<{
			stock: StockInit
			entries: number
			requested: number
			won?: number
			wonTickets?: number
			lost?: number
		}>
	}>
	stocks: StockInit[]
	seatTypes: SeatInit[]
	event: ReturnType<typeof tourWith>['events'][number]
	organizer: Parameters<typeof businessDetailsComplete>[0]
	referrals: Array<{
		code?: string
		orderCount: number
		ticketCount: number
		amount: number
	}>
	setVerification: ReturnType<typeof vi.fn>
	createStock: ReturnType<typeof vi.fn>
	deleteStock: ReturnType<typeof vi.fn>
	/** Called with the stocks list each time the stocks are read. */
	onStocksRead: (stocks: StockInit[]) => StockInit[]
}

function setupOf(over: Partial<Setup>): Setup {
	return {
		sales: [],
		stocks: [S_STOCK],
		seatTypes: [S_SEAT, A_SEAT],
		event: tourWith(eventInit()).events[0],
		organizer: organizerWithout(),
		referrals: [],
		setVerification: vi.fn(),
		createStock: vi.fn(),
		deleteStock: vi.fn(),
		onStocksRead: (s) => s,
		...over,
	}
}

function salesOf(setup: Setup): EventTicketSales {
	return {
		ticketSales: setup.sales.map((s) => ticketSale(s.sale)),
		lotteryEntryStats: setup.sales.flatMap((s) =>
			(s.stats ?? []).map((st) => lotteryEntryStats(s.sale.id, st.stock, st)),
		),
		referralCodeStats: setup.referrals.map((r) =>
			create(ReferralCodeStatsSchema, {
				code: r.code ? { value: r.code } : undefined,
				orderCount: r.orderCount,
				ticketCount: r.ticketCount,
				amount: BigInt(r.amount),
			}),
		),
	}
}

/** The Sales tab of the 3 November event, with the clients stubbed. */
async function mount(over: Partial<Setup> = {}) {
	const setup = setupOf(over)
	const requestPublish = vi.fn()
	const show = vi.fn()
	const showError = vi.fn()
	const listStocks = vi
		.fn()
		.mockImplementation(async () => stocksOf(setup.onStocksRead(setup.stocks)))
	const page = {
		ready: Promise.resolve(),
		event: setup.event,
		eventId: 'e-1103',
		seriesId: 's-tour',
		businessDetailsComplete: businessDetailsComplete(setup.organizer),
		requestPublish,
	}
	const fixture = createFixture('<sales-tab></sales-tab>', class {}, [
		ConsoleI18nConfiguration,
		...ConsoleFormatters,
		ConfirmDialog,
		ConsoleButton,
		ConsoleField,
		ConsoleIcon,
		DataList,
		PrerequisiteCallout,
		StatTile,
		StatusBadge,
		SalesTab,
		Registration.instance(IEventPage, page),
		Registration.instance(ITicketSaleClient, {
			listByEvent: vi.fn().mockImplementation(async () => salesOf(setup)),
			setVerificationRequirement: setup.setVerification,
		}),
		Registration.instance(ITicketStockClient, {
			listByEvent: listStocks,
			create: setup.createStock,
			delete: setup.deleteStock,
		}),
		Registration.instance(ISeatTypeClient, {
			listBySeries: vi
				.fn()
				.mockImplementation(async () =>
					setup.seatTypes.map((t) => seatType(t)),
				),
		}),
		Registration.instance(IConsoleContext, {
			scope: { organizer: 'org-1', artist: 'a-1' },
		}),
		Registration.instance(IClock, { now: () => NOW }),
		Registration.instance(ISnackbar, { show, showError }),
	])
	await fixture.startPromise
	const tab = fixture.appHost.querySelector('sales-tab') as HTMLElement
	const vm = CustomElement.for<SalesTab>(tab).viewModel
	await vi.waitFor(() => expect(vm.state).toBe('ready'))
	await tasksSettled()
	const settle = async () => {
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}
	return { fixture, tab, vm, setup, show, showError, requestPublish, settle }
}

/** Presses a console button as a click on the control inside it. */
function press(button: HTMLElement | undefined): void {
	if (!button) throw new Error('no such button')
	;(
		(button.shadowRoot?.querySelector('button, a') as HTMLElement | null) ??
		button
	).click()
}

const sale = (tab: HTMLElement, id: string) =>
	tab.querySelector<HTMLElement>(`[data-sale="${id}"]`)
const stockEl = (tab: HTMLElement, id: string) =>
	tab.querySelector<HTMLElement>(`[data-stock="${id}"]`)
const stocksSection = (tab: HTMLElement) =>
	tab.querySelector<HTMLElement>('[data-testid="ticket-stocks"]') as HTMLElement
const startLottery = (tab: HTMLElement) => controlsNamed(tab, '抽選で販売する')
const startFirstCome = (tab: HTMLElement) =>
	controlsNamed(tab, '先着で販売する')
const badge = (scope: HTMLElement) =>
	deepText(deepOne(scope, 'status-badge') as HTMLElement)
/** The value of the stat tile labelled `label` inside `scope`. */
function tile(scope: HTMLElement, label: string): string | undefined {
	const found = deepAll(scope, 'stat-tile').find((t) =>
		deepText(t).startsWith(label),
	)
	return found ? deepOne(found, 'data')?.textContent?.trim() : undefined
}
const hrefOf = (button: HTMLElement | undefined) =>
	button
		? (button.matches('a') ? button : deepOne(button, 'a'))?.getAttribute(
				'href',
			)
		: undefined
const guideLink = (callout: HTMLElement) => deepOne(callout, 'a.guide')
const addForm = (tab: HTMLElement) => stocksSection(tab).querySelector('form')
const seatTypeField = (tab: HTMLElement) =>
	stocksSection(tab).querySelector<HTMLElement>(
		'[data-field="stock-seat-type"]',
	)
const optionsOf = (field: HTMLElement | null | undefined) =>
	deepAll<HTMLOptionElement>(field as HTMLElement, 'option').map((o) =>
		o.textContent?.trim(),
	)

describe('event page Sales tab', () => {
	beforeEach(() => {
		localStorage.clear()
		localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja')
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		stubBrowserOverlays()
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('prerequisites', () => {
		it(`@spec ${SPEC} "Draft event"`, async () => {
			const { fixture, tab, requestPublish } = await mount({
				event: tourWith(eventInit({ publishState: PublishState.DRAFT }))
					.events[0],
			})

			const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
			expect(deepText(callout)).toContain(
				'販売を始めるには、公演を公開してください',
			)
			const publish = controlsNamed(callout, '公開する')[0]
			expect(publish, 'the callout offers 公開する').toBeDefined()
			expect(guideLink(callout)?.getAttribute('href')).toBe(
				'/guide.html#publish',
			)
			expect(guideLink(callout)?.getAttribute('target')).toBe('_blank')
			expect(guideLink(callout)?.getAttribute('rel')).toBe('noopener')
			expect(startLottery(tab)).toHaveLength(0)
			expect(startFirstCome(tab)).toHaveLength(0)

			// The link asks the event page to open its publish confirmation.
			press(publish)
			expect(requestPublish).toHaveBeenCalledTimes(1)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "No start time"`, async () => {
			const { fixture, tab } = await mount({
				event: tourWith(eventInit({ start: null })).events[0],
			})

			const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
			expect(deepText(callout)).toContain('開始時刻を設定してください')
			expect(hrefOf(controlsNamed(callout, '公演を編集')[0])).toBe(
				'/organizers/org-1/artists/a-1/series/s-tour/edit',
			)
			expect(guideLink(callout)?.getAttribute('href')).toBe(
				'/guide.html#publish',
			)
			expect(startLottery(tab)).toHaveLength(0)
			expect(startFirstCome(tab)).toHaveLength(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "No seat type stocked"`, async () => {
			const { fixture, tab } = await mount({ stocks: [] })

			const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
			expect(deepText(callout)).toContain('席種と枚数を追加してください')
			expect(deepText(callout)).toContain('下の「席種と枚数」で')
			expect(guideLink(callout)?.getAttribute('href')).toBe('/guide.html#sell')
			expect(startLottery(tab)).toHaveLength(0)
			expect(startFirstCome(tab)).toHaveLength(0)
			// The section it points to is on the same tab, with its add form.
			const section = stocksSection(tab)
			expect(section.querySelector('h2')?.textContent?.trim()).toBe(
				'席種と枚数',
			)
			expect(controlsNamed(section, '席種を追加').length).toBeGreaterThan(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Business details incomplete"`, async () => {
			const { fixture, tab } = await mount({
				organizer: organizerWithout('businessAddress'),
			})

			const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
			const text = deepText(callout)
			expect(text).toContain('事業者情報が未登録です')
			expect(text).toContain('審査のときに Liverty Music が登録します')
			expect(text).toContain('Liverty Music の担当者にご連絡ください')
			// No fix in the console: the only link is the guide's chapter.
			expect(deepAll(callout, 'a')).toHaveLength(1)
			expect(guideLink(callout)?.getAttribute('href')).toBe(
				'/guide.html#business-and-payout',
			)
			expect(startLottery(tab)).toHaveLength(0)
			expect(startFirstCome(tab)).toHaveLength(0)
			await fixture.tearDown()
		})
	})

	describe('the sales list', () => {
		it(`@spec ${SPEC} "No sale yet"`, async () => {
			const { fixture, tab } = await mount()

			expect(deepText(tab)).toContain('この公演日の販売はまだありません')
			expect(startLottery(tab)).toHaveLength(1)
			expect(startFirstCome(tab)).toHaveLength(1)
			expect(deepAll(tab, 'prerequisite-callout')).toHaveLength(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Scheduled lottery"`, async () => {
			const { fixture, tab } = await mount({
				sales: [
					{
						sale: lottery({ id: 'sale-fc', start: jst('2026-10-10', '12:00') }),
					},
				],
			})

			const row = sale(tab, 'sale-fc') as HTMLElement
			expect(badge(row)).toBe('受付開始前')
			expect(row.querySelector('.countdown')?.textContent?.trim()).toBe(
				'あと 2日 3時間',
			)
			expect(deepText(row)).toContain(
				'10月10日(土) 12:00 〜 10月17日(土) 23:59 JST',
			)
			expect(deepText(row)).toContain('抽選')
			// Said once above the list: the seat types are shared, the limit is the event's.
			expect(deepText(tab)).toContain(
				'1アカウントの上限は、この公演日のすべての販売を合わせて4枚です。',
			)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Open lottery, oversubscribed"`, async () => {
			const { fixture, tab } = await mount({
				sales: [{ sale: OPEN_LOTTERY, stats: OPEN_STATS }],
			})

			const row = sale(tab, 'sale-open') as HTMLElement
			expect(badge(row)).toBe('受付中')
			const s = row.querySelector<HTMLElement>(
				'[data-lottery-stock="stock-s"]',
			) as HTMLElement
			expect(s.querySelector('h4')?.textContent?.trim()).toBe('S席')
			expect(tile(s, '応募数')).toBe('412')
			expect(tile(s, '申込枚数')).toBe('1,380')
			expect(tile(s, '残り')).toBe('1,200')
			expect(deepText(s)).toContain('申込枚数は残りの枚数の115%です。')
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Drawn lottery"`, async () => {
			const { fixture, tab } = await mount({
				sales: [
					{
						sale: lottery({
							id: 'sale-drawn',
							start: jst('2026-09-20', '12:00'),
							end: jst('2026-09-27', '23:59'),
						}),
						stats: DRAWN_STATS,
					},
				],
			})

			const row = sale(tab, 'sale-drawn') as HTMLElement
			expect(badge(row)).toBe('抽選済み')
			expect(tile(row, '当選')).toBe('318')
			expect(tile(row, '当選枚数')).toBe('1,198')
			expect(tile(row, '落選')).toBe('94')
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "First-come sale on sale"`, async () => {
			const { fixture, tab } = await mount({
				sales: [{ sale: firstCome({ start: jst('2026-10-01', '10:00') }) }],
				stocks: [
					{ id: 'stock-s', seat: S_SEAT, quantity: 150, sold: 100, held: 6 },
				],
			})

			const row = sale(tab, 'sale-general') as HTMLElement
			expect(badge(row)).toBe('受付中')
			expect(deepText(row)).toContain('先着')
			const s = stockEl(tab, 'stock-s') as HTMLElement
			expect(s.querySelector('h3')?.textContent?.trim()).toBe('S席')
			expect(tile(s, '販売済み')).toBe('100')
			expect(tile(s, '購入手続き中')).toBe('6')
			expect(tile(s, '販売枚数')).toBe('150')
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Presale drawn, general sale scheduled"`, async () => {
			// The general sale is listed first by the server; the tab orders by start.
			const { fixture, tab } = await mount({
				sales: [
					{ sale: firstCome() },
					{
						sale: lottery({
							id: 'sale-fc',
							start: jst('2026-09-20', '12:00'),
							end: jst('2026-09-27', '23:59'),
						}),
						stats: DRAWN_STATS,
					},
				],
			})

			// One card per sale, each headed by its name under the section 販売.
			expect(tab.querySelector('#sales-title')?.textContent?.trim()).toBe(
				'販売',
			)
			expect(
				[...tab.querySelectorAll('.sales h3')].map((h) =>
					h.textContent?.trim(),
				),
			).toEqual(['ファンクラブ先行', '一般発売'])
			expect(badge(sale(tab, 'sale-fc') as HTMLElement)).toBe('抽選済み')
			expect(badge(sale(tab, 'sale-general') as HTMLElement)).toBe('受付開始前')
			expect(startLottery(tab)).toHaveLength(1)
			// The event already has its first-come sale.
			expect(startFirstCome(tab)).toHaveLength(0)
			// Starting a sale is an outlined button above the cards.
			expect(
				deepOne(startLottery(tab)[0], 'a')?.getAttribute('data-variant'),
			).toBe('outlined')
			const start = tab.querySelector('.start-actions') as HTMLElement
			const list = tab.querySelector('.sales') as HTMLElement
			expect(
				start.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy()
			await fixture.tearDown()
		})
	})

	describe('purchases per referral code', () => {
		const ON_SALE = { sale: firstCome({ start: jst('2026-10-01', '10:00') }) }
		const referrals = (tab: HTMLElement) =>
			tab.querySelector<HTMLElement>('[data-testid="referrals"]')

		it(`@spec ${SPEC} "Two codes and direct purchases"`, async () => {
			// The server lists the direct group among the codes by Order count;
			// the tab moves it last.
			const { fixture, tab } = await mount({
				sales: [ON_SALE],
				referrals: [
					{ orderCount: 40, ticketCount: 71, amount: 461_500 },
					{
						code: 'member-a',
						orderCount: 12,
						ticketCount: 21,
						amount: 136_500,
					},
					{ code: 'member-b', orderCount: 5, ticketCount: 8, amount: 52_000 },
				],
			})

			const section = referrals(tab) as HTMLElement
			expect(section.querySelector('h2')?.textContent?.trim()).toBe(
				'紹介コード別の購入',
			)
			const text = deepText(section)
			expect(text).toContain('支払い済みの購入だけを数えます。')
			expect(text).toContain('返金された購入は数えません。')
			expect(text).toContain('抽選は、当選して決済されたときに数えます。')
			const table = deepOne(section, 'table') as HTMLElement
			const rows = [...table.querySelectorAll('tbody tr')].map((tr) => ({
				header: tr
					.querySelector('th')
					?.textContent?.replace(/\s+/g, ' ')
					.trim(),
				cells: [...tr.querySelectorAll('td')].map((td) =>
					td.textContent?.replace(/\s+/g, ' ').trim(),
				),
			}))
			expect(rows).toEqual([
				{ header: 'member-a', cells: ['12件', '21枚', '136,500円'] },
				{ header: 'member-b', cells: ['5件', '8枚', '52,000円'] },
				{ header: '直接（コードなし）', cells: ['40件', '71枚', '461,500円'] },
			])
			// Read-only: codes are not registered, edited or removed here.
			expect(deepAll(section, 'button, a')).toHaveLength(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Sale with no purchase yet"`, async () => {
			const { fixture, tab } = await mount({ sales: [ON_SALE] })

			const section = referrals(tab) as HTMLElement
			expect(deepText(section)).toContain('まだ購入はありません')
			expect(deepAll(section, 'table')).toHaveLength(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Event without a sale"`, async () => {
			const { fixture, tab } = await mount()

			expect(deepText(tab)).toContain('この公演日の販売はまだありません')
			expect(referrals(tab)).toBeNull()
			expect(deepText(tab)).not.toContain('紹介コード別の購入')
			await fixture.tearDown()
		})
	})

	describe('editing a sale', () => {
		it(`@spec ${SPEC} "Edit a lottery before it opens"`, async () => {
			const { fixture, tab } = await mount({
				sales: [
					{
						sale: lottery({
							id: 'sale-tomorrow',
							start: jst('2026-10-09', '12:00'),
							end: jst('2026-10-16', '23:59'),
						}),
					},
				],
			})

			// 編集 is a text button on the sale's card, linking to its editor.
			const edit = controlsNamed(
				sale(tab, 'sale-tomorrow') as HTMLElement,
				'編集',
			)
			expect(edit).toHaveLength(1)
			expect(deepOne(edit[0], 'a')?.getAttribute('data-variant')).toBe('text')
			expect(hrefOf(edit[0])).toBe(
				'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/ticket-sales/sale-tomorrow/edit',
			)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Lottery already open"`, async () => {
			const { fixture, tab } = await mount({
				sales: [{ sale: OPEN_LOTTERY, stats: OPEN_STATS }],
			})

			const row = sale(tab, 'sale-open') as HTMLElement
			const edit = controlsNamed(row, '編集')
			expect(edit).toHaveLength(1)
			expect(deepOne<HTMLButtonElement>(edit[0], 'button')?.disabled).toBe(true)
			expect(deepAll(edit[0], 'a')).toHaveLength(0)
			expect(deepText(row)).toContain('受付開始後は変更できません')
			await fixture.tearDown()
		})
	})

	describe('verification requirement', () => {
		const select = (tab: HTMLElement) =>
			deepOne<HTMLSelectElement>(
				sale(tab, 'sale-open')?.querySelector(
					'console-field.verification',
				) as HTMLElement,
				'select',
			) as HTMLSelectElement
		const chosen = (tab: HTMLElement) =>
			select(tab).selectedOptions[0]?.textContent?.trim()
		/** Picks an option the way a member does: the field reports the change. */
		function choose(tab: HTMLElement, value: VerificationRequirement) {
			const el = select(tab)
			el.value = String(value)
			el.dispatchEvent(new Event('change', { bubbles: true }))
		}

		it(`@spec ${SPEC} "Tighten while open"`, async () => {
			const updated: TicketSale = ticketSale({
				...OPEN_LOTTERY,
				verification: VerificationRequirement.JPKI_ONLY,
			})
			const { fixture, tab, show, settle, setup } = await mount({
				sales: [{ sale: OPEN_LOTTERY, stats: OPEN_STATS }],
				setVerification: vi.fn().mockResolvedValue(updated),
			})

			expect(chosen(tab)).toBe('本人確認なし')
			expect(deepText(sale(tab, 'sale-open') as HTMLElement)).toContain(
				'すでに受け付けた申込は確認し直しません',
			)
			choose(tab, VerificationRequirement.JPKI_ONLY)
			await settle()

			expect(show).toHaveBeenCalledWith('sale.verificationSaved')
			expect(ja.sale.verificationSaved).toBe('本人確認の設定を変更しました')
			expect(ja.sale.verification.jpkiOnly).toBe(
				'マイナンバーカードで本人確認済み',
			)
			expect(chosen(tab)).toBe('マイナンバーカードで本人確認済み')
			expect(setup.setVerification).toHaveBeenCalledTimes(1)
			expect(setup.setVerification.mock.calls[0].slice(0, 2)).toEqual([
				'sale-open',
				VerificationRequirement.JPKI_ONLY,
			])
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Change fails"`, async () => {
			const { fixture, tab, showError, settle } = await mount({
				sales: [{ sale: OPEN_LOTTERY, stats: OPEN_STATS }],
				setVerification: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('network down', Code.Unavailable),
					),
			})

			choose(tab, VerificationRequirement.JPKI_ONLY)
			await settle()

			expect(showError).toHaveBeenCalledWith('sale.verificationFailed', {
				retry: expect.any(Function),
			})
			expect(ja.sale.verificationFailed).toBe(
				'本人確認の設定を変更できませんでした',
			)
			// The select returns to the saved choice.
			expect(chosen(tab)).toBe('本人確認なし')
			expect(select(tab).value).toBe('0')
			await fixture.tearDown()
		})
	})

	describe('seat types and quantities', () => {
		/** The stocks of the event, changed by Create and Delete. */
		function stockStore(initial: StockInit[]) {
			const stocks = [...initial]
			return stocks
		}
		/** Confirms the add dialog that is open. */
		async function confirmAdd(
			tab: HTMLElement,
			settle: () => Promise<void>,
		): Promise<string> {
			const dialog = tab.querySelectorAll('confirm-dialog')[0] as HTMLElement
			const text = deepText(dialog)
			press(deepOne(dialog, '[data-role="confirm"]') as HTMLElement)
			await settle()
			return text
		}

		it('a seat type another member stocked meanwhile is told and no longer offered', async () => {
			const stocked = stockStore([])
			const { fixture, tab, vm, showError, settle } = await mount({
				stocks: [],
				onStocksRead: () => stocked,
				createStock: vi.fn().mockImplementation(async () => {
					// Another member's S席 stock was stored first.
					stocked.push({ id: 'stock-seat-s', seat: S_SEAT, quantity: 100 })
					throw new ConnectError('stocked', Code.AlreadyExists)
				}),
			})
			vm.stockForm = { seatTypeId: 'seat-s', quantity: '300' }
			await tasksSettled()

			press(controlsNamed(addForm(tab) as HTMLElement, '席種を追加')[0])
			await settle()
			await confirmAdd(tab, settle)

			expect(showError).toHaveBeenCalledWith('stock.error.alreadyStocked')
			expect(ja.stock.error.alreadyStocked).toBe(
				'この席種はすでにこの公演日にあります',
			)
			expect(deepText(stockEl(tab, 'stock-seat-s') as HTMLElement)).toContain(
				'100枚',
			)
			expect(
				optionsOf(seatTypeField(tab)).filter((o) => o?.includes('S席')),
			).toHaveLength(0)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Two seat types stocked"`, async () => {
			const stocked = stockStore([])
			const created = vi.fn().mockImplementation(async (input) => {
				const seat = [S_SEAT, A_SEAT].find((t) => t.id === input.seatTypeId)
				stocked.push({
					id: `stock-${seat?.id}`,
					seat: seat as SeatInit,
					quantity: input.quantity,
				})
			})
			const { fixture, tab, vm, settle } = await mount({
				stocks: [],
				onStocksRead: () => stocked,
				createStock: created,
			})

			expect(optionsOf(seatTypeField(tab))).toEqual([
				'選んでください',
				'S席（8,000円）',
				'A席（6,000円）',
			])
			for (const [seatTypeId, quantity] of [
				['seat-s', '300'],
				['seat-a', '700'],
			]) {
				vm.stockForm = { seatTypeId, quantity }
				await tasksSettled()
				press(controlsNamed(addForm(tab) as HTMLElement, '席種を追加')[0])
				await settle()
				const dialog = await confirmAdd(tab, settle)
				expect(dialog).toContain('枚数はあとから変えられません')
				expect(dialog).toContain('すべての販売が、この枚数から売ります')
			}

			expect(deepText(stockEl(tab, 'stock-seat-s') as HTMLElement)).toContain(
				'8,000円 税込 · 300枚',
			)
			expect(deepText(stockEl(tab, 'stock-seat-a') as HTMLElement)).toContain(
				'6,000円 税込 · 700枚',
			)
			for (const id of ['stock-seat-s', 'stock-seat-a']) {
				const el = stockEl(tab, id) as HTMLElement
				expect(badge(el)).toBe('販売可')
				expect(tile(el, '販売済み')).toBe('0')
				expect(tile(el, '購入手続き中')).toBe('0')
			}
			expect(created.mock.calls.map((c) => c[0])).toEqual([
				{ eventId: 'e-1103', seatTypeId: 'seat-s', quantity: 300 },
				{ eventId: 'e-1103', seatTypeId: 'seat-a', quantity: 700 },
			])
			// Every seat type of the concert is stocked: nothing left to add.
			expect(addForm(tab)).toBeNull()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "More tickets later"`, async () => {
			const ANNOTATED = { id: 'seat-note', name: '注釈付き指定席', price: 7000 }
			const { fixture, tab } = await mount({
				stocks: [{ id: 'stock-s', seat: S_SEAT, quantity: 300, sold: 300 }],
				seatTypes: [S_SEAT, ANNOTATED],
			})

			const s = stockEl(tab, 'stock-s') as HTMLElement
			expect(badge(s)).toBe('完売')
			// No field or action changes a stock's quantity.
			expect(deepAll(s, 'input, select')).toHaveLength(0)
			expect(deepAll(s, 'button')).toHaveLength(0)
			// The concert's other seat type can be stocked instead.
			expect(optionsOf(seatTypeField(tab))).toEqual([
				'選んでください',
				'注釈付き指定席（7,000円）',
			])
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Stock already ordered"`, async () => {
			const { fixture, tab } = await mount({
				stocks: [
					{ id: 'stock-s', seat: S_SEAT, quantity: 300, sold: 2 },
					{ id: 'stock-a', seat: A_SEAT, quantity: 700 },
				],
			})

			expect(
				controlsNamed(stockEl(tab, 'stock-s') as HTMLElement, '削除'),
			).toHaveLength(0)
			expect(
				controlsNamed(stockEl(tab, 'stock-a') as HTMLElement, '削除'),
			).toHaveLength(1)
			await fixture.tearDown()
		})

		it('says a stock with an entry cannot be deleted when the server refuses', async () => {
			const { fixture, tab, showError, settle, setup } = await mount({
				stocks: [{ id: 'stock-a', seat: A_SEAT, quantity: 700 }],
				deleteStock: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('stock has orders', Code.FailedPrecondition),
					),
			})

			press(controlsNamed(stockEl(tab, 'stock-a') as HTMLElement, '削除')[0])
			await settle()
			const dialog = tab.querySelectorAll('confirm-dialog')[1] as HTMLElement
			expect(deepText(dialog)).toContain('A席を削除しますか？')
			press(deepOne(dialog, '[data-role="confirm"]') as HTMLElement)
			await settle()

			expect(setup.deleteStock).toHaveBeenCalledTimes(1)
			expect(setup.deleteStock.mock.calls[0][0]).toBe('stock-a')
			expect(showError).toHaveBeenCalledWith('stock.deleteRefused', {
				params: { name: 'A席' },
			})
			expect(ja.stock.deleteRefused).toBe(
				'{{name}}は申込または購入があるため削除できません。',
			)
			// The stock is still listed after the re-read.
			expect(stockEl(tab, 'stock-a')).not.toBeNull()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Concert without seat types"`, async () => {
			const { fixture, tab } = await mount({ stocks: [], seatTypes: [] })

			const section = stocksSection(tab)
			expect(deepText(section)).toContain(
				'この公演にはまだ席種がありません。公演ページで席種を追加してください。',
			)
			expect(hrefOf(controlsNamed(section, '公演ページへ')[0])).toBe(
				'/organizers/org-1/artists/a-1/series/s-tour',
			)
			expect(controlsNamed(section, '席種を追加')).toHaveLength(0)
			await fixture.tearDown()
		})
	})
})
