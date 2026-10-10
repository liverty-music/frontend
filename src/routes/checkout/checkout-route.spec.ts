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
import type { Reservation } from '../../entities/reservation'
import type { TicketSale } from '../../entities/ticket-sale'
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
			sellerDetails: {
				legalName: '株式会社リバティ',
				representativeName: '山田 太郎',
				address: '東京都渋谷区1-2-3',
				phoneNumber: '+81312345678',
				contactEmail: 'info@example.com',
			},
		},
	}),
	artists: [],
}

function sale(o: Partial<TicketSale> = {}): TicketSale {
	return {
		id: 'sale-1',
		eventId: EVENT_ID,
		saleStart: jst(1, 10),
		saleEnd: jst(20, 18),
		price: 3000,
		perAccountLimit: 4,
		state: 'onSale',
		lowStock: false,
		...o,
	}
}

function held(o: Partial<Reservation> = {}): Reservation {
	return {
		id: 'res-1',
		ticketSaleId: 'sale-1',
		ticketCount: 2,
		amount: 6000,
		status: 'held',
		holdExpireTime: new Date(Date.now() + 15 * 60 * 1000),
		...o,
	}
}

const mockConcert = { get: vi.fn() }
const mockSale = { get: vi.fn() }
const mockReservation = {
	start: vi.fn(),
	get: vi.fn(),
	authorize: vi.fn(),
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
	confirmCheckoutHold: vi.fn(),
}
const mockUserStore: { current: unknown; currentLanguage: string } = {
	current: undefined,
	currentLanguage: 'ja',
}
const mockPush = { create: vi.fn() }
const mockNotifications = { permission: 'default' }
const mockPwa = { canShowInstallOption: false, install: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IConcertRpcClient: mockConcert,
				ITicketSaleRpcClient: mockSale,
				IReservationRpcClient: mockReservation,
				IStripeService: mockStripe,
				IUserStore: mockUserStore,
				IPushService: mockPush,
				INotificationManager: mockNotifications,
				IPwaInstallService: mockPwa,
			}
			return map[(token as { friendlyName?: string }).friendlyName ?? ''] ?? {}
		}),
	}
})

import { CheckoutRoute } from './checkout-route'

const flush = () => new Promise((r) => setTimeout(r, 0))

async function open(): Promise<CheckoutRoute> {
	const sut = new CheckoutRoute()
	sut.loading({ id: EVENT_ID })
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

/** Hold 2 tickets, fill in the identity and reach the card form. */
async function toCard(): Promise<CheckoutRoute> {
	const sut = await holdTwo()
	sut.fullName = '山田 花子'
	sut.phoneNumber = '090-1234-5678'
	await sut.toPayment()
	sut.paymentElementHost = document.createElement('div')
	await flush()
	return sut
}

/** Reach the 特商法 final confirmation with a held card. */
async function toConfirm(): Promise<CheckoutRoute> {
	const sut = await toCard()
	await sut.authorize()
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
		mockSale.get.mockResolvedValue(sale())
		mockReservation.start.mockResolvedValue(held())
		mockReservation.authorize.mockResolvedValue('pi_secret_1')
		mockReservation.confirm.mockResolvedValue('order-1')
		mockStripe.createCheckoutElements.mockResolvedValue({
			stripe: fakeStripe,
			elements: fakeElements,
		})
		mockStripe.createCheckoutCard.mockResolvedValue({ card })
		mockStripe.confirmCheckoutHold.mockResolvedValue({})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('count and hold', () => {
		it('shows the 税込 total and holds the tickets with a 15-minute countdown', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan picks two tickets"
			const sut = await open()
			sut.ticketCount = 2
			expect(sut.total).toBe(6000)
			expect(ja_('checkout.total', { total: sut.yen(sut.total) })).toBe(
				'合計 6,000円（税込）',
			)

			await sut.hold()

			expect(mockReservation.start).toHaveBeenCalledWith(
				'sale-1',
				2,
				expect.anything(),
			)
			expect(sut.step).toBe('identity')
			expect(sut.countdown).toBe('15:00')
		})

		it('resumes the held checkout with the time left after a reload', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan reloads mid-checkout"
			vi.useFakeTimers({ toFake: ['Date'] })
			vi.setSystemTime(jst(5, 18, 5))
			localStorage.setItem(`liverty:checkout:${EVENT_ID}`, 'res-1')
			mockReservation.get.mockResolvedValue(
				held({ holdExpireTime: jst(5, 18, 15) }),
			)

			const sut = await open()

			expect(sut.step).toBe('identity')
			expect(sut.ticketCount).toBe(2)
			expect(sut.countdown).toBe('10:00')
		})

		it('says other fans are checking out when the last tickets are held', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Last tickets in other checkouts"
			mockReservation.start.mockRejectedValue(
				connectError(Code.ResourceExhausted),
			)
			const sut = await open()

			await sut.hold()

			expect(sut.step).toBe('count')
			expect(sut.message?.key).toBe('checkout.count.allHeld')
		})

		it('says how many tickets one account may buy over the limit', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Over the limit"
			mockReservation.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()

			await sut.hold()

			expect(sut.message).toEqual({
				key: 'checkout.count.limit',
				params: { limit: 4 },
			})
		})

		it('re-reads the sale and says it ended, not that the limit was reached', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Sale ended before continuing"
			mockReservation.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()
			mockSale.get.mockResolvedValue(sale({ state: 'ended' }))

			await sut.hold()

			expect(sut.message?.key).toBe('checkout.count.ended')
		})

		it('says the concert was cancelled when its sale is gone', async () => {
			mockReservation.start.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await open()
			mockSale.get.mockResolvedValue(null)

			await sut.hold()

			expect(sut.message?.key).toBe('checkout.count.cancelled')
		})

		it('starts no second hold while one is in flight', async () => {
			const sut = await open()
			const first = sut.hold()
			const second = sut.hold()
			await Promise.all([first, second])

			expect(mockReservation.start).toHaveBeenCalledTimes(1)
		})
	})

	describe('identity', () => {
		it('prefills the saved name and phone number, which stay editable', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Returning buyer"
			mockUserStore.current = {
				id: 'u1',
				holderIdentity: { fullName: '山田 花子', phoneNumber: '+819012345678' },
			}
			const sut = await holdTwo()

			expect(sut.fullName).toBe('山田 花子')
			expect(sut.phoneNumber).toBe('+819012345678')
			sut.fullName = '山田 はな'
			expect(sut.isIdentityValid).toBe(true)
		})

		it('sends a domestic phone number in E.164 form', async () => {
			const sut = await toConfirm()

			expect(mockReservation.authorize).toHaveBeenCalledWith(
				'res-1',
				{ fullName: '山田 花子', phoneNumber: '+819012345678' },
				expect.anything(),
			)
			expect(sut.step).toBe('confirm')
		})
	})

	describe('card', () => {
		it('lets the fan try another card without losing the hold', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Card declined"
			mockStripe.confirmCheckoutHold.mockResolvedValueOnce({
				errorMessage: 'カードが拒否されました。',
			})
			const sut = await toCard()

			await sut.authorize()

			expect(sut.step).toBe('payment')
			expect(sut.cardError).toBe('カードが拒否されました。')
			expect(sut.reservation?.id).toBe('res-1')

			await sut.authorize()
			expect(sut.step).toBe('confirm')
			expect(mockReservation.start).toHaveBeenCalledTimes(1)
		})

		it('says the 15 minutes passed when authorizing after the hold ended', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Hold ended before authorizing"
			mockReservation.authorize.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			const sut = await toCard()

			await sut.authorize()

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
			expect(sut.ticketCount).toBe(2)
			expect(sut.total).toBe(6000)
			expect(sut.cardLabel).toBe('VISA •••• 4242')
			expect(sut.salePeriodLabel).toBe(
				'2026年11月1日(日) 10:00 – 2026年11月20日(金) 18:00',
			)
			expect(sut.seller).toEqual({
				legalName: '株式会社リバティ',
				representativeName: '山田 太郎',
				address: '東京都渋谷区1-2-3',
				phoneNumber: '+81312345678',
				contactEmail: 'info@example.com',
			})
			expect(
				ja_('checkout.confirm.placeOrder', { total: sut.yen(sut.total) }),
			).toBe('6,000円を支払って購入する')
		})

		it('keeps the hold when the fan goes back to correct the name', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Fan corrects the name"
			const sut = await toConfirm()
			sut.changeIdentity()
			sut.fullName = '山田 はな子'

			await sut.toPayment()

			expect(sut.step).toBe('confirm')
			expect(mockReservation.authorize).toHaveBeenLastCalledWith(
				'res-1',
				{ fullName: '山田 はな子', phoneNumber: '+819012345678' },
				expect.anything(),
			)
			expect(mockStripe.confirmCheckoutHold).toHaveBeenCalledTimes(1)
			expect(sut.reservation?.id).toBe('res-1')
		})

		it('places the order once on a double tap', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Double tap on the action"
			const sut = await toConfirm()

			await Promise.all([sut.placeOrder(), sut.placeOrder()])

			expect(mockReservation.confirm).toHaveBeenCalledTimes(1)
		})

		it('authorizes the card again after a new count', async () => {
			const sut = await toConfirm()
			sut.changeCount()
			mockReservation.start.mockResolvedValue(
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
			expect(localStorage.getItem(`liverty:checkout:${EVENT_ID}`)).toBeNull()
			expect(sut.canAllowNotifications).toBe(true)
		})

		it('says the 15 minutes passed and nothing was charged when the hold ended', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Hold ended at the last step"
			mockReservation.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockReservation.get.mockResolvedValue(held({ status: 'expired' }))
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.step).toBe('outcome')
			expect(sut.outcome).toBe('hold-ended')
			expect(ja.checkout.outcome.holdEnded).toContain('請求は行われていません')
		})

		it('says the purchase is being completed when the charge is still completing', async () => {
			// @spec components/infrastructure/fan/web/route/checkout "Charge still completing"
			mockReservation.confirm.mockRejectedValue(connectError(Code.Unavailable))
			mockReservation.get.mockResolvedValue(
				held({ status: 'committed', commitTime: new Date() }),
			)
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.outcome).toBe('completing')
		})

		it('says the card could not be charged after a commit', async () => {
			mockReservation.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockReservation.get.mockResolvedValue(
				held({ status: 'released', commitTime: new Date() }),
			)
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.outcome).toBe('charge-failed')
		})

		it('offers the newer checkout when another tab replaced this one', async () => {
			mockReservation.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockReservation.get.mockResolvedValue(held({ status: 'released' }))
			const sut = await toConfirm()
			localStorage.setItem(`liverty:checkout:${EVENT_ID}`, 'res-9')

			await sut.placeOrder()

			expect(sut.outcome).toBe('replaced')
			expect(localStorage.getItem(`liverty:checkout:${EVENT_ID}`)).toBe('res-9')
		})

		it('asks to finish the card authentication while the checkout is still held', async () => {
			mockReservation.confirm.mockRejectedValue(
				connectError(Code.FailedPrecondition),
			)
			mockReservation.get.mockResolvedValue(held())
			const sut = await toConfirm()

			await sut.placeOrder()

			expect(sut.step).toBe('identity')
			expect(sut.message?.key).toBe('checkout.outcome.authenticationIncomplete')
		})
	})

	describe('loading', () => {
		it('fails closed when payments are not configured', async () => {
			mockStripe.isConfigured = false
			const sut = await open()
			expect(sut.step).toBe('unavailable')
		})

		it('shows not found when the event has no sale', async () => {
			mockSale.get.mockResolvedValue(null)
			const sut = await open()
			expect(sut.step).toBe('not-found')
		})
	})
})
