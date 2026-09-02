// Import loadStripe from the `/pure` entry point: the default `@stripe/stripe-js`
// module eagerly injects js.stripe.com on import (for fraud signals), which loads
// it on every page and violates the app CSP on routes that never use Stripe.
// `/pure` defers the script injection until loadStripe() is actually called (the
// lottery apply flow), so home and other routes stay Stripe-free. The types are
// a type-only import (erased at build time — no runtime side effect).

import type { Stripe, StripeElements } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../config/app-config'

export const IStripeService = DI.createInterface<IStripeService>(
	'IStripeService',
	(x) => x.singleton(StripeService),
)

export interface IStripeService extends StripeService {}

/**
 * Result of confirming a card authorization (manual-capture PaymentIntent)
 * with Stripe Elements. On success, `paymentIntentId` is the confirmed
 * `pi_…` reference that Apply carries. On failure, `errorMessage` holds the
 * localized (Stripe-provided) reason.
 */
export interface ConfirmAuthorizationResult {
	readonly paymentIntentId?: string
	readonly errorMessage?: string
}

/**
 * Card brands accepted by the lottery flow. American Express is deliberately
 * excluded: its authorization cannot be held to the draw, so the server
 * rejects it and Elements is constrained to hide it (task 6.3). JCB / Diners /
 * Discover are only usable for JPY, which the phase always is.
 */
export const ACCEPTED_CARD_BRANDS = [
	'visa',
	'mastercard',
	'jcb',
	'diners',
	'discover',
] as const

/**
 * Thin injectable wrapper around Stripe.js. Owns SDK loading (keyed on the
 * runtime `stripePublishableKey` — never a hardcoded key) and the
 * mount → confirm handshake for the lottery card-authorization flow, so the
 * apply viewmodel depends on this narrow surface and unit tests can mock it
 * without touching the live Stripe API.
 */
export class StripeService {
	private readonly logger = resolve(ILogger).scopeTo('StripeService')
	private readonly config = resolve(IAppConfig)
	private stripePromise: Promise<Stripe | null> | null = null

	/**
	 * True when a publishable key is configured for this environment. The apply
	 * flow renders a "payment unavailable" state when this is false rather than
	 * attempting to load Stripe.
	 */
	public get isConfigured(): boolean {
		return Boolean(this.config.stripePublishableKey)
	}

	/**
	 * Loads (once) and returns the Stripe instance. Returns null when no
	 * publishable key is configured or Stripe.js fails to load.
	 */
	public async getStripe(): Promise<Stripe | null> {
		const key = this.config.stripePublishableKey
		if (!key) {
			this.logger.warn('Stripe publishable key not configured')
			return null
		}
		if (!this.stripePromise) {
			// Do NOT cache a rejected load: a transient js.stripe.com failure
			// (network blip, ad-blocker, momentary CSP issue) would otherwise be
			// memoized for the whole session, forcing a full page reload to recover.
			// Reset the cache on failure so a later attempt can retry.
			this.stripePromise = loadStripe(key).catch((err: unknown) => {
				this.stripePromise = null
				this.logger.warn('Stripe.js failed to load', { error: err })
				return null
			})
		}
		return this.stripePromise
	}

	/**
	 * Creates a Stripe Elements group bound to the authorization's client
	 * secret. The caller mounts a Payment Element from the returned group into
	 * the DOM. Returns null when Stripe is unavailable.
	 */
	public async createElements(
		clientSecret: string,
	): Promise<{ stripe: Stripe; elements: StripeElements } | null> {
		const stripe = await this.getStripe()
		if (!stripe) return null
		const elements = stripe.elements({ clientSecret })
		return { stripe, elements }
	}

	/**
	 * Confirms the manual-capture PaymentIntent (the card hold) with the mounted
	 * Elements, completing 3DS in-place when required. `redirect: 'if_required'`
	 * keeps the fan on-page for card payments; only a redirect-based method (not
	 * offered here) would navigate away. Returns the confirmed PaymentIntent id
	 * on success, or a localized error message on failure.
	 */
	public async confirmAuthorization(
		stripe: Stripe,
		elements: StripeElements,
	): Promise<ConfirmAuthorizationResult> {
		const { paymentIntent, error } = await stripe.confirmPayment({
			elements,
			redirect: 'if_required',
		})
		if (error) {
			this.logger.warn('Card authorization confirmation failed', {
				code: error.code,
			})
			return {
				errorMessage:
					error.message ?? 'カード認証に失敗しました。もう一度お試しください。',
			}
		}
		if (!paymentIntent?.id) {
			return {
				errorMessage:
					'カード認証を確認できませんでした。もう一度お試しください。',
			}
		}
		// A successfully-held manual-capture authorization is in `requires_capture`.
		// Any other status (e.g. requires_action / requires_payment_method /
		// processing) means the card is NOT authorized yet, so it must not be
		// passed to Apply as if it were a valid hold.
		if (paymentIntent.status !== 'requires_capture') {
			this.logger.warn('PaymentIntent not in requires_capture after confirm', {
				status: paymentIntent.status,
			})
			return {
				errorMessage:
					'カード認証が完了しませんでした。もう一度お試しください。',
			}
		}
		return { paymentIntentId: paymentIntent.id }
	}
}
