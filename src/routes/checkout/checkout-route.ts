import { IRouter, type IRouteViewModel, type Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
	Stripe,
	StripeElements,
	StripePaymentElement,
} from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import { ICheckoutRpcClient } from '../../adapter/rpc/client/checkout-client'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import {
	clearCheckoutId,
	loadCheckoutId,
	saveCheckoutId,
} from '../../adapter/storage/checkout-storage'
import type { Checkout } from '../../entities/checkout'
import { isVerified } from '../../entities/identity-verification'
import {
	currentSale,
	isBuyable,
	type TicketSale,
	type VerificationRequirement,
} from '../../entities/ticket-sale'
import { toDomesticDisplay, toE164 } from '../../lib/to-e164'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'
import { IPwaInstallService } from '../../services/pwa-install-service'
import {
	type CheckoutCard,
	IStripeService,
} from '../../services/stripe-service'
import { IUserStore } from '../../services/user-store'
import {
	type EventPageEvent,
	eventFromConcert,
	formatEventDate,
	formatEventTime,
	formatSaleStart,
} from '../event/event-page'
import {
	type BusinessDetails,
	businessDetailsFromConcert,
} from './business-details'

/**
 * - `loading`: the event and its sale are read, and a held checkout resumed.
 * - `unavailable`: card payments are not configured in this environment.
 * - `not-found`: the event has no first-come sale (none, or cancelled).
 * - `verify-required`: the sale requires a verification the fan lacks; the
 *   screen offers to verify instead of starting the checkout.
 * - `count` → `personal-details` → `payment` → `confirm`: the checkout's steps.
 * - `done`: the order was placed.
 * - `outcome`: placing the order failed; the screen says what happened.
 */
export type CheckoutStep =
	| 'loading'
	| 'unavailable'
	| 'not-found'
	| 'verify-required'
	| 'count'
	| 'personal-details'
	| 'payment'
	| 'confirm'
	| 'done'
	| 'outcome'

/** What became of a checkout whose order could not be placed. */
export type CheckoutOutcome =
	| 'hold-ended'
	| 'charge-failed'
	| 'replaced'
	| 'authentication-incomplete'
	| 'completing'

/** An i18n key with its parameters, shown as the step's message. */
export interface CheckoutMessage {
	readonly key: string
	readonly params?: Record<string, string | number>
}

/**
 * The fan's checkout of the TicketType of an event's first-come sale
 * (`/events/:id/checkout`):
 * choose the count and hold the tickets for 15 minutes, confirm the personal
 * details, authorize the card, review the 特商法 final confirmation, and place
 * the order. Reopening the page during the hold resumes the same checkout.
 */
export class CheckoutRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('CheckoutRoute')
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private readonly checkoutClient = resolve(ICheckoutRpcClient)
	private readonly stripe = resolve(IStripeService)
	private readonly userStore = resolve(IUserStore)
	private readonly pushService = resolve(IPushService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly identityVerifications = resolve(IIdentityVerificationService)
	private readonly router = resolve(IRouter)

	public step: CheckoutStep = 'loading'
	public event: EventPageEvent | null = null
	/** The Organizer's 特商法 business details, for the final confirmation. */
	public businessDetails: BusinessDetails | null = null
	/** The event's first-come sale, with its TicketType for the event. */
	public sale: TicketSale | null = null
	public checkout: Checkout | null = null

	public ticketCount = 1
	public fullName = ''
	public phoneNumber = ''
	/** The card that was authorized, once authorized. */
	public card: CheckoutCard | null = null

	/** The current step's message, or null. */
	public message: CheckoutMessage | null = null
	/** A message from the card issuer or Stripe, shown as given. */
	public cardError = ''
	public outcome: CheckoutOutcome | null = null

	/** True while a request of the current step is in flight. */
	public busy = false
	/** The DOM node the Payment Element mounts into (captured via `ref`). */
	public paymentElementHost?: HTMLElement

	/** The current time, ticking every second while a hold lasts. */
	public now = Date.now()

	private eventId = ''
	private cardAuthorizationSecret = ''
	private abortController: AbortController | null = null
	private timer: ReturnType<typeof setInterval> | null = null
	private stripeHandles: { stripe: Stripe; elements: StripeElements } | null =
		null
	private paymentElement: StripePaymentElement | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
		// Never hold the view swap on data: start the reads and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.stopCountdown()
		this.destroyPaymentElement()
	}

	private get signal(): AbortSignal | undefined {
		return this.abortController?.signal
	}

	/** Read the event and its sale, then resume a held checkout. */
	public async load(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		const { signal } = this.abortController
		this.step = 'loading'

		if (!this.stripe.isConfigured) {
			this.step = 'unavailable'
			return
		}
		try {
			const [concert, sales] = await Promise.all([
				this.concertClient.get(this.eventId, signal),
				this.saleClient.listByEvent(this.eventId, signal),
			])
			if (signal.aborted) return
			this.event = eventFromConcert(concert)
			this.businessDetails = businessDetailsFromConcert(concert)
			this.sale = firstComeSale(sales)
		} catch (err) {
			if (signal.aborted) return
			if (ConnectError.from(err).code !== Code.NotFound) {
				this.logger.warn('Checkout read failed', {
					eventId: this.eventId,
					error: err,
				})
			}
			this.step = 'not-found'
			return
		}
		if (!this.event || !this.sale || this.event.cancelled) {
			this.step = 'not-found'
			return
		}
		this.prefillPersonalDetails()
		if (await this.resume(signal)) return
		if (signal.aborted) return
		// A held checkout passed the server's verification check at Start, so
		// only a new one is gated on the fan's IdentityVerification.
		if (await this.lacksVerification(signal)) {
			if (!signal.aborted) this.step = 'verify-required'
			return
		}
		if (signal.aborted) return
		this.step = 'count'
	}

	/**
	 * True when the sale requires a verification the fan does not have: no
	 * Active IdentityVerification, or, on a JPKI-only sale, an Active one by
	 * another method.
	 * On a status-read failure the checkout proceeds: the server checks the
	 * requirement at Start, so it is never bypassed, only surfaced later.
	 */
	private async lacksVerification(signal?: AbortSignal): Promise<boolean> {
		const requirement = this.verificationRequirement
		if (requirement === 'none') return false
		try {
			const identityVerification = await this.identityVerifications.get(signal)
			if (!isVerified(identityVerification)) return true
			return (
				requirement === 'jpkiOnly' && identityVerification?.method !== 'jpki'
			)
		} catch (err) {
			if (!signal?.aborted) {
				this.logger.warn('Verification status read failed; proceeding', {
					error: err,
				})
			}
			return false
		}
	}

	/** Prefill the full name and phone number saved on the fan's User. */
	private prefillPersonalDetails(): void {
		const user = this.userStore.current
		if (user?.fullName) this.fullName = user.fullName
		if (user?.phoneNumber) {
			this.phoneNumber = toDomesticDisplay(user.phoneNumber)
		}
	}

	/**
	 * Resume the checkout the fan left during its hold, with the same count
	 * and countdown. Returns false, forgetting it, when there is none to resume.
	 */
	private async resume(signal: AbortSignal): Promise<boolean> {
		const id = loadCheckoutId(this.eventId)
		if (!id) return false
		try {
			const checkout = await this.checkoutClient.get(id, signal)
			if (signal.aborted) return true
			if (
				checkout.status === 'held' &&
				checkout.ticketTypeId === this.sale?.ticketType.id
			) {
				this.holdWith(checkout)
				this.step = 'personal-details'
				return true
			}
		} catch (err) {
			if (signal.aborted) return true
			this.logger.warn('Checkout resume failed', { error: err })
		}
		clearCheckoutId(this.eventId)
		return false
	}

	// ── Derived view ──────────────────────────────────────────────────────────

	/** Which verification the sale requires before the fan checks out. */
	public get verificationRequirement(): VerificationRequirement {
		return this.sale?.verificationRequirement ?? 'none'
	}

	/**
	 * The i18n key saying which verification the sale requires, or null
	 * when it requires none.
	 */
	public get verificationNoteKey(): string | null {
		switch (this.verificationRequirement) {
			case 'jpkiOnly':
				return 'checkout.verify.noteJpki'
			case 'verifiedAny':
				return 'checkout.verify.noteAny'
			default:
				return null
		}
	}

	public get perAccountLimit(): number {
		return this.sale?.ticketType.perAccountLimit ?? 1
	}

	/** The counts a fan may pick, 1 to the per-account limit. */
	public get countOptions(): number[] {
		return Array.from({ length: this.perAccountLimit }, (_, i) => i + 1)
	}

	public get price(): number {
		return this.sale?.ticketType.price ?? 0
	}

	/** The total to pay: the held amount once held, else price × count. */
	public get total(): number {
		return this.checkout?.amount ?? this.price * this.ticketCount
	}

	/** A yen amount with thousands separators, e.g. "6,000". */
	public yen(amount: number): string {
		return amount.toLocaleString('ja-JP')
	}

	/** Seconds left on the hold, never below 0. */
	public get secondsLeft(): number {
		if (!this.checkout) return 0
		const ms = this.checkout.holdExpireTime.getTime() - this.now
		return Math.max(0, Math.ceil(ms / 1000))
	}

	/** The hold's countdown as "m:ss". */
	public get countdown(): string {
		const s = this.secondsLeft
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
	}

	public get phoneE164(): string | null {
		return toE164(this.phoneNumber)
	}

	public get isPhoneInvalid(): boolean {
		return this.phoneNumber.trim().length > 0 && this.phoneE164 === null
	}

	public get isPersonalDetailsValid(): boolean {
		return this.fullName.trim().length > 0 && this.phoneE164 !== null
	}

	/**
	 * Authorize the card (`CheckoutService.AuthorizeCard`) with the full name
	 * and phone number, which the server saves on the fan's User; keep the
	 * User in step so the next screen prefills them. Returns the card
	 * authorization secret.
	 */
	private async requestCardAuthorization(checkoutId: string): Promise<string> {
		const fullName = this.fullName.trim()
		const phoneNumber = this.phoneE164 ?? ''
		const secret = await this.checkoutClient.authorizeCard(
			checkoutId,
			fullName,
			phoneNumber,
			this.signal,
		)
		const user = this.userStore.current
		if (user) this.userStore.current = { ...user, fullName, phoneNumber }
		return secret
	}

	private get lang(): string {
		return this.userStore.currentLanguage
	}

	public get dateLabel(): string {
		return this.event ? formatEventDate(this.event, this.lang) : ''
	}

	public get openTimeLabel(): string {
		return this.event?.openTime ? formatEventTime(this.event.openTime) : ''
	}

	public get startTimeLabel(): string {
		return this.event?.startTime ? formatEventTime(this.event.startTime) : ''
	}

	public get salePeriodLabel(): string {
		if (!this.sale) return ''
		return `${formatSaleStart(this.sale.saleStartTime, this.lang)} – ${formatSaleStart(this.sale.saleEndTime, this.lang)}`
	}

	/** The card as the final confirmation names it, e.g. "VISA •••• 4242". */
	public get cardLabel(): string {
		if (!this.card) return ''
		return `${this.card.brand.toUpperCase()} •••• ${this.card.last4}`
	}

	public get canAllowNotifications(): boolean {
		return this.notificationManager.permission !== 'granted'
	}

	public get canInstallApp(): boolean {
		return this.pwaInstall.canShowInstallOption
	}

	// ── Step 1: count and hold ────────────────────────────────────────────────

	/** Hold the chosen count for 15 minutes and continue to the 本人確認 step. */
	public async hold(): Promise<void> {
		if (this.busy || !this.sale) return
		this.busy = true
		this.message = null
		try {
			const checkout = await this.checkoutClient.start(
				this.sale.ticketType.id,
				this.ticketCount,
				this.signal,
			)
			// A new count means a new hold and a new amount: the card is
			// authorized again for it.
			if (checkout.id !== this.checkout?.id) this.forgetCard()
			this.holdWith(checkout)
			saveCheckoutId(this.eventId, checkout.id)
			this.step = 'personal-details'
		} catch (err) {
			if (this.signal?.aborted) return
			await this.explainHoldFailure(err)
		} finally {
			this.busy = false
		}
	}

	private holdWith(checkout: Checkout): void {
		this.checkout = checkout
		this.ticketCount = checkout.ticketCount
		this.startCountdown()
	}

	/** Say why the tickets could not be held. */
	private async explainHoldFailure(err: unknown): Promise<void> {
		const code = ConnectError.from(err).code
		if (code === Code.ResourceExhausted) {
			this.message = { key: 'checkout.count.allHeld' }
			return
		}
		if (
			code === Code.FailedPrecondition &&
			(await this.lacksVerification(this.signal))
		) {
			// The fan's IdentityVerification does not meet the sale's requirement (none, or it
			// is no longer Active): that, not a limit, is why Start failed.
			if (this.signal?.aborted) return
			this.message = null
			this.step = 'verify-required'
			return
		}
		if (code === Code.FailedPrecondition || code === Code.InvalidArgument) {
			// The sale may have ended, sold out or been cancelled since the page
			// opened; otherwise the per-account limit was reached.
			const saleId = this.sale?.id
			const sale = await this.saleClient
				.listByEvent(this.eventId, this.signal)
				.then((sales) => sales.find((s) => s.id === saleId) ?? null)
				.catch(() => this.sale)
			if (!sale) {
				this.message = { key: 'checkout.count.cancelled' }
			} else if (!isBuyable(sale.ticketType)) {
				this.sale = sale
				this.message = {
					key:
						sale.ticketType.state === 'soldOut'
							? 'checkout.count.soldOut'
							: 'checkout.count.ended',
				}
			} else {
				this.message = {
					key: 'checkout.count.limit',
					params: { limit: sale.ticketType.perAccountLimit },
				}
			}
			return
		}
		this.logger.error('Start failed', { error: err })
		this.message = { key: 'checkout.error.retry' }
	}

	/** From the verification gate: verification lives on the Settings screen. */
	public async goToVerify(): Promise<void> {
		await this.router.load('/settings')
	}

	// ── Step 2: personal details (本人確認) ───────────────────────────────────────────────────────

	/**
	 * Continue from the personal details step: to the card form, or, when the
	 * card is already authorized (the fan came back to correct the details),
	 * record the corrected details on the same card authorization and return to
	 * the final confirmation.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isPersonalDetailsValid || this.busy || !this.checkout) return
		this.message = null
		if (this.card) {
			await this.reauthorizeCard()
			return
		}
		this.busy = true
		try {
			this.stripeHandles = await this.stripe.createCheckoutElements(this.total)
			if (!this.stripeHandles) {
				this.message = { key: 'checkout.error.payment' }
				return
			}
			this.step = 'payment'
			// The mount host exists only once the payment step is rendered.
			queueMicrotask(() => this.mountPaymentElement())
		} finally {
			this.busy = false
		}
	}

	private async reauthorizeCard(): Promise<void> {
		if (!this.checkout) return
		this.busy = true
		try {
			await this.requestCardAuthorization(this.checkout.id)
			this.step = 'confirm'
		} catch (err) {
			if (this.signal?.aborted) return
			this.explainAuthorizeCardFailure(err)
		} finally {
			this.busy = false
		}
	}

	public backToCount(): void {
		this.message = null
		this.step = 'count'
	}

	// ── Step 3: card ──────────────────────────────────────────────────────────

	private mountPaymentElement(): void {
		if (this.signal?.aborted) return
		if (!this.stripeHandles || !this.paymentElementHost) return
		if (this.paymentElementHost.childElementCount > 0) return
		this.paymentElement = this.stripeHandles.elements.create('payment')
		this.paymentElement.mount(this.paymentElementHost)
	}

	private destroyPaymentElement(): void {
		this.paymentElement?.destroy()
		this.paymentElement = null
		this.stripeHandles = null
	}

	/**
	 * Authorize the card: read it into a ConfirmationToken, record the personal
	 * details and open the card authorization, then complete the issuer's
	 * authentication in the page. Nothing is charged until the order is placed.
	 */
	public async authorizeCard(): Promise<void> {
		if (this.busy || !this.stripeHandles || !this.checkout) return
		this.busy = true
		this.message = null
		this.cardError = ''
		try {
			const { stripe, elements } = this.stripeHandles
			const read = await this.stripe.createCheckoutCard(stripe, elements)
			if (!read.card) {
				this.cardError = read.errorMessage ?? ''
				return
			}
			this.cardAuthorizationSecret = await this.requestCardAuthorization(
				this.checkout.id,
			)
			const confirmed = await this.stripe.confirmCheckoutCardAuthorization(
				stripe,
				this.cardAuthorizationSecret,
				read.card.tokenId,
			)
			if (confirmed.errorMessage) {
				// The fan may try another card on the same checkout.
				this.cardError = confirmed.errorMessage
				return
			}
			this.card = read.card
			this.step = 'confirm'
		} catch (err) {
			if (this.signal?.aborted) return
			this.explainAuthorizeCardFailure(err)
		} finally {
			this.busy = false
		}
	}

	private explainAuthorizeCardFailure(err: unknown): void {
		if (ConnectError.from(err).code === Code.FailedPrecondition) {
			// The hold ended: the fan starts again.
			this.message = { key: 'checkout.payment.holdEnded' }
			return
		}
		this.logger.error('AuthorizeCard failed', { error: err })
		this.message = { key: 'checkout.error.retry' }
	}

	private forgetCard(): void {
		this.card = null
		this.cardAuthorizationSecret = ''
		this.destroyPaymentElement()
	}

	// ── Step 4: 特商法 final confirmation ───────────────────────────────────────

	public changeCount(): void {
		this.message = null
		this.step = 'count'
	}

	public changePersonalDetails(): void {
		this.message = null
		this.step = 'personal-details'
	}

	/** Place the order once; on failure, say what became of the checkout. */
	public async placeOrder(): Promise<void> {
		if (this.busy || !this.checkout) return
		this.busy = true
		this.message = null
		try {
			await this.checkoutClient.confirm(this.checkout.id, this.signal)
			clearCheckoutId(this.eventId)
			this.stopCountdown()
			this.step = 'done'
		} catch (err) {
			if (this.signal?.aborted) return
			this.logger.warn('Placing the order failed', { error: err })
			await this.explainOrderFailure()
		} finally {
			this.busy = false
		}
	}

	private async explainOrderFailure(): Promise<void> {
		if (!this.checkout) return
		try {
			const c = await this.checkoutClient.get(this.checkout.id, this.signal)
			this.checkout = c
			this.outcome = outcomeOf(c)
		} catch (err) {
			this.logger.warn('Reading the checkout failed', { error: err })
			this.outcome = 'completing'
		}
		if (this.outcome === 'authentication-incomplete') {
			// The fan finishes the card authentication and tries again.
			this.message = { key: 'checkout.outcome.authenticationIncomplete' }
			this.forgetCard()
			this.step = 'personal-details'
			return
		}
		if (this.outcome !== 'completing') {
			this.forgetStoredCheckout()
			this.stopCountdown()
		}
		this.step = 'outcome'
	}

	/**
	 * Forget this checkout, unless another tab already replaced it with a
	 * newer one, which the fan can still go to.
	 */
	private forgetStoredCheckout(): void {
		if (loadCheckoutId(this.eventId) === this.checkout?.id) {
			clearCheckoutId(this.eventId)
		}
	}

	/** Go to the newer checkout that replaced this one. */
	public goToNewerCheckout(): void {
		this.checkout = null
		this.outcome = null
		this.forgetCard()
		void this.load()
	}

	/** Start the checkout again from the count. */
	public startAgain(): void {
		this.forgetStoredCheckout()
		this.checkout = null
		this.outcome = null
		this.message = null
		this.forgetCard()
		this.step = 'count'
	}

	// ── Completion ────────────────────────────────────────────────────────────

	public async allowNotifications(): Promise<void> {
		try {
			await this.pushService.create()
		} catch (err) {
			this.logger.warn('Enabling notifications failed', { error: err })
		}
	}

	public async installApp(): Promise<void> {
		await this.pwaInstall.install()
	}

	// ── Countdown ─────────────────────────────────────────────────────────────

	private startCountdown(): void {
		this.now = Date.now()
		if (this.timer) return
		this.timer = setInterval(() => {
			this.now = Date.now()
		}, 1000)
	}

	private stopCountdown(): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}
}

/**
 * The event's first-come sale: of its first-come sales, the open one,
 * otherwise the next to open, otherwise the last that ended.
 */
export function firstComeSale(
	sales: readonly TicketSale[],
	now: Date = new Date(),
): TicketSale | null {
	return currentSale(
		sales.filter((s) => s.method === 'firstCome'),
		now,
	)
}

/** What became of a checkout whose order could not be placed. */
export function outcomeOf(c: Checkout): CheckoutOutcome {
	switch (c.status) {
		case 'expired':
			return 'hold-ended'
		case 'released':
			return c.commitTime ? 'charge-failed' : 'replaced'
		case 'held':
			return 'authentication-incomplete'
		default:
			return 'completing'
	}
}
