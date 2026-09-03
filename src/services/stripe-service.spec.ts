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

import { StripeService } from './stripe-service'

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

	describe('confirmAuthorization', () => {
		it('returns the PaymentIntent id when the hold is in requires_capture', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_capture' },
				})),
			})

			const result = await new StripeService().confirmAuthorization(
				stripe,
				noopElements,
			)

			expect(result).toEqual({ paymentIntentId: 'pi_1' })
			expect(
				(stripe as unknown as { confirmPayment: ReturnType<typeof vi.fn> })
					.confirmPayment,
			).toHaveBeenCalledWith({
				elements: noopElements,
				redirect: 'if_required',
			})
		})

		it('rejects a confirmed intent that is NOT in requires_capture (not a valid hold)', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_action' },
				})),
			})

			const result = await new StripeService().confirmAuthorization(
				stripe,
				noopElements,
			)

			expect(result.paymentIntentId).toBeUndefined()
			expect(result.errorMessage).toBeTruthy()
		})

		it('surfaces the Stripe error message on a decline', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					error: { message: 'Your card was declined.', code: 'card_declined' },
				})),
			})

			const result = await new StripeService().confirmAuthorization(
				stripe,
				noopElements,
			)

			expect(result).toEqual({ errorMessage: 'Your card was declined.' })
		})

		it('falls back to a localized message when the Stripe error carries none', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({
					error: { code: 'processing_error' },
				})),
			})

			const result = await new StripeService().confirmAuthorization(
				stripe,
				noopElements,
			)

			expect(result.errorMessage).toBe(
				'カード認証に失敗しました。もう一度お試しください。',
			)
		})

		it('returns a localized message when neither an error nor a PaymentIntent id is present', async () => {
			const stripe = fakeStripe({
				confirmPayment: vi.fn(async () => ({})),
			})

			const result = await new StripeService().confirmAuthorization(
				stripe,
				noopElements,
			)

			expect(result.paymentIntentId).toBeUndefined()
			expect(result.errorMessage).toBeTruthy()
		})
	})
})
