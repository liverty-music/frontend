import { IRouter, type IRouteViewModel, type Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
	Stripe,
	StripeElements,
	StripePaymentElement,
} from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import {
	ILotteryEntryRpcClient,
	type LotteryCardAuthorization,
} from '../../adapter/rpc/client/lottery-entry-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import { referralCodeForSeries } from '../../adapter/storage/referral-storage'
import { isVerified } from '../../entities/identity-verification'
import type { LotteryEntry } from '../../entities/lottery-entry'
import {
	countOptions,
	type EventTicketSales,
	isWindowOpen,
	NO_TICKET_SALES,
	type TicketSale,
	type TicketStock,
} from '../../entities/ticket-sale'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { toDomesticDisplay, toE164 } from '../../lib/to-e164'
import type { TicketLotteryEntryStartedProps } from '../../services/analytics-events'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IHeldSeatTypeService } from '../../services/held-seat-type-service'
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
 * - `not-found`: the event has no such lottery sale or TicketStock.
 * - `closed`: the lottery's window is not open.
 * - `verify-required`: the sale requires a verification the fan lacks.
 * - `count` → `personal-details` → `payment`: the entry's steps; `submitting` covers
 *   the card confirmation and LotteryEntryService.Confirm.
 * - `done`: the entry was made (Confirm succeeded).
 * - `refused`: Confirm refused the card authorization; no entry was made and
 *   nothing will be charged.
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
	| 'refused'

/** An i18n key with its parameters, shown as the step's message. */
export interface LotteryEntryMessage {
	readonly key: string
	readonly params?: Record<string, string | number>
}

/**
 * The fan's lottery entry for one TicketStock (seat type) of an event in a
 * lottery sale (`/events/:id/lottery/:saleId/:stockId`): choose the count,
 * give the personal
 * details (full name and phone number), authorize the card, and enter the
 * draw.
 *
 * No entry exists before Confirm: LotteryEntryService.AuthorizeCard saves the
 * name and phone number on the fan's account and opens a card authorization
 * for the chosen count, and Confirm makes the entry from it once the card
 * issuer has authenticated the card. A count changed after authorizing is
 * authorized anew. The screen shows the entry as made only after Confirm
 * succeeds.
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
	private readonly heldSeatTypes = resolve(IHeldSeatTypeService)

	public step: LotteryEntryStep = 'loading'
	public event: EventPageEvent | null = null
	/** The lottery sale this screen enters. */
	public sale: TicketSale | null = null
	/** The TicketStock this screen enters: one seat type of the event. */
	public stock: TicketStock | null = null
	/** The event's sales, stocks and per-account limit as read. */
	public tickets: EventTicketSales = NO_TICKET_SALES
	/** The entry Confirm made, once it succeeded. */
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
	private saleId = ''
	private stockId = ''
	/**
	 * The card authorization AuthorizeCard opened, with the count it is for;
	 * Confirm names it. A count change opens a new one.
	 */
	private cardAuthorization:
		| (LotteryCardAuthorization & { readonly ticketCount: number })
		| null = null
	/**
	 * True once the card issuer authenticated the card authorization. A retry
	 * after a failed Confirm must not confirm the card again: Stripe rejects
	 * confirming a card authorization that already awaits capture. From then
	 * on the card authorization becomes the entry, so the count stays.
	 */
	public cardConfirmed = false
	/** True once the entry-started event was sent (on the first AuthorizeCard). */
	private startReported = false
	private abortController: AbortController | null = null
	private stripeHandles: { stripe: Stripe; elements: StripeElements } | null =
		null
	private paymentElement: StripePaymentElement | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
		this.saleId = params.saleId ?? ''
		this.stockId = params.stockId ?? ''
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

	/** Read the event, the lottery sale and the TicketStock it enters. */
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
			const [concert, tickets] = await Promise.all([
				this.concertClient.get(this.eventId, signal),
				this.saleClient.listByEvent(this.eventId, signal),
			])
			if (signal.aborted) return
			this.event = eventFromConcert(concert)
			this.tickets = tickets
			this.sale =
				tickets.sales.find(
					(s) => s.method === 'lottery' && s.id === this.saleId,
				) ?? null
			this.stock = tickets.stocks.find((s) => s.id === this.stockId) ?? null
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
		if (!this.event || !this.sale || !this.stock || this.event.cancelled) {
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
	 * requirement at AuthorizeCard, so it is never bypassed, only surfaced
	 * later.
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

	/** The event's per-account limit, across every sale and seat type. */
	public get perAccountLimit(): number {
		return this.tickets.perAccountLimit ?? 1
	}

	/** The counts a fan may pick, 1 to the event's per-account limit. */
	public get countOptions(): number[] {
		return countOptions(this.perAccountLimit)
	}

	/** The seat type's name, e.g. "S席". */
	public get seatTypeName(): string {
		return this.stock?.seatTypeName ?? ''
	}

	/** The seat type's price of one ticket in yen, 税込. */
	public get price(): number {
		return this.stock?.price ?? 0
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

	/** The Event, TicketStock and count an entry event reports. */
	private choice(): TicketLotteryEntryStartedProps {
		return {
			event_id: this.eventId,
			ticket_stock_id: this.stockId,
			ticket_count: this.ticketCount,
		}
	}

	/** True when a refusal is because the fan has an entry in the sale for the event. */
	public get alreadyEntered(): boolean {
		return this.message?.key === 'lotteryEntry.refused.alreadyEntered'
	}

	/** True when a refusal leaves the fan free to authorize a card again. */
	public get canTryAgain(): boolean {
		return this.message?.key === 'lotteryEntry.refused.other'
	}

	/** Where the fan reads the entry they made. */
	public get entryStatusUrl(): string {
		return `/events/${this.eventId}/lottery/${this.saleId}/${this.stockId}/entry`
	}

	// ── Step transitions ──────────────────────────────────────────────────────

	/** From the verification gate: verification lives on the Settings screen. */
	public async goToVerify(): Promise<void> {
		await this.router.load('/settings')
	}

	/** Continue to the 本人確認 step with the chosen count. */
	public toPersonalDetails(): void {
		if (this.busy || !this.sale) return
		this.message = null
		this.step = 'personal-details'
	}

	public backToCount(): void {
		this.message = null
		this.step = 'count'
	}

	/**
	 * From the card form back to the 本人確認 step (and on to the count). Not
	 * once the card is authenticated: that card authorization becomes the entry.
	 */
	public backToPersonalDetails(): void {
		if (this.step !== 'payment' || this.cardConfirmed) return
		this.message = null
		this.cardError = ''
		this.step = 'personal-details'
	}

	/**
	 * Save the name and phone number and open a card authorization for the
	 * chosen count (LotteryEntryService.AuthorizeCard), then mount the card
	 * form bound to its secret. Once the card was authenticated for this count,
	 * the fan only returns to the card form: that card authorization becomes
	 * the entry.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isPersonalDetailsValid || this.busy || !this.sale || !this.stock)
			return
		if (
			this.cardConfirmed &&
			this.cardAuthorization?.ticketCount === this.ticketCount
		) {
			this.message = null
			this.step = 'payment'
			return
		}
		this.busy = true
		this.message = null
		try {
			const fullName = this.fullName.trim()
			const phoneNumber = this.phoneE164 ?? ''
			const ticketCount = this.ticketCount
			const cardAuthorization = await this.entryClient.authorizeCard(
				this.sale.id,
				this.stock.id,
				ticketCount,
				fullName,
				phoneNumber,
				// The referral link's code counts only for the Series it was
				// kept for (OpenSpec `referral-attribution`, design D7).
				referralCodeForSeries(this.event?.seriesId),
				this.signal,
			)
			this.forgetCard()
			this.cardAuthorization = { ...cardAuthorization, ticketCount }
			if (!this.startReported) {
				this.startReported = true
				this.analytics.capture(Events.TicketLotteryEntryStarted, this.choice())
			}
			// The server saved them on the fan's User: the next screen prefills
			// the same values.
			const user = this.userStore.current
			if (user) this.userStore.current = { ...user, fullName, phoneNumber }
			this.stripeHandles = await this.stripe.createElements(
				cardAuthorization.secret,
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
			await this.explainAuthorizeCardFailure(err)
		} finally {
			this.busy = false
		}
	}

	private async explainAuthorizeCardFailure(err: unknown): Promise<void> {
		const code = ConnectError.from(err).code
		if (code === Code.FailedPrecondition || code === Code.InvalidArgument) {
			if (this.sale && !isWindowOpen(this.sale, new Date())) {
				this.message = { key: 'lotteryEntry.closed' }
				return
			}
			if (await this.hasEntry()) {
				if (this.signal?.aborted) return
				this.message = { key: 'lotteryEntry.refused.alreadyEntered' }
				this.step = 'refused'
				return
			}
			const other = await this.otherSeatType()
			if (this.signal?.aborted) return
			if (other) {
				this.message = {
					key: 'lotteryEntry.refused.otherSeatType',
					params: { seatType: other },
				}
				this.step = 'refused'
				return
			}
			// Otherwise the fan would hold more than the per-account limit:
			// the count is what they change.
			this.message = {
				key: 'lotteryEntry.count.limit',
				params: { limit: this.perAccountLimit },
			}
			this.step = 'count'
			return
		}
		this.logger.error('AuthorizeCard failed', { error: err })
		this.message = { key: 'lotteryEntry.error.retry' }
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
		this.cardAuthorization = null
		this.cardConfirmed = false
		this.destroyPaymentElement()
	}

	/**
	 * Confirm the card authorization with the card issuer (once), then make the
	 * entry from it with LotteryEntryService.Confirm. The card is charged only
	 * on a win.
	 */
	public async confirmEntry(): Promise<void> {
		if (this.step === 'submitting' || !this.cardAuthorization) return
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
			this.entry = await this.entryClient.confirm(
				this.cardAuthorization.id,
				this.signal,
			)
			this.analytics.capture(Events.TicketLotteryEntrySubmitted, this.choice())
			this.destroyPaymentElement()
			this.step = 'done'
		} catch (err) {
			if (this.signal?.aborted) return
			const code = ConnectError.from(err).code
			if (code === Code.FailedPrecondition || code === Code.InvalidArgument) {
				await this.explainRefusal(err)
				return
			}
			this.logger.error('Confirm failed', { error: err })
			// The card authorization stays; trying again confirms the same one.
			this.message = { key: 'lotteryEntry.error.confirm' }
			this.step = 'payment'
		}
	}

	/**
	 * Confirm refused the card authorization: it made no entry and released
	 * the card authorization (or never held it), so nothing will be charged.
	 * The error carries no reason, so the screen tells the ones the fan can
	 * act on from what it can read: the window has closed, the fan's entry in
	 * the sale for the event exists already, the fan holds another seat type
	 * of the event, or the count would exceed the per-account limit.
	 */
	private async explainRefusal(err: unknown): Promise<void> {
		this.logger.warn('Confirm refused the entry', { error: err })
		this.forgetCard()
		this.message = await this.refusalMessage()
		if (this.signal?.aborted) return
		this.step = 'refused'
	}

	private async refusalMessage(): Promise<LotteryEntryMessage> {
		if (this.sale && !isWindowOpen(this.sale, new Date())) {
			return { key: 'lotteryEntry.refused.closed' }
		}
		if (await this.hasEntry()) {
			return { key: 'lotteryEntry.refused.alreadyEntered' }
		}
		const held = await this.heldSeatTypes.heldTickets(
			this.eventId,
			this.tickets,
			this.signal,
		)
		if (held && held.stock.id !== this.stockId) {
			return {
				key: 'lotteryEntry.refused.otherSeatType',
				params: { seatType: held.stock.seatTypeName },
			}
		}
		if (held && held.count + this.ticketCount > this.perAccountLimit) {
			return {
				key: 'lotteryEntry.refused.limit',
				params: { limit: this.perAccountLimit },
			}
		}
		return { key: 'lotteryEntry.refused.other' }
	}

	/**
	 * The seat type's name when the fan holds or applied for another seat type
	 * of the event, else null.
	 */
	private async otherSeatType(): Promise<string | null> {
		const held = await this.heldSeatTypes.heldTickets(
			this.eventId,
			this.tickets,
			this.signal,
		)
		return held && held.stock.id !== this.stockId
			? held.stock.seatTypeName
			: null
	}

	/**
	 * True when the fan has an entry in the sale for this event (one of its
	 * stocks); false when unknown.
	 */
	private async hasEntry(): Promise<boolean> {
		const stocks = new Set(this.tickets.stocks.map((s) => s.id))
		try {
			const entries = await this.entryClient.listByTicketSale(
				this.saleId,
				this.signal,
			)
			return entries.some((e) => stocks.has(e.ticketStockId))
		} catch (err) {
			if (!this.signal?.aborted) {
				this.logger.warn('Entry read after a refusal failed', { error: err })
			}
			return false
		}
	}

	/** After a refusal for another reason, the fan may authorize again. */
	public tryAgain(): void {
		this.message = null
		this.step = 'personal-details'
	}
}
