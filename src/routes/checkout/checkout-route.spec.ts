import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	PublishState,
	SeriesSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConcert } from '../../adapter/rpc/client/concert-client'
import type { Checkout } from '../../entities/checkout'
import type {
	EventTicketSales,
	TicketSale,
	TicketStock,
} from '../../entities/ticket-sale'
import ja from '../../locales/ja/translation.json'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute))
}

const concert: ResolvedConcert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 20 } },
		openTime: { value: timestampFromDate(jst(20, 18)) },
		startTime: { value: timestampFromDate(jst(20, 19)) },
		listedVenueName: { value: 'Shibuya WWW' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
		organizerId: { value: 'org-1' },
		publishState: PublishState.PUBLISHED,
		organizer: {
			id: { value: 'org-1' },
			name: { value: 'Liverty Records' },
			legalName: { value: '株式会社リバティ' },
			representativeName: { value: '山田 太郎' },
			businessAddress: { value: '東京都渋谷区1-2-3' },
			businessPhoneNumber: { value: '+81312345678' },
			contactEmail: { value: 'info@example.com' },
		},
	}),
	artists: [],
}

/** The event's first-come sale. */
function sale(o: Partial<TicketSale> = {}): TicketSale {
	return {
		id: 'sale-1',
		name: '一般発売',
		method: 'firstCome',
		saleStartTime: jst(1, 10),
		saleEndTime: jst(20, 18),
		verificationRequirement: 'none',
		eventIds: [EVENT_ID],
		...o,
	}
}

/** The event's S席 stock `stock-s`, 3000 yen, Available. */
function stock(o: Partial<TicketStock> = {}): TicketStock {
	return {
		id: 'stock-s',
		eventId: EVENT_ID,
		seatTypeId: 'seat-s',
		seatTypeName: 'S席',
		price: 3000,
		state: 'available',
		lowStock: false,
		resaleOpen: false,
		...o,
	}
}

const A_SEAT = stock({
	id: 'stock-a',
	seatTypeId: 'seat-a',
	seatTypeName: 'A席',
	price: 2000,
})

/** ListByEvent's answer: the sales, the S席 and A席 stocks and a limit of 4. */
function tickets(
	sales: TicketSale[] = [sale()],
	s: Partial<TicketStock> = {},
): EventTicketSales {
	return { sales, stocks: [stock(s), A_SEAT], perAccountLimit: 4 }
}

function held(o: Partial<Checkout> = {}): Checkout {
	return {
		id: 'res-1',
		orderId: 'order-1',
		ticketSaleId: 'sale-1',
		ticketStockId: 'stock-s',
		ticketCount: 2,
		amount: 6000,
		status: 'held',
		holdExpireTime: new Date(Date.now() + 15 * 60 * 1000),
		...o,
	}
}

const mockConcert = { get: vi.fn() }
const mockSale = { listByEvent: vi.fn() }
const mockCheckout = {
	start: vi.fn(),
	get: vi.fn(),
	authorizeCard: vi.fn(),
	confirm: vi.fn(),
}
const fakePaymentElement = { mount: vi.fn(), destroy: vi.fn() }
const fakeElements = { create: vi.fn(() => fakePaymentElement) }
const fakeStripe = {}
const card = { tokenId: 'ctoken_1', brand: 'visa', last4: '4242' }
const mockStripe = {
	isConfigured: true,
	createCheckoutElements: vi.fn(),
	createCheckoutCard: vi.fn(),
	confirmCheckoutCardAuthorization: vi.fn(),
}
const mockUserStore: { current: unknown; currentLanguage: string } = {
	current: undefined,
	currentLanguage: 'ja',
}
const mockPush = { create: vi.fn() }
const mockNotifications = { permission: 'default' }
const mockPwa = { canShowInstallOption: false, install: vi.fn() }
const mockIdentityVerifications = { get: vi.fn() }
const mockRouter = { load: vi.fn() }

const mockAnalytics = { capture: vi.fn() }
const mockHeldSeatTypes = { heldTickets: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				// Key actions add a step for the error report.
				IErrorBoundaryService: { addBreadcrumb: () => {} },
				IAnalyticsService: mockAnalytics,
				IConcertRpcClient: mockConcert,
				ITicketSaleRpcClient: mockSale,
				ICheckoutRpcClient: mockCheckout,
				IStripeService: mockStripe,
				IUserStore: mockUserStore,
				IPushService: mockPush,
				INotificationManager: mockNotifications,
				IPwaInstallService: mockPwa,
				IIdentityVerificationService: mockIdentityVerifications,
				IRouter: mockRouter,
				IHeldSeatTypeService: mockHeldSeatTypes,
			}
			return map[(token as { friendlyName?: string }).friendlyName ?? ''] ?? {}
		}),
	}
})

import { Events } from '../../lib/analytics/analytics-service'
import { CheckoutRoute } from './checkout-route'

const flush = () => new Promise((r) => setTimeout(r, 0))

async function open(): Promise<CheckoutRoute> {
	const sut = new CheckoutRoute()
	sut.loading({ id: EVENT_ID, stockId: 'stock-s' })
	await vi.waitFor(() => expect(sut.step).not.toBe('loading'))
	return sut
}

/** Open the checkout and hold 2 tickets. */
async function holdTwo(): Promise<CheckoutRoute> {
	const sut = await open()
	sut.ticketCount = 2
	await sut.hold()
	return sut
}

/** Hold 2 tickets, fill in the personal details and reach the card form. */
async function toCard(): Promise<CheckoutRoute> {
	const sut = await holdTwo()
	sut.fullName = '山田 花子'
	sut.phoneNumber = '090-1234-5678'
	await sut.toPayment()
	sut.paymentElementHost = document.createElement('div')
	await flush()
	return sut
}

/** Reach the 特商法 final confirmation with an authorized card. */
async function toConfirm(): Promise<CheckoutRoute> {
	const sut = await toCard()
	await sut.authorizeCard()
	return sut
}

function connectError(code: Code): ConnectError {
	return new ConnectError('failed', code)
}

/** Interpolate a ja translation the way i18next does. */
function ja_(path: string, params: Record<string, string | number>): string {
	const template = path
		.split('.')
		.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], ja) as string
	return template.replace(/{{(\w+)}}/g, (_, k) => String(params[k]))
}

describe('CheckoutRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		localStorage.clear()
		mockStripe.isConfigured = true
		mockUserStore.current = undefined
		mockConcert.get.mockResolvedValue(concert)
		mockSale.listByEvent.mockResolvedValue(tickets())
		mockHeldSeatTypes.heldTickets.mockResolvedValue(null)
		mockCheckout.start.mockResolvedValue(held())
		mockCheckout.authorizeCard.mockResolvedValue('card_authorization_secret_1')
		mockCheckout.confirm.mockResolvedValue('order-1')
		mockStripe.createCheckoutElements.mockResolvedValue({
			stripe: fakeStripe,
			elements: fakeElements,
		})
		mockStripe.createCheckoutCard.mockResolvedValue({ card })
		mockStripe.confirmCheckoutCardAuthorization.mockResolvedValue({})
		mockIdentityVerifications.get.mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('count and hold', () => {
		it('shows the 税込 total and holds the tickets with a 15-minute countdown', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan picks two tickets"
			const sut = await open()
			sut.ticketCount = 2
			expect(sut.seatTypeName).toBe('S席')
			expect(sut.countOptions).toEqual([1, 2, 3, 4])
			expect(sut.total).toBe(6000)
			expect(ja_('checkout.total', { total: sut.yen(sut.total) })).toBe(
				'合計 6,000円（税込）',
			)

			await sut.hold()

			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				2,
				undefined,
				expect.anything(),
			)
			expect(sut.step).toBe('personal-details')
			expect(sut.countdown).toBe('15:00')
		})

		it('resumes the held checkout with the time left after a reload', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan reloads mid-checkout"
			vi.useFakeTimers({ toFake: ['Date'] })
			vi.setSystemTime(jst(5, 18, 5))
			localStorage.setItem(`checkout:${EVENT_ID}`, 'res-1')
			mockCheckout.get.mockResolvedValue(
				held({ holdExpireTime: jst(5, 18, 15) }),
			)

			const sut = await open()

			expect(sut.step).toBe('personal-details')
			expect(sut.ticketCount).toBe(2)
			expect(sut.countdown).toBe('10:00')
		})

		it('keeps the stored hold of another stock of the event', async () => {
			localStorage.setItem(`checkout:${EVENT_ID}`, 'res-1')
			mockCheckout.get.mockResolvedValue(held({ ticketStockId: 'stock-a' }))

			const sut = await open()

			expect(sut.step).toBe('count')
			expect(localStorage.getItem(`checkout:${EVENT_ID}`)).toBe('res-1')
		})

		it('says other fans are checking out when the last tickets are held', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Last tickets in other checkouts"
			mockCheckout.start.mockRejectedValue(connectError(Code.ResourceExhausted))
			const sut = await open()

			await sut.hold()

			expect(sut.step).toBe('count')
			expect(sut.message?.key).toBe('checkout.count.allHeld')
		})

		it('says how many tickets one account may hold for the event over the limit', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Over the limit"
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()

			await sut.hold()

			expect(sut.message).toEqual({
				key: 'checkout.count.limit',
				params: { limit: 4 },
			})
			expect(ja_('checkout.count.limit', { limit: 4 })).toContain(
				'すでにお持ちの枚数とお申し込み中の枚数を含めて',
			)
		})

		it('says the fan holds another seat type of the date', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Another seat type held"
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockHeldSeatTypes.heldTickets.mockResolvedValue({
				stock: A_SEAT,
				count: 2,
			})
			const sut = await open()

			await sut.hold()

			expect(sut.message).toEqual({
				key: 'checkout.count.otherSeatType',
				params: { seatType: 'A席' },
			})
			expect(
				ja_('checkout.count.otherSeatType', { seatType: 'A席' }),
			).toContain('この日程でお持ちのチケットはA席です')
			expect(
				ja_('checkout.count.otherSeatType', { seatType: 'A席' }),
			).toContain('1日程につき1つの席種')
		})

		it('re-reads the sale and says it ended, not that the limit was reached', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Sale ended before continuing"
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ saleEndTime: new Date(Date.now() - 1000) })]),
			)

			await sut.hold()

			expect(mockSale.listByEvent).toHaveBeenCalledTimes(2)
			expect(sut.message?.key).toBe('checkout.count.ended')
			expect(mockHeldSeatTypes.heldTickets).not.toHaveBeenCalled()
		})

		it('re-reads the sale and says the seat type sold out, not that the limit was reached', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Sale ended before continuing"
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale()], { state: 'soldOut' }),
			)

			await sut.hold()

			expect(sut.message?.key).toBe('checkout.count.soldOut')
		})

		it('says the concert was cancelled when its sale is gone', async () => {
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()
			mockSale.listByEvent.mockResolvedValue({
				sales: [],
				stocks: [],
				perAccountLimit: null,
			})

			await sut.hold()

			expect(sut.message?.key).toBe('checkout.count.cancelled')
		})

		it('starts no second hold while one is in flight', async () => {
			const sut = await open()
			const first = sut.hold()
			const second = sut.hold()
			await Promise.all([first, second])

			expect(mockCheckout.start).toHaveBeenCalledTimes(1)
		})
	})

	describe('usage events', () => {
		const SPEC = 'components/infrastructure/fan/web/route/checkout'

		function sentEvents(): unknown[][] {
			return mockAnalytics.capture.mock.calls
		}

		it(`@spec ${SPEC} "Fan reaches the final confirmation"`, async () => {
			await toConfirm()

			const step = (name: string) => [
				Events.CheckoutStepViewed,
				{ event_id: EVENT_ID, ticket_stock_id: 'stock-s', step: name },
			]
			expect(sentEvents()).toEqual([
				step('count'),
				[
					Events.TicketPurchaseInitiated,
					{
						event_id: EVENT_ID,
						ticket_stock_id: 'stock-s',
						ticket_count: 2,
						price_bucket: '3000_5999',
					},
				],
				step('personal-details'),
				step('payment'),
				step('confirm'),
			])
		})

		it(`@spec ${SPEC} "Verification notice instead of a hold"`, async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'verifiedAny' })]),
			)

			const sut = await open()

			expect(sut.step).toBe('verify-required')
			expect(sentEvents()).toEqual([
				[
					Events.CheckoutStepViewed,
					{
						event_id: EVENT_ID,
						ticket_stock_id: 'stock-s',
						step: 'verify-required',
					},
				],
			])
		})

		it('sends no purchase start when the hold is refused for the verification', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Verification notice instead of a hold"
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'jpkiOnly' })]),
			)
			const activeJpki = {
				id: 'iv1',
				userId: 'u1',
				method: 'jpki',
				status: 'active',
			}
			mockIdentityVerifications.get.mockResolvedValueOnce(activeJpki)
			const sut = await open()
			mockIdentityVerifications.get.mockResolvedValue({
				...activeJpki,
				status: 'needsReverification',
			})
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)

			await sut.hold()

			expect(sut.step).toBe('verify-required')
			expect(
				sentEvents().map(([name, props]) => [
					name,
					(props as { step?: string }).step,
				]),
			).toEqual([
				[Events.CheckoutStepViewed, 'count'],
				[Events.CheckoutStepViewed, 'verify-required'],
			])
		})
	})

	describe('verification', () => {
		const activeJpki = {
			id: 'iv1',
			userId: 'u1',
			method: 'jpki',
			status: 'active',
		}

		it('reads no IdentityVerification on a sale that requires no verification', async () => {
			const sut = await open()

			expect(sut.step).toBe('count')
			expect(sut.verificationNoteKey).toBeNull()
			expect(mockIdentityVerifications.get).not.toHaveBeenCalled()
		})

		it('gates a fan whose IdentityVerification is by licence on a JPKI-only sale', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'jpkiOnly' })]),
			)
			mockIdentityVerifications.get.mockResolvedValue({
				...activeJpki,
				method: 'driverLicence',
			})

			const sut = await open()

			expect(sut.step).toBe('verify-required')
			expect(mockCheckout.start).not.toHaveBeenCalled()
		})

		it('admits any Active IdentityVerification on a sale that requires any verification', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'verifiedAny' })]),
			)
			mockIdentityVerifications.get.mockResolvedValue({
				...activeJpki,
				method: 'driverLicence',
			})

			const sut = await open()

			expect(sut.step).toBe('count')
			expect(sut.verificationNoteKey).toBe('checkout.verify.noteAny')
		})

		it('shows a FailedPrecondition for a fan whose IdentityVerification lapsed as the missing verification, not the limit', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'jpkiOnly' })]),
			)
			mockIdentityVerifications.get.mockResolvedValueOnce(activeJpki)
			const sut = await open()
			expect(sut.step).toBe('count')
			// The IdentityVerification needs re-verification by the time the fan continues.
			mockIdentityVerifications.get.mockResolvedValue({
				...activeJpki,
				status: 'needsReverification',
			})
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)

			await sut.hold()

			expect(sut.step).toBe('verify-required')
			expect(sut.message).toBeNull()
		})

		it('says the limit was reached for a verified fan on a verified sale', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'jpkiOnly' })]),
			)
			mockIdentityVerifications.get.mockResolvedValue(activeJpki)
			mockCheckout.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()

			await sut.hold()

			expect(sut.message?.key).toBe('checkout.count.limit')
		})

		it('sends the fan to the Settings screen to verify', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ verificationRequirement: 'jpkiOnly' })]),
			)
			const sut = await open()

			await sut.goToVerify()

			expect(mockRouter.load).toHaveBeenCalledWith('/settings')
		})
	})

	describe('personal-details', () => {
		it('prefills the saved name and phone number, which stay editable', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Returning fan"
			mockUserStore.current = {
				id: 'u1',
				fullName: '山田 花子',
				phoneNumber: '+819012345678',
			}
			const sut = await holdTwo()

			expect(sut.fullName).toBe('山田 花子')
			expect(sut.phoneNumber).toBe('090-1234-5678')
			sut.fullName = '山田 はな'
			expect(sut.isPersonalDetailsValid).toBe(true)
		})

		it('sends a domestic phone number in E.164 form', async () => {
			const sut = await toConfirm()

			expect(mockCheckout.authorizeCard).toHaveBeenCalledWith(
				'res-1',
				'山田 花子',
				'+819012345678',
				expect.anything(),
			)
			expect(sut.step).toBe('confirm')
		})
	})

	describe('card', () => {
		it('lets the fan try another card without losing the hold', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Card declined"
			mockStripe.confirmCheckoutCardAuthorization.mockResolvedValueOnce({
				errorKey: 'payment.error.declined',
			})
			const sut = await toCard()

			await sut.authorizeCard()

			expect(sut.step).toBe('payment')
			expect(sut.cardError).toBe('payment.error.declined')
			expect(sut.checkout?.id).toBe('res-1')

			await sut.authorizeCard()
			expect(sut.step).toBe('confirm')
			expect(mockCheckout.start).toHaveBeenCalledTimes(1)
		})

		it('says the 15 minutes passed when authorizing after the hold ended', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Hold ended before authorizing"
			mockCheckout.authorizeCard.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await toCard()

			await sut.authorizeCard()

			expect(sut.message?.key).toBe('checkout.payment.holdEnded')
			sut.startAgain()
			expect(sut.step).toBe('count')
		})
	})

	describe('final confirmation', () => {
		it('shows every listed item and the action states what it pays', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Final confirmation shown"
			const sut = await toConfirm()

			expect(sut.event?.title).toBe('ONE MAN LIVE')
			expect(sut.dateLabel).toBe('2026年11月20日(金)')
			expect(sut.event?.venueName).toBe('Shibuya WWW')
			expect(sut.openTimeLabel).toBe('18:00')
			expect(sut.startTimeLabel).toBe('19:00')
			expect(sut.seatTypeName).toBe('S席')
			expect(sut.ticketCount).toBe(2)
			expect(sut.total).toBe(6000)
			expect(
				ja_('checkout.confirm.ticketsValue', {
					seatType: sut.seatTypeName,
					count: sut.ticketCount,
					price: sut.yen(sut.price),
					total: sut.yen(sut.total),
				}),
			).toBe('S席 2枚 × 3,000円 = 合計 6,000円（税込）')
			expect(ja_('checkout.confirm.cancellationValue', {})).toContain(
				'この公演でその席種が完売した場合にのみ',
			)
			expect(sut.cardLabel).toBe('VISA •••• 4242')
			expect(sut.salePeriodLabel).toBe(
				'2026年11月1日(日) 10:00 – 2026年11月20日(金) 18:00',
			)
			expect(sut.businessDetails).toEqual({
				legalName: '株式会社リバティ',
				representativeName: '山田 太郎',
				businessAddress: '東京都渋谷区1-2-3',
				businessPhoneNumber: '+81312345678',
				contactEmail: 'info@example.com',
			})
			expect(
				ja_('checkout.confirm.placeOrder', { total: sut.yen(sut.total) }),
			).toBe('6,000円を支払って購入する')
		})

		it('keeps the hold when the fan goes back to correct the name', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan corrects the name"
			const sut = await toConfirm()
			sut.changePersonalDetails()
			sut.fullName = '山田 はな子'

			await sut.toPayment()

			expect(sut.step).toBe('confirm')
			expect(mockCheckout.authorizeCard).toHaveBeenLastCalledWith(
				'res-1',
				'山田 はな子',
				'+819012345678',
				expect.anything(),
			)
			expect(mockStripe.confirmCheckoutCardAuthorization).toHaveBeenCalledTimes(
				1,
			)
			expect(sut.checkout?.id).toBe('res-1')
		})

		it('places the order once on a double tap', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Double tap on the action"
			const sut = await toConfirm()

			await Promise.all([sut.placeOrder(), sut.placeOrder()])

			expect(mockCheckout.confirm).toHaveBeenCalledTimes(1)
		})

		it('authorizes the card again after a new count', async () => {
			const sut = await toConfirm()
			sut.changeCount()
			mockCheckout.start.mockResolvedValue(
				held({ id: 'res-2', ticketCount: 3, amount: 9000 }),
			)

			await sut.hold()

			expect(sut.card).toBeNull()
			expect(sut.total).toBe(9000)
		})
	})

	describe('outcome', () => {
		it('shows the completion with the tickets, the total and a link to Tickets', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Purchase placed"
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.step).toBe('done')
			expect(
				ja_('checkout.done.summary', {
					event: 'ONE MAN LIVE',
					count: sut.ticketCount,
					total: sut.yen(sut.total),
				}),
			).toContain('2枚')
			expect(sut.yen(sut.total)).toBe('6,000')
			expect(localStorage.getItem(`checkout:${EVENT_ID}`)).toBeNull()
			expect(sut.canAllowNotifications).toBe(true)
		})

		it('says the 15 minutes passed and nothing was charged when the hold ended', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Hold ended at the last step"
			mockCheckout.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockCheckout.get.mockResolvedValue(held({ status: 'expired' }))
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.step).toBe('outcome')
			expect(sut.outcome).toBe('hold-ended')
			expect(ja.checkout.outcome.holdEnded).toContain('請求は行われていません')
		})

		it('says the purchase is being completed when the charge is still completing', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Charge still completing"
			mockCheckout.confirm.mockRejectedValue(connectError(Code.Unavailable))
			mockCheckout.get.mockResolvedValue(
				held({ status: 'committed', commitTime: new Date() }),
			)
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.outcome).toBe('completing')
		})

		it('says the card could not be charged after a commit', async () => {
			mockCheckout.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockCheckout.get.mockResolvedValue(
				held({ status: 'released', commitTime: new Date() }),
			)
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.outcome).toBe('charge-failed')
		})

		it('offers the newer checkout when another tab replaced this one', async () => {
			mockCheckout.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockCheckout.get.mockResolvedValue(held({ status: 'released' }))
			const sut = await toConfirm()
			localStorage.setItem(`checkout:${EVENT_ID}`, 'res-9')

			await sut.placeOrder()

			expect(sut.outcome).toBe('replaced')
			expect(localStorage.getItem(`checkout:${EVENT_ID}`)).toBe('res-9')
		})

		it('asks to finish the card authentication while the checkout is still held', async () => {
			mockCheckout.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockCheckout.get.mockResolvedValue(held())
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.step).toBe('personal-details')
			expect(sut.message?.key).toBe('checkout.outcome.authenticationIncomplete')
		})
	})

	describe('loading', () => {
		it('fails closed when payments are not configured', async () => {
			mockStripe.isConfigured = false
			const sut = await open()
			expect(sut.step).toBe('unavailable')
		})

		it('shows not found when the event has no first-come sale', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([sale({ method: 'lottery', name: 'ファンクラブ先行' })]),
			)
			const sut = await open()
			expect(sut.step).toBe('not-found')
		})

		it('shows not found when the event has no such stock', async () => {
			mockSale.listByEvent.mockResolvedValue({
				sales: [sale()],
				stocks: [A_SEAT],
				perAccountLimit: 4,
			})
			const sut = await open()
			expect(sut.step).toBe('not-found')
		})

		it('checks out the stock in the first-come sale after a lottery presale', async () => {
			mockSale.listByEvent.mockResolvedValue(
				tickets([
					sale({ id: 'presale', method: 'lottery', saleEndTime: jst(1, 9) }),
					sale(),
				]),
			)
			const sut = await open()

			expect(sut.sale?.id).toBe('sale-1')
			await sut.hold()
			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				1,
				undefined,
				expect.anything(),
			)
		})

		it('saves the authorized name and phone number on the User for the next screen', async () => {
			mockUserStore.current = { id: 'u1' }
			await toConfirm()

			expect(mockUserStore.current).toEqual({
				id: 'u1',
				fullName: '山田 花子',
				phoneNumber: '+819012345678',
			})
		})
	})

	describe('referral code', () => {
		const DAY = 24 * 60 * 60 * 1000

		/** Keep a code the way the Event page does, `daysAgo` days before now. */
		function keptCode(code: string, seriesId: string, daysAgo: number): void {
			localStorage.setItem(
				'referral',
				JSON.stringify({
					code,
					seriesId,
					expiresAt: Date.now() - daysAgo * DAY + 7 * DAY,
				}),
			)
		}

		it('sends the code kept for the same Series three days ago', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Purchase three days after the link"
			keptCode('member-a', 's1', 3)
			await holdTwo()

			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				2,
				'member-a',
				expect.anything(),
			)
		})

		it('sends no code once it has expired', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Code expired"
			keptCode('member-a', 's1', 8)
			await holdTwo()

			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				2,
				undefined,
				expect.anything(),
			)
		})

		it('sends no code kept for another Series', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Another Series"
			keptCode('member-a', 's-other', 1)
			await holdTwo()

			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				2,
				undefined,
				expect.anything(),
			)
		})

		it('sends no code when none is kept', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Direct visit"
			await holdTwo()

			expect(mockCheckout.start).toHaveBeenCalledWith(
				'stock-s',
				2,
				undefined,
				expect.anything(),
			)
		})

		it('leaves the kept code on the device after the order is placed', async () => {
			keptCode('member-a', 's1', 1)
			const sut = await toConfirm()
			await sut.placeOrder()

			expect(mockCheckout.confirm).toHaveBeenCalled()
			expect(localStorage.getItem('referral')).toContain('"member-a"')
		})
	})
})
