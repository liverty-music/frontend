import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationDraft } from '../../adapter/rpc/client/lottery-client'
import type { ConfirmAuthorizationResult } from '../../services/stripe-service'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const mockLottery = {
	createAuthorization: vi.fn(
		async (): Promise<AuthorizationDraft> => ({
			clientSecret: 'cs_test_123',
			paymentIntentRef: 'pi_ref_123',
		}),
	),
	apply: vi.fn(async () => ({})),
	withdrawApplication: vi.fn(async () => undefined),
	getMyApplication: vi.fn(async () => undefined),
	getResult: vi.fn(async () => undefined),
}

// A minimal fake Elements group + Payment Element. The service's
// createElements/confirmAuthorization are mocked, so these only need to
// satisfy the mount handshake in the viewmodel.
const fakePaymentElement = { mount: vi.fn(), destroy: vi.fn() }
const fakeElements = { create: vi.fn(() => fakePaymentElement) }
const fakeStripe = {}

const mockStripe = {
	isConfigured: true,
	createElements: vi.fn(async () => ({
		stripe: fakeStripe,
		elements: fakeElements,
	})),
	confirmAuthorization: vi.fn(
		async (): Promise<ConfirmAuthorizationResult> => ({
			paymentIntentId: 'pi_confirmed_999',
		}),
	),
}

const mockIdentity = {
	getMyVerificationStatus: vi.fn(async () => ({ level: 'unverified' })),
}

const mockRouter = {
	load: vi.fn(async () => true),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				ILotteryRpcClient: mockLottery,
				IStripeService: mockStripe,
				IIdentityVerificationService: mockIdentity,
				IRouter: mockRouter,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { LotteryApplyRoute } from './lottery-apply-route'

// Flush pending microtasks (the mount handshake uses queueMicrotask).
const flush = () => new Promise((r) => setTimeout(r, 0))

function makeSut(overrides?: Partial<LotteryApplyRoute>): LotteryApplyRoute {
	const sut = new LotteryApplyRoute()
	sut.loading({ phaseId: 'phase-1', maxTickets: '4', ticketPrice: '5000' })
	Object.assign(sut, overrides)
	return sut
}

describe('LotteryApplyRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockStripe.isConfigured = true
		mockStripe.createElements.mockImplementation(async () => ({
			stripe: fakeStripe,
			elements: fakeElements,
		}))
		mockStripe.confirmAuthorization.mockImplementation(async () => ({
			paymentIntentId: 'pi_confirmed_999',
		}))
	})

	describe('count validation (1..max)', () => {
		it('accepts an integer count within 1..max', () => {
			const sut = makeSut({ ticketCount: 3 })
			expect(sut.isCountValid).toBe(true)
		})

		it('rejects 0 and negatives', () => {
			expect(makeSut({ ticketCount: 0 }).isCountValid).toBe(false)
			expect(makeSut({ ticketCount: -1 }).isCountValid).toBe(false)
		})

		it('rejects counts above the phase max', () => {
			expect(makeSut({ ticketCount: 5 }).isCountValid).toBe(false)
		})

		it('rejects non-integers', () => {
			expect(makeSut({ ticketCount: 1.5 }).isCountValid).toBe(false)
		})

		it('computes the JPY total as price × count', () => {
			const sut = makeSut({ ticketCount: 3 })
			expect(sut.totalAmount).toBe(15000)
		})

		it('does not advance past count when invalid', () => {
			const sut = makeSut({ ticketCount: 9 })
			sut.toIdentity()
			expect(sut.step).toBe('count')
			expect(sut.error).not.toBe('')
		})
	})

	describe('identity required', () => {
		it('rejects blank name or phone', () => {
			expect(
				makeSut({ fullName: '', phoneNumber: '09012345678' }).isIdentityValid,
			).toBe(false)
			expect(
				makeSut({ fullName: '山田太郎', phoneNumber: '' }).isIdentityValid,
			).toBe(false)
		})

		it('rejects a malformed phone number', () => {
			expect(
				makeSut({ fullName: '山田太郎', phoneNumber: '123' }).isIdentityValid,
			).toBe(false)
		})

		it('accepts a well-formed identity (separators tolerated)', () => {
			expect(
				makeSut({ fullName: '山田太郎', phoneNumber: '090-1234-5678' })
					.isIdentityValid,
			).toBe(true)
		})

		it('does not create an authorization when identity is invalid', async () => {
			const sut = makeSut({
				step: 'identity',
				ticketCount: 2,
				fullName: '',
				phoneNumber: '',
			})
			await sut.toPayment()
			expect(mockLottery.createAuthorization).not.toHaveBeenCalled()
			expect(sut.step).toBe('identity')
		})
	})

	describe('createAuthorization → confirm → apply happy path', () => {
		it('creates the authorization and mounts the Payment Element', async () => {
			const sut = makeSut({
				step: 'identity',
				ticketCount: 2,
				fullName: '山田太郎',
				phoneNumber: '09012345678',
			})
			sut.paymentElementHost = document.createElement('div')

			await sut.toPayment()
			await flush()

			expect(mockLottery.createAuthorization).toHaveBeenCalledWith(
				'phase-1',
				2,
				expect.anything(),
			)
			expect(sut.paymentIntentRef).toBe('pi_ref_123')
			expect(mockStripe.createElements).toHaveBeenCalledWith('cs_test_123')
			expect(fakePaymentElement.mount).toHaveBeenCalledOnce()
			expect(sut.step).toBe('payment')
		})

		it('confirms the card hold and applies with the CONFIRMED intent id', async () => {
			const sut = makeSut({
				step: 'identity',
				ticketCount: 2,
				fullName: '山田太郎',
				phoneNumber: '09012345678',
			})
			sut.paymentElementHost = document.createElement('div')
			await sut.toPayment()
			await flush()

			await sut.confirmAndApply()

			expect(mockStripe.confirmAuthorization).toHaveBeenCalledOnce()
			expect(mockLottery.apply).toHaveBeenCalledWith(
				'phase-1',
				2,
				{ fullName: '山田太郎', phoneNumber: '09012345678' },
				'pi_confirmed_999',
				expect.anything(),
			)
			expect(sut.step).toBe('done')
			expect(sut.error).toBe('')
		})
	})

	describe('error surfacing', () => {
		it('surfaces a createAuthorization failure and stays on identity', async () => {
			mockLottery.createAuthorization.mockRejectedValueOnce(new Error('boom'))
			const sut = makeSut({
				step: 'identity',
				ticketCount: 1,
				fullName: '山田太郎',
				phoneNumber: '09012345678',
			})
			await sut.toPayment()
			expect(sut.error).not.toBe('')
			expect(sut.step).toBe('identity')
		})

		it('surfaces a Stripe confirm error and does NOT call apply', async () => {
			mockStripe.confirmAuthorization.mockResolvedValueOnce({
				errorMessage: 'カードが拒否されました',
			})
			const sut = makeSut({
				step: 'identity',
				ticketCount: 1,
				fullName: '山田太郎',
				phoneNumber: '09012345678',
			})
			sut.paymentElementHost = document.createElement('div')
			await sut.toPayment()
			await flush()

			await sut.confirmAndApply()

			expect(mockLottery.apply).not.toHaveBeenCalled()
			expect(sut.error).toBe('カードが拒否されました')
			expect(sut.step).toBe('payment')
		})

		it('surfaces an apply failure and returns to the payment step', async () => {
			mockLottery.apply.mockRejectedValueOnce(new Error('server rejected'))
			const sut = makeSut({
				step: 'identity',
				ticketCount: 1,
				fullName: '山田太郎',
				phoneNumber: '09012345678',
			})
			sut.paymentElementHost = document.createElement('div')
			await sut.toPayment()
			await flush()

			await sut.confirmAndApply()

			expect(sut.error).not.toBe('')
			expect(sut.step).toBe('payment')
		})
	})

	describe('stripe unavailable', () => {
		it('shows the unavailable step when no publishable key is configured', () => {
			mockStripe.isConfigured = false
			const sut = new LotteryApplyRoute()
			sut.loading({ phaseId: 'phase-1' })
			expect(sut.step).toBe('unavailable')
		})
	})

	describe('verification gate (5.2)', () => {
		beforeEach(() => {
			mockIdentity.getMyVerificationStatus.mockResolvedValue({
				level: 'unverified',
			})
		})

		it('parks an UNVERIFIED fan on verify-required when the phase requires it', async () => {
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1', verificationRequired: 'true' })
			expect(mockIdentity.getMyVerificationStatus).toHaveBeenCalledOnce()
			expect(sut.step).toBe('verify-required')
		})

		it('lets a VERIFIED fan straight into the count step', async () => {
			mockIdentity.getMyVerificationStatus.mockResolvedValueOnce({
				level: 'identityVerified',
			})
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1', verificationRequired: 'true' })
			expect(sut.step).toBe('count')
		})

		it('does NOT check status when the phase does not require verification', async () => {
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1' })
			expect(mockIdentity.getMyVerificationStatus).not.toHaveBeenCalled()
			expect(sut.step).toBe('count')
		})

		it('treats an explicit verificationRequired="false" as not-required (no status check, no gate)', async () => {
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1', verificationRequired: 'false' })
			expect(mockIdentity.getMyVerificationStatus).not.toHaveBeenCalled()
			expect(sut.step).toBe('count')
		})

		it('fails OPEN (proceeds to count) when the status load errors', async () => {
			mockIdentity.getMyVerificationStatus.mockRejectedValueOnce(
				new Error('UNAVAILABLE'),
			)
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1', verificationRequired: 'true' })
			expect(sut.step).toBe('count')
		})

		it('routes to Settings from the gate', async () => {
			const sut = new LotteryApplyRoute()
			await sut.loading({ phaseId: 'phase-1', verificationRequired: 'true' })
			await sut.goToVerify()
			expect(mockRouter.load).toHaveBeenCalledWith('/settings')
		})
	})
})
