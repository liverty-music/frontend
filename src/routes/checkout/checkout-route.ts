import type { IRouteViewModel, Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
	Stripe,
	StripeElements,
	StripePaymentElement,
} from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { IReservationRpcClient } from '../../adapter/rpc/client/reservation-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import {
	clearCheckoutReservation,
	loadCheckoutReservation,
	saveCheckoutReservation,
} from '../../adapter/storage/checkout-storage'
import type { HolderIdentity } from '../../entities/holder-identity'
import type { Reservation } from '../../entities/reservation'
import { isBuyable, type TicketSale } from '../../entities/ticket-sale'
import { toE164 } from '../../lib/to-e164'
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
import { type SellerDetails, sellerDetailsFromConcert } from './seller-details'

/**
 * - `loading`: the event and its sale are read, and a held checkout resumed.
 * - `unavailable`: card payments are not configured in this environment.
 * - `not-found`: the event has no sale on offer (none, or cancelled).
 * - `count` → `identity` → `payment` → `confirm`: the checkout's steps.
 * - `done`: the order was placed.
 * - `outcome`: placing the order failed; the screen says what happened.
 */
export type CheckoutStep =
	| 'loading'
	| 'unavailable'
	| 'not-found'
	| 'count'
	| 'identity'
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
 * The fan's checkout for a first-come TicketSale (`/events/:id/checkout`):
 * choose the count and hold the tickets for 15 minutes, confirm the 本人確認
 * details, open the card hold, review the 特商法 final confirmation, and place
 * the order. Reopening the page during the hold resumes the same checkout.
 */
export class CheckoutRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('CheckoutRoute')
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private readonly reservationClient = resolve(IReservationRpcClient)
	private readonly stripe = resolve(IStripeService)
	private readonly userStore = resolve(IUserStore)
	private readonly pushService = resolve(IPushService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pwaInstall = resolve(IPwaInstallService)

	public step: CheckoutStep = 'loading'
	public event: EventPageEvent | null = null
	public seller: SellerDetails | null = null
	public sale: TicketSale | null = null
	public reservation: Reservation | null = null

	public ticketCount = 1
	public fullName = ''
	public phoneNumber = ''
	/** The card the hold was opened on, once authorized. */
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
	private clientSecret = ''
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
			const [concert, sale] = await Promise.all([
				this.concertClient.get(this.eventId, signal),
				this.saleClient.get(this.eventId, signal),
			])
			if (signal.aborted) return
			this.event = eventFromConcert(concert)
			this.seller = sellerDetailsFromConcert(concert)
			this.sale = sale
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
		this.prefillIdentity()
		if (await this.resume(signal)) return
		if (signal.aborted) return
		this.step = 'count'
	}

	/** Prefill the 本人確認 details saved on the fan's account. */
	private prefillIdentity(): void {
		const saved = this.userStore.current?.holderIdentity
		if (!saved) return
		this.fullName = saved.fullName
		this.phoneNumber = saved.phoneNumber
	}

	/**
	 * Resume the checkout the fan left during its hold, with the same count
	 * and countdown. Returns false, forgetting it, when there is none to resume.
	 */
	private async resume(signal: AbortSignal): Promise<boolean> {
		const id = loadCheckoutReservation(this.eventId)
		if (!id) return false
		try {
			const reservation = await this.reservationClient.get(id, signal)
			if (signal.aborted) return true
			if (
				reservation.status === 'held' &&
				reservation.ticketSaleId === this.sale?.id
			) {
				this.holdWith(reservation)
				this.step = 'identity'
				return true
			}
		} catch (err) {
			if (signal.aborted) return true
			this.logger.warn('Checkout resume failed', { error: err })
		}
		clearCheckoutReservation(this.eventId)
		return false
	}

	// ── Derived view ──────────────────────────────────────────────────────────

	public get perAccountLimit(): number {
		return this.sale?.perAccountLimit ?? 1
	}

	/** The counts a fan may pick, 1 to the per-account limit. */
	public get countOptions(): number[] {
		return Array.from({ length: this.perAccountLimit }, (_, i) => i + 1)
	}

	public get price(): number {
		return this.sale?.price ?? 0
	}

	/** The total to pay: the held amount once held, else price × count. */
	public get total(): number {
		return this.reservation?.amount ?? this.price * this.ticketCount
	}

	/** A yen amount with thousands separators, e.g. "6,000". */
	public yen(amount: number): string {
		return amount.toLocaleString('ja-JP')
	}

	/** Seconds left on the hold, never below 0. */
	public get secondsLeft(): number {
		if (!this.reservation) return 0
		const ms = this.reservation.holdExpireTime.getTime() - this.now
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

	public get isIdentityValid(): boolean {
		return this.fullName.trim().length > 0 && this.phoneE164 !== null
	}

	private get identity(): HolderIdentity {
		return { fullName: this.fullName.trim(), phoneNumber: this.phoneE164 ?? '' }
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
		return `${formatSaleStart(this.sale.saleStart, this.lang)} – ${formatSaleStart(this.sale.saleEnd, this.lang)}`
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
			const reservation = await this.reservationClient.start(
				this.sale.id,
				this.ticketCount,
				this.signal,
			)
			// A new count means a new hold and a new amount: the card is
			// authorized again for it.
			if (reservation.id !== this.reservation?.id) this.forgetCard()
			this.holdWith(reservation)
			saveCheckoutReservation(this.eventId, reservation.id)
			this.step = 'identity'
		} catch (err) {
			if (this.signal?.aborted) return
			await this.explainHoldFailure(err)
		} finally {
			this.busy = false
		}
	}

	private holdWith(reservation: Reservation): void {
		this.reservation = reservation
		this.ticketCount = reservation.ticketCount
		this.startCountdown()
	}

	/** Say why the tickets could not be held. */
	private async explainHoldFailure(err: unknown): Promise<void> {
		const code = ConnectError.from(err).code
		if (code === Code.ResourceExhausted) {
			this.message = { key: 'checkout.count.allHeld' }
			return
		}
		if (code === Code.FailedPrecondition || code === Code.InvalidArgument) {
			// The sale may have ended, sold out or been cancelled since the page
			// opened; otherwise the per-account limit was reached.
			const sale = await this.saleClient
				.get(this.eventId, this.signal)
				.catch(() => this.sale)
			if (!sale) {
				this.message = { key: 'checkout.count.cancelled' }
			} else if (!isBuyable(sale)) {
				this.sale = sale
				this.message = {
					key:
						sale.state === 'soldOut'
							? 'checkout.count.soldOut'
							: 'checkout.count.ended',
				}
			} else {
				this.message = {
					key: 'checkout.count.limit',
					params: { limit: sale.perAccountLimit },
				}
			}
			return
		}
		this.logger.error('Start failed', { error: err })
		this.message = { key: 'checkout.error.retry' }
	}

	// ── Step 2: 本人確認 ───────────────────────────────────────────────────────

	/**
	 * Continue from the 本人確認 step: to the card form, or, when the card is
	 * already authorized (the fan came back to correct the details), record
	 * the corrected details on the same hold and return to the final
	 * confirmation.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isIdentityValid || this.busy || !this.reservation) return
		this.message = null
		if (this.card) {
			await this.reauthorize()
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

	private async reauthorize(): Promise<void> {
		if (!this.reservation) return
		this.busy = true
		try {
			await this.reservationClient.authorize(
				this.reservation.id,
				this.identity,
				this.signal,
			)
			this.step = 'confirm'
		} catch (err) {
			if (this.signal?.aborted) return
			this.explainAuthorizeFailure(err)
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
	 * Authorize the card: read it into a ConfirmationToken, record the 本人確認
	 * details and open the card hold, then complete the issuer's
	 * authentication in the page. Nothing is charged until the order is placed.
	 */
	public async authorize(): Promise<void> {
		if (this.busy || !this.stripeHandles || !this.reservation) return
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
			this.clientSecret = await this.reservationClient.authorize(
				this.reservation.id,
				this.identity,
				this.signal,
			)
			const confirmed = await this.stripe.confirmCheckoutHold(
				stripe,
				this.clientSecret,
				read.card.tokenId,
			)
			if (confirmed.errorMessage) {
				// The fan may try another card on the same hold.
				this.cardError = confirmed.errorMessage
				return
			}
			this.card = read.card
			this.step = 'confirm'
		} catch (err) {
			if (this.signal?.aborted) return
			this.explainAuthorizeFailure(err)
		} finally {
			this.busy = false
		}
	}

	private explainAuthorizeFailure(err: unknown): void {
		if (ConnectError.from(err).code === Code.FailedPrecondition) {
			// The hold ended: the fan starts again.
			this.message = { key: 'checkout.payment.holdEnded' }
			return
		}
		this.logger.error('Authorize failed', { error: err })
		this.message = { key: 'checkout.error.retry' }
	}

	private forgetCard(): void {
		this.card = null
		this.clientSecret = ''
		this.destroyPaymentElement()
	}

	// ── Step 4: 特商法 final confirmation ───────────────────────────────────────

	public changeCount(): void {
		this.message = null
		this.step = 'count'
	}

	public changeIdentity(): void {
		this.message = null
		this.step = 'identity'
	}

	/** Place the order once; on failure, say what became of the checkout. */
	public async placeOrder(): Promise<void> {
		if (this.busy || !this.reservation) return
		this.busy = true
		this.message = null
		try {
			await this.reservationClient.confirm(this.reservation.id, this.signal)
			clearCheckoutReservation(this.eventId)
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
		if (!this.reservation) return
		try {
			const r = await this.reservationClient.get(
				this.reservation.id,
				this.signal,
			)
			this.reservation = r
			this.outcome = outcomeOf(r)
		} catch (err) {
			this.logger.warn('Reading the checkout failed', { error: err })
			this.outcome = 'completing'
		}
		if (this.outcome === 'authentication-incomplete') {
			// The fan finishes the card authentication and tries again.
			this.message = { key: 'checkout.outcome.authenticationIncomplete' }
			this.forgetCard()
			this.step = 'identity'
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
		if (loadCheckoutReservation(this.eventId) === this.reservation?.id) {
			clearCheckoutReservation(this.eventId)
		}
	}

	/** Go to the newer checkout that replaced this one. */
	public goToNewerCheckout(): void {
		this.reservation = null
		this.outcome = null
		this.forgetCard()
		void this.load()
	}

	/** Start the checkout again from the count. */
	public startAgain(): void {
		this.forgetStoredCheckout()
		this.reservation = null
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

/** What became of a checkout whose order could not be placed. */
export function outcomeOf(r: Reservation): CheckoutOutcome {
	switch (r.status) {
		case 'expired':
			return 'hold-ended'
		case 'released':
			return r.commitTime ? 'charge-failed' : 'replaced'
		case 'held':
			return 'authentication-incomplete'
		default:
			return 'completing'
	}
}
