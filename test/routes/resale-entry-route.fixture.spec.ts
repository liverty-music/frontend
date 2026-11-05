import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { IResaleEntryRpcClient } from '../../src/adapter/rpc/client/resale-entry-client'
import { ITicketSaleRpcClient } from '../../src/adapter/rpc/client/ticket-sale-client'
import type { ResaleEntry } from '../../src/entities/resale-entry'
import type {
	EventTicketSales,
	TicketStock,
} from '../../src/entities/ticket-sale'
import ja from '../../src/locales/ja/translation.json'
import { ResaleEntryRoute } from '../../src/routes/resale-entry/resale-entry-route'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
import {
	type HeldTickets,
	IHeldSeatTypeService,
} from '../../src/services/held-seat-type-service'
import { IStripeService } from '../../src/services/stripe-service'
import { IUserStore } from '../../src/services/user-store'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'

const EVENT_ID = 'event-1'
const STOCK_ID = 'stock-s'

/** An instant at the given Japan-time hour and minute on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute))
}

const S_SEAT: TicketStock = {
	id: STOCK_ID,
	eventId: EVENT_ID,
	seatTypeId: 'seat-s',
	seatTypeName: 'S席',
	price: 3000,
	state: 'soldOut',
	lowStock: false,
	resaleOpen: true,
}

const A_SEAT: TicketStock = {
	...S_SEAT,
	id: 'stock-a',
	seatTypeId: 'seat-a',
	seatTypeName: 'A席',
	price: 2000,
}

/** The event's S席 and A席 stocks, both sold out with resale open, limit 4. */
const tickets: EventTicketSales = {
	sales: [],
	stocks: [S_SEAT, A_SEAT],
	perAccountLimit: 4,
}

/** The event on 10 November 2026, open 13:00 and start 14:00, by Organizer Inc. */
const concert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 10 } },
		openTime: { value: timestampFromDate(jst(10, 13)) },
		startTime: { value: timestampFromDate(jst(10, 14)) },
		listedVenueName: { value: 'Zepp Haneda' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
		organizer: {
			legalName: { value: 'Example Music Inc.' },
			representativeName: { value: 'Taro Example' },
			businessAddress: { value: '1-2-3 Example, Shibuya, Tokyo' },
			businessPhoneNumber: { value: '+81312345678' },
			contactEmail: { value: 'support@example.com' },
		},
	}),
	artists: [],
}

function entry(o: Partial<ResaleEntry> = {}): ResaleEntry {
	return {
		id: 'entry-1',
		orderId: 'order-1',
		ticketStockId: STOCK_ID,
		ticketCount: 2,
		state: 'entered',
		createTime: jst(5, 10),
		nextDrawTime: jst(6, 12),
		...o,
	}
}

interface Setup {
	readonly held?: HeldTickets | null
	readonly entries?: ResaleEntry[]
	/** ConcertService.Get's answer; the event by default. */
	readonly concertGet?: ReturnType<typeof vi.fn>
}

/** Renders the real template with the ja bundle, loaded for S席. */
async function render(setup: Setup = {}) {
	const paymentElement = { mount: vi.fn(), destroy: vi.fn() }
	const stripe = {
		isConfigured: true,
		createElements: vi.fn().mockResolvedValue({
			stripe: {},
			elements: { create: vi.fn(() => paymentElement) },
		}),
		confirmCardAuthorization: vi
			.fn()
			.mockResolvedValue({ cardAuthorizationId: 'ca-1' }),
	}
	const client = {
		list: vi.fn().mockResolvedValue({
			entries: setup.entries ?? [],
			stocks: new Map(),
		}),
		authorizeCard: vi
			.fn()
			.mockResolvedValue({ id: 'ca-1', secret: 'secret-1' }),
		confirm: vi.fn().mockResolvedValue(entry()),
	}
	const fixture = await createFixture(
		'<resale-entry-route></resale-entry-route>',
		class App {},
		[
			Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
				}
			}),
			Registration.instance(IConcertRpcClient, {
				get: setup.concertGet ?? vi.fn().mockResolvedValue(concert),
			}),
			Registration.instance(ITicketSaleRpcClient, {
				listByEvent: vi.fn().mockResolvedValue(tickets),
			}),
			Registration.instance(IHeldSeatTypeService, {
				heldTickets: vi.fn().mockResolvedValue(setup.held ?? null),
			}),
			Registration.instance(IResaleEntryRpcClient, client),
			Registration.instance(IStripeService, stripe),
			Registration.instance(IUserStore, {
				current: { id: 'u1' },
				currentLanguage: 'ja',
			}),
			ResaleEntryRoute,
		],
	).started
	const host = fixture.appHost.querySelector('resale-entry-route') as Element
	const vm = CustomElement.for<ResaleEntryRoute>(host).viewModel
	vm.loading({ id: EVENT_ID, stockId: STOCK_ID })
	await vi.waitFor(() => expect(vm.step).not.toBe('loading'))
	await tasksSettled()
	return { fixture, vm, client, stripe }
}

/** Choose 2 tickets, fill in the details and reach the final confirmation. */
async function toConfirmation(vm: ResaleEntryRoute): Promise<void> {
	vm.ticketCount = 2
	vm.toPersonalDetails()
	vm.fullName = '山田 花子'
	vm.phoneNumber = '090-1234-5678'
	vm.paymentElementHost = document.createElement('div')
	await vm.toPayment()
	await tasksSettled()
}

const byTestId = (host: HTMLElement, id: string) =>
	host.querySelector(`[data-testid="${id}"]`)

describe('ResaleEntryRoute applying (fixture)', () => {
	it('shows the seat type, its price and how the draws work, then 申し込みました with the next draw', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Applying for two tickets"
		const { fixture, vm, client } = await render()
		const host = fixture.appHost

		expect(vm.step).toBe('count')
		expect(byTestId(host, 'resale-entry-event')?.textContent).toContain(
			'ONE MAN LIVE',
		)
		expect(byTestId(host, 'resale-entry-seat-type')?.textContent).toBe('S席')
		expect(byTestId(host, 'resale-entry-price')?.textContent).toContain(
			'3,000円（税込',
		)
		const how = byTestId(host, 'resale-entry-how')?.textContent ?? ''
		expect(how).toContain('毎日12:00')
		expect(how).toContain('開演3時間前')
		expect(how).toContain('すべてまとめて')
		expect(how).toContain('当選したときだけ')

		await toConfirmation(vm)
		await vm.apply()
		await tasksSettled()

		expect(client.authorizeCard).toHaveBeenCalledWith(
			STOCK_ID,
			2,
			'山田 花子',
			'+819012345678',
			undefined,
			expect.anything(),
		)
		expect(client.confirm).toHaveBeenCalledWith('ca-1', expect.anything())
		expect(vm.step).toBe('done')
		expect(byTestId(host, 'resale-entry-done')?.textContent).toContain(
			'申し込みました',
		)
		expect(byTestId(host, 'resale-entry-next-draw')?.textContent).toBe(
			'次の抽選：2026年11月6日(金) 12:00',
		)
		await fixture.stop(true)
	})

	it('says one account holds one seat type and offers no application', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Another seat type held"
		const { fixture, vm } = await render({ held: { stock: A_SEAT, count: 2 } })
		const host = fixture.appHost

		expect(vm.step).toBe('other-seat-type')
		expect(
			byTestId(host, 'resale-entry-other-seat-type')?.textContent,
		).toContain('A席')
		expect(
			byTestId(host, 'resale-entry-other-seat-type')?.textContent,
		).toContain('1公演につき1つの席種')
		expect(byTestId(host, 'resale-entry-count')).toBeNull()
		await fixture.stop(true)
	})

	it('shows the waiting entry and its next draw and offers no second application', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Already applied"
		const { fixture, vm } = await render({ entries: [entry()] })
		const host = fixture.appHost

		expect(vm.step).toBe('applied')
		expect(byTestId(host, 'resale-entry-applied-count')?.textContent).toContain(
			'2枚',
		)
		expect(byTestId(host, 'resale-entry-next-draw')?.textContent).toBe(
			'次の抽選：2026年11月6日(金) 12:00',
		)
		expect(byTestId(host, 'resale-entry-count')).toBeNull()
		await fixture.stop(true)
	})
})

describe('ResaleEntryRoute 特商法 final confirmation (fixture)', () => {
	it('shows every item on the card step and the action with the amount charged on a win', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Final confirmation shown"
		const { fixture, vm } = await render()
		await toConfirmation(vm)
		const host = fixture.appHost
		const text = (id: string) => byTestId(host, id)?.textContent ?? ''

		expect(vm.step).toBe('payment')
		expect(text('resale-entry-confirm-what')).toContain('公式リセール')
		expect(text('resale-entry-confirm-what')).toContain('定価')
		expect(text('resale-entry-confirm-what')).toContain(
			'参加できなくなったファン',
		)
		expect(text('resale-entry-confirm-event')).toContain('ONE MAN LIVE')
		expect(text('resale-entry-confirm-event')).toContain('2026年11月10日')
		expect(text('resale-entry-confirm-event')).toContain('Zepp Haneda')
		expect(text('resale-entry-confirm-event')).toContain('13:00')
		expect(text('resale-entry-confirm-event')).toContain('14:00')
		expect(text('resale-entry-confirm-amount')).toBe(
			'S席 2枚 × 3,000円 = 当選時に 6,000円（税込）を請求',
		)
		expect(text('resale-entry-confirm-payment')).toContain('クレジットカード')
		expect(text('resale-entry-confirm-payment')).toContain('当選したときだけ')
		expect(text('resale-entry-confirm-payment')).toContain('解除')
		expect(text('resale-entry-confirm-draws')).toContain('毎日12:00')
		expect(text('resale-entry-confirm-draws')).toContain(
			'2026年11月10日(火) 11:00',
		)
		expect(text('resale-entry-confirm-allocation')).toContain('すべてまとめて')
		expect(text('resale-entry-confirm-delivery')).toContain('「チケット」画面')
		expect(text('resale-entry-confirm-withdrawal')).toContain('取り消せます')
		expect(text('resale-entry-confirm-cancellation')).toContain('中止')
		expect(text('resale-entry-confirm-cancellation')).toContain(
			'クーリングオフ',
		)
		expect(text('resale-entry-confirm-resale')).toContain('同意のない')
		expect(text('resale-entry-confirm-resale')).toContain(
			'ご自身のアカウントとお名前',
		)
		const business = text('resale-entry-confirm-business-details')
		for (const value of [
			'Example Music Inc.',
			'Taro Example',
			'1-2-3 Example, Shibuya, Tokyo',
			'+81312345678',
			'support@example.com',
		]) {
			expect(business).toContain(value)
		}
		expect(byTestId(host, 'resale-entry-change-count')).not.toBeNull()
		expect(
			byTestId(host, 'resale-entry-change-personal-details'),
		).not.toBeNull()
		expect(text('resale-entry-apply')).toBe('6,000円で申し込む')
		await fixture.stop(true)
	})

	it('authorizes the card for the details the fan changed from the final confirmation', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Final confirmation shown"
		const { fixture, vm, client } = await render()
		await toConfirmation(vm)

		vm.backToPersonalDetails()
		vm.fullName = '山田 太郎'
		vm.paymentElementHost = document.createElement('div')
		await vm.toPayment()
		await vm.apply()

		expect(client.authorizeCard).toHaveBeenCalledTimes(2)
		expect(client.authorizeCard.mock.calls[1][2]).toBe('山田 太郎')
		expect(vm.step).toBe('done')
		await fixture.stop(true)
	})

	it('authorizes no card and makes no entry until the fan taps the action', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Nothing is applied before the action"
		const { fixture, vm, client, stripe } = await render()
		await toConfirmation(vm)
		vm.detaching()

		expect(stripe.confirmCardAuthorization).not.toHaveBeenCalled()
		expect(client.confirm).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	it('makes one entry when the action is tapped twice, and disables it while authorizing', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Double tap on the action"
		const { fixture, vm, client, stripe } = await render()
		await toConfirmation(vm)
		let release: (v: unknown) => void = () => {}
		stripe.confirmCardAuthorization.mockReturnValue(
			new Promise((r) => {
				release = r
			}),
		)

		const first = vm.apply()
		const second = vm.apply()
		await tasksSettled()
		expect(
			(byTestId(fixture.appHost, 'resale-entry-apply') as HTMLButtonElement)
				.disabled,
		).toBe(true)
		release({ cardAuthorizationId: 'ca-1' })
		await Promise.all([first, second])

		expect(stripe.confirmCardAuthorization).toHaveBeenCalledTimes(1)
		expect(client.confirm).toHaveBeenCalledTimes(1)
		await fixture.stop(true)
	})
})

describe('ResaleEntryRoute read failure (fixture)', () => {
	it('offers a retry when the read fails for a reason other than NotFound', async () => {
		const get = vi
			.fn()
			.mockRejectedValueOnce(new ConnectError('down', Code.Unavailable))
			.mockResolvedValue(concert)
		const { fixture, vm } = await render({ concertGet: get })

		expect(vm.step).toBe('error')
		;(
			byTestId(fixture.appHost, 'resale-entry-retry') as HTMLButtonElement
		).click()
		await vi.waitFor(() => expect(vm.step).toBe('count'))
		await fixture.stop(true)
	})

	it('says the resale is not found when the event is NotFound', async () => {
		const { fixture, vm } = await render({
			concertGet: vi
				.fn()
				.mockRejectedValue(new ConnectError('gone', Code.NotFound)),
		})
		expect(vm.step).toBe('not-found')
		await fixture.stop(true)
	})
})
