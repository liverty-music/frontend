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
import type { LotteryEntry } from '../../entities/lottery-entry'
import type { TicketSale } from '../../entities/ticket-sale'
import type { ConfirmCardAuthorizationResult } from '../../services/stripe-service'

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
const TYPE_ID = '019a0000-0000-7000-8000-0000000000t1'

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9))
}

const concert: ResolvedConcert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 3 } },
		startTime: { value: timestampFromDate(jst(3, 19)) },
		listedVenueName: { value: 'Zepp Haneda' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
		publishState: PublishState.PUBLISHED,
	}),
	artists: [],
}

/** The ファンクラブ先行 lottery, open now, 8000 yen with a limit of 4. */
function presale(o: Partial<TicketSale> = {}): TicketSale {
	return {
		id: 'sale-1',
		name: 'ファンクラブ先行',
		method: 'lottery',
		saleStartTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
		saleEndTime: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
		verificationRequirement: 'none',
		ticketType: {
			id: TYPE_ID,
			eventId: EVENT_ID,
			price: 8000,
			perAccountLimit: 4,
			state: 'ended',
			lowStock: false,
			resaleOpen: false,
			resaleAvailable: false,
		},
		...o,
	}
}

function draft(o: Partial<LotteryEntry> = {}): LotteryEntry {
	return {
		id: 'entry-1',
		ticketTypeId: TYPE_ID,
		ticketCount: 2,
		state: 'draft',
		...o,
	}
}

const mockConcert = { get: vi.fn() }
const mockSale = { listByEvent: vi.fn() }
const mockEntry = {
	start: vi.fn(),
	authorizeCard: vi.fn(),
	confirm: vi.fn(),
}

// A minimal fake Elements group + Payment Element. The service's
// createElements/confirmCardAuthorization are mocked, so these only need to
// satisfy the mount handshake in the viewmodel.
const fakePaymentElement = { mount: vi.fn(), destroy: vi.fn() }
const fakeElements = { create: vi.fn(() => fakePaymentElement) }
const fakeStripe = {}

const mockStripe = {
	isConfigured: true,
	createElements: vi.fn(),
	confirmCardAuthorization: vi.fn(),
}

const mockIdentityVerifications = { get: vi.fn() }
const mockRouter = { load: vi.fn(async () => true) }
const mockUserStore: { current: unknown; currentLanguage: string } = {
	current: undefined,
	currentLanguage: 'ja',
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IConcertRpcClient: mockConcert,
				ITicketSaleRpcClient: mockSale,
				ILotteryEntryRpcClient: mockEntry,
				IStripeService: mockStripe,
				IIdentityVerificationService: mockIdentityVerifications,
				IUserStore: mockUserStore,
				IRouter: mockRouter,
			}
			return map[(token as { friendlyName?: string }).friendlyName ?? ''] ?? {}
		}),
	}
})

import { LotteryEntryRoute } from './lottery-entry-route'

// Flush pending microtasks (the mount handshake uses queueMicrotask).
const flush = () => new Promise((r) => setTimeout(r, 0))

async function open(): Promise<LotteryEntryRoute> {
	const sut = new LotteryEntryRoute()
	sut.loading({ id: EVENT_ID, ticketTypeId: TYPE_ID })
	await vi.waitFor(() => expect(sut.step).not.toBe('loading'))
	return sut
}

/** Open the entry, start a Draft for 2 tickets and fill in the personal details. */
async function toPersonalDetails(
	phone = '090-1234-5678',
): Promise<LotteryEntryRoute> {
	const sut = await open()
	sut.ticketCount = 2
	await sut.toPersonalDetails()
	sut.fullName = '山田 花子'
	sut.phoneNumber = phone
	return sut
}

/** Reach the card form with an authorized Draft. */
async function toPayment(phone?: string): Promise<LotteryEntryRoute> {
	const sut = await toPersonalDetails(phone)
	sut.paymentElementHost = document.createElement('div')
	await sut.toPayment()
	await flush()
	return sut
}

describe('LotteryEntryRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockStripe.isConfigured = true
		mockUserStore.current = undefined
		mockConcert.get.mockResolvedValue(concert)
		mockSale.listByEvent.mockResolvedValue([presale()])
		mockEntry.start.mockResolvedValue(draft())
		mockEntry.authorizeCard.mockResolvedValue('card_authorization_secret_123')
		mockEntry.confirm.mockResolvedValue(draft({ state: 'entered' }))
		mockStripe.createElements.mockResolvedValue({
			stripe: fakeStripe,
			elements: fakeElements,
		})
		mockStripe.confirmCardAuthorization.mockResolvedValue({
			cardAuthorizationId: 'pi_confirmed_999',
		} satisfies ConfirmCardAuthorizationResult)
		mockIdentityVerifications.get.mockResolvedValue(undefined)
	})

	describe('the TicketType entered', () => {
		it('shows the sale name, the event, the price and offers 1 to the limit', async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "Presale entry"
			const sut = await open()

			expect(sut.step).toBe('count')
			expect(sut.sale?.name).toBe('ファンクラブ先行')
			expect(sut.event?.title).toBe('ONE MAN LIVE')
			expect(sut.dateLabel).toBe('2026年11月3日(火)')
			expect(sut.yen(sut.price)).toBe('8,000')
			expect(sut.perAccountLimit).toBe(4)
			expect(sut.countOptions).toEqual([1, 2, 3, 4])
		})

		it('shows not found for a TicketType the event does not offer by lottery', async () => {
			mockSale.listByEvent.mockResolvedValue([presale({ method: 'firstCome' })])
			const sut = await open()
			expect(sut.step).toBe('not-found')
		})

		it('says the lottery takes no entries outside its window', async () => {
			mockSale.listByEvent.mockResolvedValue([
				presale({ saleEndTime: new Date(Date.now() - 1000) }),
			])
			const sut = await open()
			expect(sut.step).toBe('closed')
		})

		it('fails closed when payments are not configured', async () => {
			mockStripe.isConfigured = false
			const sut = await open()
			expect(sut.step).toBe('unavailable')
		})
	})

	describe('saved details are prefilled', () => {
		it("fills in the fan's saved name and phone number", async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "Returning fan"
			mockUserStore.current = {
				id: 'u1',
				fullName: '山田 花子',
				phoneNumber: '+819012345678',
			}
			const sut = await open()

			expect(sut.fullName).toBe('山田 花子')
			expect(sut.phoneNumber).toBe('090-1234-5678')
		})

		it('leaves both fields empty for a fan who never gave them', async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "First entry"
			mockUserStore.current = { id: 'u1' }
			const sut = await open()

			expect(sut.fullName).toBe('')
			expect(sut.phoneNumber).toBe('')
		})
	})

	describe('Start → Authorize → Confirm', () => {
		it('starts a Draft for the TicketType and the count', async () => {
			const sut = await toPersonalDetails()

			expect(mockEntry.start).toHaveBeenCalledWith(
				TYPE_ID,
				2,
				undefined,
				expect.anything(),
			)
			expect(sut.step).toBe('personal-details')
		})

		it('authorizes with the name and E.164 phone number and mounts the card form', async () => {
			const sut = await toPayment()

			expect(mockEntry.authorizeCard).toHaveBeenCalledWith(
				'entry-1',
				'山田 花子',
				'+819012345678',
				expect.anything(),
			)
			expect(mockStripe.createElements).toHaveBeenCalledWith(
				'card_authorization_secret_123',
			)
			expect(fakePaymentElement.mount).toHaveBeenCalledOnce()
			expect(sut.step).toBe('payment')
		})

		it('saves the authorized name and phone number on the User', async () => {
			mockUserStore.current = { id: 'u1' }
			await toPayment()

			expect(mockUserStore.current).toEqual({
				id: 'u1',
				fullName: '山田 花子',
				phoneNumber: '+819012345678',
			})
		})

		it('shows the entry as made only after Confirm succeeds', async () => {
			let resolveConfirm: (e: LotteryEntry) => void = () => {}
			mockEntry.confirm.mockReturnValue(
				new Promise<LotteryEntry>((r) => {
					resolveConfirm = r
				}),
			)
			const sut = await toPayment()

			const done = sut.confirmEntry()
			await flush()
			expect(mockStripe.confirmCardAuthorization).toHaveBeenCalledOnce()
			expect(mockEntry.confirm).toHaveBeenCalledWith(
				'entry-1',
				expect.anything(),
			)
			expect(sut.step).toBe('submitting')

			resolveConfirm(draft({ state: 'entered' }))
			await done
			expect(sut.step).toBe('done')
			expect(sut.entry?.state).toBe('entered')
		})

		it.each([
			// @spec components/infrastructure/fan/web/route/lottery-entry "Domestic number with hyphens"
			['090-1234-5678', '+819012345678'],
			// @spec components/infrastructure/fan/web/route/lottery-entry "Landline number"
			['03 1234 5678', '+81312345678'],
			// @spec components/infrastructure/fan/web/route/lottery-entry "E.164 number with spaces"
			['+81 90 1234 5678', '+819012345678'],
		])('enters %j with the phone number %j', async (typed, sent) => {
			const sut = await toPayment(typed)

			await sut.confirmEntry()

			expect(mockEntry.authorizeCard).toHaveBeenCalledWith(
				'entry-1',
				'山田 花子',
				sent,
				expect.anything(),
			)
			// The field keeps what the fan typed.
			expect(sut.phoneNumber).toBe(typed)
			expect(sut.step).toBe('done')
		})

		it('opens the card authorization anew after a new count replaces the Draft', async () => {
			const sut = await toPayment()
			sut.backToCount()
			mockEntry.start.mockResolvedValue(
				draft({ id: 'entry-2', ticketCount: 3 }),
			)
			sut.ticketCount = 3

			await sut.toPersonalDetails()
			await sut.toPayment()

			expect(mockEntry.authorizeCard).toHaveBeenLastCalledWith(
				'entry-2',
				'山田 花子',
				'+819012345678',
				expect.anything(),
			)
			expect(mockStripe.createElements).toHaveBeenCalledTimes(2)
		})
	})

	describe('phone number entry', () => {
		// @spec components/infrastructure/fan/web/route/lottery-entry "Number fits neither form"
		it.each(['12345', '9012345678'])(
			'keeps continue disabled and flags %j as invalid',
			async (phone) => {
				const sut = await toPersonalDetails(phone)

				expect(sut.isPersonalDetailsValid).toBe(false)
				expect(sut.isPhoneInvalid).toBe(true)
				await sut.toPayment()
				expect(mockEntry.authorizeCard).not.toHaveBeenCalled()
				expect(sut.step).toBe('personal-details')
			},
		)

		it('does not flag an empty phone number as invalid', async () => {
			const sut = await toPersonalDetails('  ')
			expect(sut.isPhoneInvalid).toBe(false)
			expect(sut.isPersonalDetailsValid).toBe(false)
		})
	})

	describe('errors', () => {
		it('says how many tickets one account may hold when Start is refused', async () => {
			mockEntry.start.mockRejectedValue(
				new ConnectError('limit', Code.FailedPrecondition),
			)
			const sut = await open()

			await sut.toPersonalDetails()

			expect(sut.step).toBe('count')
			expect(sut.message).toEqual({
				key: 'lotteryEntry.count.limit',
				params: { limit: 4 },
			})
		})

		it('surfaces a card error and does not Confirm', async () => {
			mockStripe.confirmCardAuthorization.mockResolvedValueOnce({
				errorKey: 'payment.error.declined',
			})
			const sut = await toPayment()

			await sut.confirmEntry()

			expect(mockEntry.confirm).not.toHaveBeenCalled()
			expect(sut.cardError).toBe('payment.error.declined')
			expect(sut.step).toBe('payment')
		})

		it('retries Confirm without confirming the card again', async () => {
			mockEntry.confirm.mockRejectedValueOnce(new Error('server rejected'))
			const sut = await toPayment()

			await sut.confirmEntry()
			expect(sut.message?.key).toBe('lotteryEntry.error.confirm')
			expect(sut.step).toBe('payment')

			await sut.confirmEntry()
			expect(mockStripe.confirmCardAuthorization).toHaveBeenCalledOnce()
			expect(mockEntry.confirm).toHaveBeenCalledTimes(2)
			expect(sut.step).toBe('done')
		})
	})

	describe('verification gate', () => {
		it('parks an unverified fan when the sale requires verification', async () => {
			mockSale.listByEvent.mockResolvedValue([
				presale({ verificationRequirement: 'verifiedAny' }),
			])
			const sut = await open()

			expect(mockIdentityVerifications.get).toHaveBeenCalledOnce()
			expect(sut.step).toBe('verify-required')
			await sut.goToVerify()
			expect(mockRouter.load).toHaveBeenCalledWith('/settings')
		})

		it('lets a verified fan straight into the count step', async () => {
			mockSale.listByEvent.mockResolvedValue([
				presale({ verificationRequirement: 'verifiedAny' }),
			])
			mockIdentityVerifications.get.mockResolvedValue({
				method: 'driverLicence',
				status: 'active',
			})
			const sut = await open()
			expect(sut.step).toBe('count')
		})

		it('parks a fan verified by driver licence when the sale is JPKI only', async () => {
			mockSale.listByEvent.mockResolvedValue([
				presale({ verificationRequirement: 'jpkiOnly' }),
			])
			mockIdentityVerifications.get.mockResolvedValue({
				method: 'driverLicence',
				status: 'active',
			})
			const sut = await open()
			expect(sut.step).toBe('verify-required')
		})

		it('does not read the status when the sale requires none', async () => {
			const sut = await open()
			expect(mockIdentityVerifications.get).not.toHaveBeenCalled()
			expect(sut.step).toBe('count')
		})

		it('proceeds when the status read fails (the server checks it at Start)', async () => {
			mockSale.listByEvent.mockResolvedValue([
				presale({ verificationRequirement: 'verifiedAny' }),
			])
			mockIdentityVerifications.get.mockRejectedValue(new Error('UNAVAILABLE'))
			const sut = await open()
			expect(sut.step).toBe('count')
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

		afterEach(() => {
			localStorage.removeItem('referral')
		})

		function startedWith(): unknown {
			return mockEntry.start.mock.calls.at(-1)?.[2]
		}

		it('sends the code kept for the same Series yesterday', async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "Entry from a referral link"
			keptCode('member-a', 's1', 1)
			await toPersonalDetails()

			expect(startedWith()).toBe('member-a')
		})

		it('sends no code kept for another Series', async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "Another Series"
			keptCode('member-a', 's-other', 1)
			await toPersonalDetails()

			expect(mockEntry.start).toHaveBeenCalledOnce()
			expect(startedWith()).toBeUndefined()
		})

		it('sends no code once it has expired', async () => {
			// @spec components/infrastructure/fan/web/route/lottery-entry "Code expired"
			keptCode('member-a', 's1', 8)
			await toPersonalDetails()

			expect(mockEntry.start).toHaveBeenCalledOnce()
			expect(startedWith()).toBeUndefined()
		})
	})
})
