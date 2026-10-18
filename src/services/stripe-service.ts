// Import loadStripe from the `/pure` entry point: the default `@stripe/stripe-js`
// module eagerly injects js.stripe.com on import (for fraud signals), which loads
// it on every page and violates the app CSP on routes that never use Stripe.
// `/pure` defers the script injection until loadStripe() is actually called (the
// lottery apply flow), so home and other routes stay Stripe-free. The types are
// a type-only import (erased at build time — no runtime side effect).

import type { Stripe, StripeElements, StripeError } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../config/app-config'

export const IStripeService = DI.createInterface<IStripeService>(
	'IStripeService',
	(x) => x.singleton(StripeService),
)

export interface IStripeService extends StripeService {}

/**
 * Catalog key of the copy for a card payment failure, by its kind only: the
 * card details are incomplete or invalid, the card was declined or could not
 * be authenticated, anything else. The payment form's own message is never
 * shown: it follows the browser's language rather than the fan's and is text
 * the app does not own (the card form shows its field errors in its frame).
 */
export type PaymentErrorKey =
	| 'payment.error.cardDetails'
	| 'payment.error.declined'
	| 'payment.error.failed'

/**
 * Maps a Stripe.js error to its {@link PaymentErrorKey} by its `type`:
 * `validation_error` (the card details), `card_error` (declines and failed
 * issuer authentication), anything else or no error.
 */
export function paymentErrorKey(
	error: Pick<StripeError, 'type'> | undefined,
): PaymentErrorKey {
	switch (error?.type) {
		case 'validation_error':
			return 'payment.error.cardDetails'
		case 'card_error':
			return 'payment.error.declined'
		default:
			return 'payment.error.failed'
	}
}

/**
 * Result of confirming a card authorization (manual-capture PaymentIntent)
 * with Stripe Elements. On success, `cardAuthorizationId` is the confirmed
 * card authorization's id (Stripe's `pi_…`). On failure, `errorKey` is the
 * catalog key of the copy to show.
 */
export interface ConfirmCardAuthorizationResult {
	readonly cardAuthorizationId?: string
	readonly errorKey?: PaymentErrorKey
}

/**
 * The card a fan entered for a checkout, read from the ConfirmationToken
 * before anything is charged, so the 特商法 final confirmation can name it.
 */
export interface CheckoutCard {
	/** The ConfirmationToken that confirms the checkout's card authorization. */
	readonly tokenId: string
	/** The card brand as Stripe names it, e.g. `visa`, `jcb`, `amex`. */
	readonly brand: string
	/** The card's last four digits. */
	readonly last4: string
	/** `apple_pay` or `google_pay` when a card wallet was used. */
	readonly wallet?: string
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
	 * Creates a Stripe Elements group bound to the card authorization's secret
	 * (Stripe's client secret). The caller mounts a Payment Element from the returned group into
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
	 * Creates an Elements group for a first-come checkout before its card
	 * authorization exists (deferred intent): the amount and manual capture
	 * match the PaymentIntent the server opens at AuthorizeCard. Every card brand is
	 * accepted. Returns null when Stripe is unavailable.
	 */
	public async createCheckoutElements(
		amountYen: number,
	): Promise<{ stripe: Stripe; elements: StripeElements } | null> {
		const stripe = await this.getStripe()
		if (!stripe) return null
		const elements = stripe.elements({
			mode: 'payment',
			amount: amountYen,
			currency: 'jpy',
			captureMethod: 'manual',
		})
		return { stripe, elements }
	}

	/**
	 * Validates the card form and turns it into a ConfirmationToken, which
	 * carries the brand and last four digits shown before the order is placed.
	 * Nothing is charged or authorized yet.
	 */
	public async createCheckoutCard(
		stripe: Stripe,
		elements: StripeElements,
	): Promise<{ card?: CheckoutCard; errorKey?: PaymentErrorKey }> {
		const submitted = await elements.submit()
		if (submitted.error) {
			this.logger.warn('Card form submit failed', {
				type: submitted.error.type,
				code: submitted.error.code,
			})
			return { errorKey: paymentErrorKey(submitted.error) }
		}
		const { confirmationToken, error } = await stripe.createConfirmationToken({
			elements,
		})
		if (error || !confirmationToken) {
			this.logger.warn('Confirmation token creation failed', {
				type: error?.type,
				code: error?.code,
			})
			return { errorKey: paymentErrorKey(error) }
		}
		const card = confirmationToken.payment_method_preview.card
		return {
			card: {
				tokenId: confirmationToken.id,
				brand: card?.brand ?? '',
				last4: card?.last4 ?? '',
				wallet: card?.wallet?.type ?? undefined,
			},
		}
	}

	/**
	 * Confirms a checkout's card authorization with the card's
	 * ConfirmationToken, completing the issuer's authentication (3D Secure) in
	 * the page. Succeeds only when the card is authorized (`requires_capture`).
	 */
	public async confirmCheckoutCardAuthorization(
		stripe: Stripe,
		clientSecret: string,
		tokenId: string,
	): Promise<{ errorKey?: PaymentErrorKey }> {
		const { paymentIntent, error } = await stripe.confirmPayment({
			clientSecret,
			confirmParams: { confirmation_token: tokenId },
			redirect: 'if_required',
		})
		if (error) {
			this.logger.warn('Checkout card authorization confirmation failed', {
				type: error.type,
				code: error.code,
				declineCode: error.decline_code,
			})
			return { errorKey: paymentErrorKey(error) }
		}
		if (paymentIntent?.status !== 'requires_capture') {
			this.logger.warn(
				'Checkout card authorization not in requires_capture after confirm',
				{ status: paymentIntent?.status },
			)
			return { errorKey: 'payment.error.failed' }
		}
		return {}
	}

	/**
	 * Confirms the manual-capture PaymentIntent (the card authorization) with the
	 * mounted Elements, completing 3DS in-place when required.
	 * `redirect: 'if_required'` keeps the fan on-page for card payments; only a
	 * redirect-based method (not offered here) would navigate away. Returns the
	 * confirmed card authorization's id on success, or the catalog key of the
	 * failure copy.
	 */
	public async confirmCardAuthorization(
		stripe: Stripe,
		elements: StripeElements,
	): Promise<ConfirmCardAuthorizationResult> {
		const { paymentIntent, error } = await stripe.confirmPayment({
			elements,
			redirect: 'if_required',
		})
		if (error) {
			this.logger.warn('Card authorization confirmation failed', {
				type: error.type,
				code: error.code,
				declineCode: error.decline_code,
			})
			return { errorKey: paymentErrorKey(error) }
		}
		if (!paymentIntent?.id) {
			this.logger.warn('Card authorization confirmed without a PaymentIntent')
			return { errorKey: 'payment.error.failed' }
		}
		// A successfully confirmed manual-capture authorization is in `requires_capture`.
		// Any other status (e.g. requires_action / requires_payment_method /
		// processing) means the card is NOT authorized yet, so it must not be
		// passed to Confirm as if it were a valid card authorization.
		if (paymentIntent.status !== 'requires_capture') {
			this.logger.warn('PaymentIntent not in requires_capture after confirm', {
				status: paymentIntent.status,
			})
			return { errorKey: 'payment.error.failed' }
		}
		return { cardAuthorizationId: paymentIntent.id }
	}
}
