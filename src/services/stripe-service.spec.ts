import type { Stripe, StripeElements } from '@stripe/stripe-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

// loadStripe from the `/pure` entry point is the SDK loader the service wraps.
// It is mocked so no js.stripe.com script is injected and each test controls
// whether the load resolves or rejects. vi.hoisted keeps the fn initialized
// before the hoisted vi.mock factory runs (avoids a TDZ error).
const { loadStripe } = vi.hoisted(() => ({ loadStripe: vi.fn() }))
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe }))

const scopedLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
}
const mockLogger = { scopeTo: () => scopedLogger }
const mockConfig = { stripePublishableKey: 'pk_test_x' as string }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAppConfig: mockConfig,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { paymentErrorKey, StripeService } from './stripe-service'

// A fake Stripe whose confirmPayment returns the given result, cast to the SDK
// type (the test only touches confirmPayment / elements).
function fakeStripe(overrides: Partial<Record<string, unknown>>): Stripe {
	return overrides as unknown as Stripe
}

const noopElements = {} as unknown as StripeElements

describe('StripeService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockConfig.stripePublishableKey = 'pk_test_x'
	})

	describe('isConfigured', () => {
		it('reflects whether a publishable key is configured', () => {
			mockConfig.stripePublishableKey = 'pk_test_x'
			expect(new StripeService().isConfigured).toBe(true)

			mockConfig.stripePublishableKey = ''
			expect(new StripeService().isConfigured).toBe(false)
		})
	})

	describe('getStripe', () => {
		it('returns null and does not load the SDK when no key is configured', async () => {
			mockConfig.stripePublishableKey = ''
			const svc = new StripeService()

			expect(await svc.getStripe()).toBeNull()
			expect(loadStripe).not.toHaveBeenCalled()
			expect(scopedLogger.warn).toHaveBeenCalled()
		})

		it('loads the SDK once and caches the instance across calls', async () => {
			const stripe = fakeStripe({ id: 'stripe' })
			loadStripe.mockResolvedValue(stripe)
			const svc = new StripeService()

			const first = await svc.getStripe()
			const second = await svc.getStripe()

			expect(first).toBe(stripe)
			expect(second).toBe(stripe)
			expect(loadStripe).toHaveBeenCalledTimes(1)
			expect(loadStripe).toHaveBeenCalledWith('pk_test_x')
		})

		it('does NOT cache a rejected load — a later call retries and can succeed', async () => {
			const svc = new StripeService()

			loadStripe.mockRejectedValueOnce(new Error('js.stripe.com blocked'))
			const firstAttempt = await svc.getStripe()
			expect(firstAttempt).toBeNull()
			expect(scopedLogger.warn).toHaveBeenCalledWith(
				'Stripe.js failed to load',
				expect.anything(),
			)

			const stripe = fakeStripe({ id: 'stripe' })
			loadStripe.mockResolvedValueOnce(stripe)
			const secondAttempt = await svc.getStripe()

			expect(secondAttempt).toBe(stripe)
			// Retried rather than memoizing the rejection: loaded twice total.
			expect(loadStripe).toHaveBeenCalledTimes(2)
		})
	})

	describe('createElements', () => {
		it('builds an Elements group bound to the client secret when Stripe is available', async () => {
			const elements = { create: vi.fn() } as unknown as StripeElements
			const stripe = fakeStripe({ elements: vi.fn(() => elements) })
			loadStripe.mockResolvedValue(stripe)

			const result = await new StripeService().createElements('cs_test_1')

			expect(result).toEqual({ stripe, elements })
			expect(
				(stripe as unknown as { elements: ReturnType<typeof vi.fn> }).elements,
			).toHaveBeenCalledWith({ clientSecret: 'cs_test_1' })
		})

		it('returns null when Stripe is unavailable', async () => {
			mockConfig.stripePublishableKey = ''

			expect(await new StripeService().createElements('cs_test_1')).toBeNull()
		})
	})

	describe('confirmCardAuthorization', () => {
		it('returns the card authorization id when it is in requires_capture', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_capture' },
				})),
			})

			const result = await new StripeService().confirmCardAuthorization(
				stripe,
				noopElements,
			)

			expect(result).toEqual({ cardAuthorizationId: 'pi_1' })
			expect(
				(stripe as unknown as { confirmPayment: ReturnType<typeof vi.fn> })
					.confirmPayment,
			).toHaveBeenCalledWith({
				elements: noopElements,
				redirect: 'if_required',
			})
		})

		it('rejects a confirmed intent that is NOT in requires_capture (not a valid card authorization)', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_action' },
				})),
			})

			const result = await new StripeService().confirmCardAuthorization(
				stripe,
				noopElements,
			)

			expect(result.cardAuthorizationId).toBeUndefined()
			expect(result.errorKey).toBe('payment.error.failed')
		})

		it('gives the declined key on a card_error, never the Stripe message, and logs type and code', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					error: {
						type: 'card_error',
						code: 'card_declined',
						decline_code: 'insufficient_funds',
						message: 'Your card has insufficient funds.',
					},
				})),
			})

			const result = await new StripeService().confirmCardAuthorization(
				stripe,
				noopElements,
			)

			expect(result).toEqual({ errorKey: 'payment.error.declined' })
			expect(scopedLogger.warn).toHaveBeenCalledWith(
				'Card authorization confirmation failed',
				{
					type: 'card_error',
					code: 'card_declined',
					declineCode: 'insufficient_funds',
				},
			)
		})

		it('gives the failed key for any other error type', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					error: { type: 'api_error', code: 'processing_error' },
				})),
			})

			const result = await new StripeService().confirmCardAuthorization(
				stripe,
				noopElements,
			)

			expect(result).toEqual({ errorKey: 'payment.error.failed' })
		})

		it('returns a localized message when neither an error nor a card authorization id is present', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({})),
			})

			const result = await new StripeService().confirmCardAuthorization(
				stripe,
				noopElements,
			)

			expect(result.cardAuthorizationId).toBeUndefined()
			expect(result.errorKey).toBe('payment.error.failed')
		})
	})

	describe('createCheckoutCard', () => {
		it('gives the card details key when the card form refuses to submit', async () => {
			const elements = {
				submit: vi.fn(async () => ({
					error: {
						type: 'validation_error',
						code: 'incomplete_number',
						message: 'Your card number is incomplete.',
					},
				})),
			} as unknown as StripeElements

			const result = await new StripeService().createCheckoutCard(
				fakeStripe({}),
				elements,
			)

			expect(result).toEqual({ errorKey: 'payment.error.cardDetails' })
		})

		it('gives the failed key when the ConfirmationToken cannot be created', async () => {
			const elements = {
				submit: vi.fn(async () => ({})),
			} as unknown as StripeElements
			const stripe = fakeStripe({
				createConfirmationToken: vi.fn(async () => ({
					error: { type: 'api_connection_error', message: 'Network error' },
				})),
			})

			const result = await new StripeService().createCheckoutCard(
				stripe,
				elements,
			)

			expect(result).toEqual({ errorKey: 'payment.error.failed' })
		})
	})

	describe('confirmCheckoutCardAuthorization', () => {
		it('gives the declined key when the issuer declines', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					error: {
						type: 'card_error',
						code: 'card_declined',
						message: 'Your card has insufficient funds.',
					},
				})),
			})

			const result = await new StripeService().confirmCheckoutCardAuthorization(
				stripe,
				'cs_1',
				'ctoken_1',
			)

			expect(result).toEqual({ errorKey: 'payment.error.declined' })
		})

		it('gives the failed key when the authorization is not in requires_capture', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_action' },
				})),
			})

			const result = await new StripeService().confirmCheckoutCardAuthorization(
				stripe,
				'cs_1',
				'ctoken_1',
			)

			expect(result).toEqual({ errorKey: 'payment.error.failed' })
		})
	})

	describe('paymentErrorKey', () => {
		it('chooses the key by the error type only', () => {
			expect(paymentErrorKey({ type: 'validation_error' })).toBe(
				'payment.error.cardDetails',
			)
			expect(paymentErrorKey({ type: 'card_error' })).toBe(
				'payment.error.declined',
			)
			expect(paymentErrorKey({ type: 'invalid_request_error' })).toBe(
				'payment.error.failed',
			)
			expect(paymentErrorKey(undefined)).toBe('payment.error.failed')
		})
	})
})
