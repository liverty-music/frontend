import { IRouter, type IRouteViewModel, type Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
	Stripe,
	StripeElements,
	StripePaymentElement,
} from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { ILotteryEntryRpcClient } from '../../adapter/rpc/client/lottery-entry-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import { referralCodeForSeries } from '../../adapter/storage/referral-storage'
import { isVerified } from '../../entities/identity-verification'
import type { LotteryEntry } from '../../entities/lottery-entry'
import { isWindowOpen, type TicketSale } from '../../entities/ticket-sale'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { toDomesticDisplay, toE164 } from '../../lib/to-e164'
import type { TicketLotteryEntryStartedProps } from '../../services/analytics-events'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { IStripeService } from '../../services/stripe-service'
import { IUserStore } from '../../services/user-store'
import {
	type EventPageEvent,
	eventFromConcert,
	formatEventDate,
	formatSaleStart,
} from '../event/event-page'

/**
 * Discrete UI phases of the lottery entry screen.
 *
 * - `loading`: the event and its sales are read.
 * - `unavailable`: card payments are not configured in this environment.
 * - `not-found`: the event offers no lottery TicketType with this id.
 * - `closed`: the lottery's window is not open.
 * - `verify-required`: the sale requires a verification the fan lacks.
 * - `count` → `personal-details` → `payment`: the entry's steps; `submitting` covers
 *   the card confirmation and LotteryEntryService.Confirm.
 * - `done`: the entry was made (Confirm succeeded).
 */
export type LotteryEntryStep =
	| 'loading'
	| 'unavailable'
	| 'not-found'
	| 'closed'
	| 'verify-required'
	| 'count'
	| 'personal-details'
	| 'payment'
	| 'submitting'
	| 'done'

/** An i18n key with its parameters, shown as the step's message. */
export interface LotteryEntryMessage {
	readonly key: string
	readonly params?: Record<string, string | number>
}

/**
 * The fan's lottery entry for one TicketType
 * (`/events/:id/lottery/:ticketTypeId`): choose the count, give the personal
 * details (full name and phone number), authorize the card, and enter the
 * draw.
 *
 * The entry is built as a resource before the card authorization opens, as a
 * checkout is: LotteryEntryService.Start makes a Draft, AuthorizeCard saves the
 * name and phone number on the fan's account and returns the card
 * authorization secret, and Confirm enters the Draft once the card issuer has
 * authorized the card. The
 * screen shows the entry as made only after Confirm succeeds.
 */
export class LotteryEntryRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('LotteryEntryRoute')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private readonly entryClient = resolve(ILotteryEntryRpcClient)
	private readonly stripe = resolve(IStripeService)
	private readonly identityVerifications = resolve(IIdentityVerificationService)
	private readonly userStore = resolve(IUserStore)
	private readonly router = resolve(IRouter)
	private readonly analytics = resolve(IAnalyticsService)

	public step: LotteryEntryStep = 'loading'
	public event: EventPageEvent | null = null
	/** The lottery sale, with the TicketType this screen enters. */
	public sale: TicketSale | null = null
	/** The fan's Draft, once started; the made entry after Confirm. */
	public entry: LotteryEntry | null = null

	public ticketCount = 1
	public fullName = ''
	public phoneNumber = ''

	/** The current step's message, or null. */
	public message: LotteryEntryMessage | null = null
	/** Catalog key of the card failure copy (`payment.error.*`), or empty. */
	public cardError = ''
	/** True while a request of the current step is in flight. */
	public busy = false
	/** DOM node the Stripe Payment Element mounts into (captured via `ref`). */
	public paymentElementHost?: HTMLElement

	private eventId = ''
	private ticketTypeId = ''
	/**
	 * True once the card issuer authorized the Draft's card. A retry after a
	 * failed Confirm must not confirm the card again: Stripe rejects
	 * confirming a card authorization that already awaits capture.
	 */
	private cardConfirmed = false
	private abortController: AbortController | null = null
	private stripeHandles: { stripe: Stripe; elements: StripeElements } | null =
		null
	private paymentElement: StripePaymentElement | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
		this.ticketTypeId = params.ticketTypeId ?? ''
		// Never hold the view swap on data: start the reads and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.destroyPaymentElement()
	}

	private get signal(): AbortSignal | undefined {
		return this.abortController?.signal
	}

	/** Read the event and the lottery sale this TicketType belongs to. */
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
			this.sale =
				sales.find(
					(s) =>
						s.method === 'lottery' && s.ticketType.id === this.ticketTypeId,
				) ?? null
		} catch (err) {
			if (signal.aborted) return
			if (ConnectError.from(err).code !== Code.NotFound) {
				this.logger.warn('Lottery entry read failed', {
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
		if (!isWindowOpen(this.sale, new Date())) {
			this.step = 'closed'
			return
		}
		this.prefillPersonalDetails()
		if (await this.lacksVerification(signal)) {
			if (!signal.aborted) this.step = 'verify-required'
			return
		}
		if (signal.aborted) return
		this.step = 'count'
	}

	/**
	 * True when the sale requires a verification the fan does not have. On a
	 * status-read failure the entry proceeds: the server checks the
	 * requirement at Start, so it is never bypassed, only surfaced later.
	 */
	private async lacksVerification(signal: AbortSignal): Promise<boolean> {
		const requirement = this.sale?.verificationRequirement ?? 'none'
		if (requirement === 'none') return false
		try {
			const identityVerification = await this.identityVerifications.get(signal)
			if (!isVerified(identityVerification)) return true
			return (
				requirement === 'jpkiOnly' && identityVerification?.method !== 'jpki'
			)
		} catch (err) {
			if (!signal.aborted) {
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

	// ── Derived view ──────────────────────────────────────────────────────────

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

	/** The amount the card authorization covers: price × count. */
	public get total(): number {
		return this.price * this.ticketCount
	}

	/** A yen amount with thousands separators, e.g. "8,000". */
	public yen(amount: number): string {
		return amount.toLocaleString('ja-JP')
	}

	public get phoneE164(): string | null {
		return toE164(this.phoneNumber)
	}

	/** True once the fan has typed a phone number that cannot be sent. */
	public get isPhoneInvalid(): boolean {
		return this.phoneNumber.trim().length > 0 && this.phoneE164 === null
	}

	/** Name non-blank and the phone number convertible to E.164. */
	public get isPersonalDetailsValid(): boolean {
		return this.fullName.trim().length > 0 && this.phoneE164 !== null
	}

	private get lang(): string {
		return this.userStore.currentLanguage
	}

	public get dateLabel(): string {
		return this.event ? formatEventDate(this.event, this.lang) : ''
	}

	public get windowLabel(): string {
		if (!this.sale) return ''
		return `${formatSaleStart(this.sale.saleStartTime, this.lang)} – ${formatSaleStart(this.sale.saleEndTime, this.lang)}`
	}

	/** The Event, TicketType and count an entry event reports. */
	private choice(): TicketLotteryEntryStartedProps {
		return {
			event_id: this.eventId,
			ticket_type_id: this.ticketTypeId,
			ticket_count: this.ticketCount,
		}
	}

	/** Where the fan reads the entry they made. */
	public get entryStatusUrl(): string {
		return `/events/${this.eventId}/lottery/${this.ticketTypeId}/entry`
	}

	// ── Step transitions ──────────────────────────────────────────────────────

	/** From the verification gate: verification lives on the Settings screen. */
	public async goToVerify(): Promise<void> {
		await this.router.load('/settings')
	}

	/** Start the Draft for the chosen count and continue to the 本人確認 step. */
	public async toPersonalDetails(): Promise<void> {
		if (this.busy || !this.sale) return
		this.busy = true
		this.message = null
		try {
			const entry = await this.entryClient.start(
				this.sale.ticketType.id,
				this.ticketCount,
				// The referral link's code counts only for the Series it was
				// kept for (OpenSpec `referral-attribution`, design D7).
				referralCodeForSeries(this.event?.seriesId),
				this.signal,
			)
			// Another count replaces the Draft: its card is authorized anew.
			if (entry.id !== this.entry?.id) this.forgetCard()
			this.entry = entry
			this.analytics.capture(Events.TicketLotteryEntryStarted, this.choice())
			this.step = 'personal-details'
		} catch (err) {
			if (this.signal?.aborted) return
			this.explainStartFailure(err)
		} finally {
			this.busy = false
		}
	}

	private explainStartFailure(err: unknown): void {
		if (ConnectError.from(err).code === Code.FailedPrecondition) {
			// The window closed, or the fan would hold more than the limit.
			this.message =
				this.sale && isWindowOpen(this.sale, new Date())
					? {
							key: 'lotteryEntry.count.limit',
							params: { limit: this.perAccountLimit },
						}
					: { key: 'lotteryEntry.closed' }
			return
		}
		this.logger.error('Start failed', { error: err })
		this.message = { key: 'lotteryEntry.error.retry' }
	}

	public backToCount(): void {
		this.message = null
		this.step = 'count'
	}

	/**
	 * Save the name and phone number and open the Draft's card authorization
	 * (LotteryEntryService.AuthorizeCard), then mount the card form bound to
	 * the card authorization secret.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isPersonalDetailsValid || this.busy || !this.entry) return
		this.busy = true
		this.message = null
		try {
			const fullName = this.fullName.trim()
			const phoneNumber = this.phoneE164 ?? ''
			const cardAuthorizationSecret = await this.entryClient.authorizeCard(
				this.entry.id,
				fullName,
				phoneNumber,
				this.signal,
			)
			// The server saved them on the fan's User: the next screen prefills
			// the same values.
			const user = this.userStore.current
			if (user) this.userStore.current = { ...user, fullName, phoneNumber }
			if (this.cardConfirmed) {
				this.step = 'payment'
				return
			}
			this.destroyPaymentElement()
			this.stripeHandles = await this.stripe.createElements(
				cardAuthorizationSecret,
			)
			if (!this.stripeHandles) {
				this.message = { key: 'lotteryEntry.error.payment' }
				return
			}
			this.step = 'payment'
			// The mount host exists only once the payment step is rendered.
			queueMicrotask(() => this.mountPaymentElement())
		} catch (err) {
			if (this.signal?.aborted) return
			this.logger.error('AuthorizeCard failed', { error: err })
			this.message =
				ConnectError.from(err).code === Code.FailedPrecondition
					? { key: 'lotteryEntry.closed' }
					: { key: 'lotteryEntry.error.retry' }
		} finally {
			this.busy = false
		}
	}

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

	private forgetCard(): void {
		this.cardConfirmed = false
		this.destroyPaymentElement()
	}

	/**
	 * Confirm the card authorization with the card issuer (once), then enter the Draft
	 * with LotteryEntryService.Confirm. The card is charged only on a win.
	 */
	public async confirmEntry(): Promise<void> {
		if (this.step === 'submitting' || !this.entry) return
		if (!this.cardConfirmed && !this.stripeHandles) {
			this.message = { key: 'lotteryEntry.error.payment' }
			return
		}
		this.errorBoundary.addBreadcrumb('action', 'submit_lottery_entry')
		this.message = null
		this.cardError = ''
		this.step = 'submitting'

		if (!this.cardConfirmed && this.stripeHandles) {
			const { stripe, elements } = this.stripeHandles
			const confirmed = await this.stripe.confirmCardAuthorization(
				stripe,
				elements,
			)
			if (confirmed.errorKey || !confirmed.cardAuthorizationId) {
				this.cardError = confirmed.errorKey ?? 'payment.error.failed'
				this.step = 'payment'
				return
			}
			this.cardConfirmed = true
		}

		try {
			this.entry = await this.entryClient.confirm(this.entry.id, this.signal)
			this.analytics.capture(Events.TicketLotteryEntrySubmitted, this.choice())
			this.destroyPaymentElement()
			this.step = 'done'
		} catch (err) {
			if (this.signal?.aborted) return
			this.logger.error('Confirm failed', { error: err })
			// The card authorization stays; trying again confirms the same entry.
			this.message = { key: 'lotteryEntry.error.confirm' }
			this.step = 'payment'
		}
	}
}
