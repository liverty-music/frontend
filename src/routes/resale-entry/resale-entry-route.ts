import type { IRouteViewModel, Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
	Stripe,
	StripeElements,
	StripePaymentElement,
} from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import {
	IResaleEntryRpcClient,
	type ResaleCardAuthorization,
} from '../../adapter/rpc/client/resale-entry-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import { referralCodeForSeries } from '../../adapter/storage/referral-storage'
import type { ResaleEntry } from '../../entities/resale-entry'
import { resaleDeadline } from '../../entities/resale-listing'
import {
	countOptions,
	type EventTicketSales,
	NO_TICKET_SALES,
	type TicketStock,
} from '../../entities/ticket-sale'
import { toDomesticDisplay, toE164 } from '../../lib/to-e164'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IHeldSeatTypeService } from '../../services/held-seat-type-service'
import { IStripeService } from '../../services/stripe-service'
import { IUserStore } from '../../services/user-store'
import {
	type BusinessDetails,
	businessDetailsFromConcert,
} from '../checkout/business-details'
import {
	type EventPageEvent,
	eventFromConcert,
	formatEventDate,
	formatEventTime,
	formatSaleStart,
} from '../event/event-page'

/**
 * Discrete UI phases of the resale entry screen.
 *
 * - `loading`: the event, its stocks and the fan's entries are read.
 * - `unavailable`: card payments are not configured in this environment.
 * - `not-found`: the event has no such TicketStock.
 * - `closed`: the stock's resale is not open.
 * - `applied`: the fan already has an entry waiting for a draw at the event.
 * - `other-seat-type`: the fan holds or applied for another seat type.
 * - `limit`: the fan already holds as many tickets as the event allows.
 * - `count` → `personal-details` → `payment`: the application's steps; the
 *   payment step carries the 特商法 final confirmation, and `submitting`
 *   covers the card confirmation and ResaleEntryService.Confirm.
 * - `done`: the entry was made (Confirm succeeded).
 * - `refused`: Confirm or AuthorizeCard refused; no entry was made and
 *   nothing will be charged.
 */
export type ResaleEntryStep =
	| 'loading'
	| 'unavailable'
	| 'not-found'
	| 'closed'
	| 'applied'
	| 'other-seat-type'
	| 'limit'
	| 'count'
	| 'personal-details'
	| 'payment'
	| 'submitting'
	| 'done'
	| 'refused'

/** An i18n key with its parameters, shown as the step's message. */
export interface ResaleEntryMessage {
	readonly key: string
	readonly params?: Record<string, string | number>
}

/**
 * The fan's application for official resale (公式リセール) tickets of one
 * sold-out TicketStock (seat type) of an event (`/events/:id/resale/:stockId`):
 * choose the count, give the personal details, read the 特商法 final
 * confirmation and authorize the card.
 *
 * No entry exists before Confirm: ResaleEntryService.AuthorizeCard saves the
 * name and phone number and opens a card authorization for the chosen count,
 * and Confirm makes the entry from it once the card issuer has authenticated
 * the card. The total is held on the card and charged only when a draw
 * allocates the tickets.
 */
export class ResaleEntryRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('ResaleEntryRoute')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private readonly entryClient = resolve(IResaleEntryRpcClient)
	private readonly stripe = resolve(IStripeService)
	private readonly userStore = resolve(IUserStore)
	private readonly heldSeatTypes = resolve(IHeldSeatTypeService)

	public step: ResaleEntryStep = 'loading'
	public event: EventPageEvent | null = null
	/** The TicketStock this screen applies for: one seat type of the event. */
	public stock: TicketStock | null = null
	/** The event's stocks and per-account limit as read. */
	public tickets: EventTicketSales = NO_TICKET_SALES
	/** The Organizer's business details for the 特商法 confirmation. */
	public businessDetails: BusinessDetails | null = null
	/** The fan's entry: the one made here, or the one waiting already. */
	public entry: ResaleEntry | null = null
	/** The seat type the fan holds or applied for, when it is another one. */
	public otherSeatTypeName = ''
	/** Tickets the fan already holds or applied for at the event. */
	public heldCount = 0

	public ticketCount = 1
	public fullName = ''
	public phoneNumber = ''

	/** The current step's message, or null. */
	public message: ResaleEntryMessage | null = null
	/** Catalog key of the card failure copy (`payment.error.*`), or empty. */
	public cardError = ''
	/** True while a request of the current step is in flight. */
	public busy = false
	/** DOM node the Stripe Payment Element mounts into (captured via `ref`). */
	public paymentElementHost?: HTMLElement
	/**
	 * True once the card issuer authenticated the card authorization. From
	 * then on it becomes the entry, so the count and details stay, and a retry
	 * after a failed Confirm does not confirm the card again.
	 */
	public cardConfirmed = false

	private eventId = ''
	private stockId = ''
	/** The card authorization AuthorizeCard opened; Confirm names it. */
	private cardAuthorization: ResaleCardAuthorization | null = null
	private abortController: AbortController | null = null
	private stripeHandles: { stripe: Stripe; elements: StripeElements } | null =
		null
	private paymentElement: StripePaymentElement | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
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

	/** Read the event, its stocks and what the fan holds or applied for. */
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
			this.businessDetails = businessDetailsFromConcert(concert)
			this.tickets = tickets
			this.stock = tickets.stocks.find((s) => s.id === this.stockId) ?? null
		} catch (err) {
			if (signal.aborted) return
			if (ConnectError.from(err).code !== Code.NotFound) {
				this.logger.warn('Resale entry read failed', {
					eventId: this.eventId,
					error: err,
				})
			}
			this.step = 'not-found'
			return
		}
		if (!this.event || !this.stock || this.event.cancelled) {
			this.step = 'not-found'
			return
		}
		this.prefillPersonalDetails()
		const step = await this.gate()
		if (signal.aborted) return
		this.step = step
	}

	/**
	 * Where the fan starts: the waiting entry they have, a seat type they
	 * cannot apply for, a closed resale, or the count.
	 */
	private async gate(): Promise<ResaleEntryStep> {
		const waiting = await this.waitingEntry()
		if (waiting) {
			this.entry = waiting
			return 'applied'
		}
		const held = await this.heldSeatTypes.heldTickets(
			this.eventId,
			this.tickets,
			this.signal,
		)
		if (held && held.stock.id !== this.stockId) {
			this.otherSeatTypeName = held.stock.seatTypeName
			return 'other-seat-type'
		}
		this.heldCount = held?.count ?? 0
		if (!this.stock?.resaleOpen) return 'closed'
		if (this.countOptions.length === 0) return 'limit'
		return 'count'
	}

	/** The fan's entry for this event that waits for a draw, if any. */
	private async waitingEntry(): Promise<ResaleEntry | null> {
		const stocks = new Set(this.tickets.stocks.map((s) => s.id))
		try {
			const { entries } = await this.entryClient.list(this.signal)
			return (
				entries.find(
					(e) => e.state === 'entered' && stocks.has(e.ticketStockId),
				) ?? null
			)
		} catch (err) {
			if (!this.signal?.aborted) {
				this.logger.warn('Resale entries read failed', { error: err })
			}
			// The server refuses a second entry anyway; the screen only
			// narrows what it offers.
			return null
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

	/** The counts a fan may apply for: 1 to the limit minus what they hold. */
	public get countOptions(): number[] {
		return countOptions(this.perAccountLimit - this.heldCount)
	}

	/** The seat type's name, e.g. "S席". */
	public get seatTypeName(): string {
		return this.stock?.seatTypeName ?? ''
	}

	/** The seat type's price of one ticket in yen, 税込. */
	public get price(): number {
		return this.stock?.price ?? 0
	}

	/** The amount held on the card and charged on a win: price × count. */
	public get total(): number {
		return this.price * this.ticketCount
	}

	/** A yen amount with thousands separators, e.g. "6,000". */
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

	public get openTimeLabel(): string {
		return this.event?.openTime ? formatEventTime(this.event.openTime) : ''
	}

	public get startTimeLabel(): string {
		return this.event?.startTime ? formatEventTime(this.event.startTime) : ''
	}

	/** The resale deadline (the last draw) in Japan time. */
	public get deadlineLabel(): string {
		const start = this.event?.startTime
		return start ? formatSaleStart(resaleDeadline(start), this.lang) : ''
	}

	/** The next draw of the fan's entry in Japan time, or empty. */
	public get nextDrawLabel(): string {
		const next = this.entry?.nextDrawTime
		return next ? formatSaleStart(next, this.lang) : ''
	}

	// ── Step transitions ──────────────────────────────────────────────────────

	/** Continue to the personal details with the chosen count. */
	public toPersonalDetails(): void {
		if (this.busy) return
		this.message = null
		this.step = 'personal-details'
	}

	/** Back to the count; not once the card is authenticated. */
	public backToCount(): void {
		if (this.cardConfirmed) return
		this.message = null
		this.cardError = ''
		this.step = 'count'
	}

	/** Back to the personal details; not once the card is authenticated. */
	public backToPersonalDetails(): void {
		if (this.cardConfirmed) return
		this.message = null
		this.cardError = ''
		this.step = 'personal-details'
	}

	/**
	 * Save the name and phone number and open a card authorization for the
	 * chosen count (ResaleEntryService.AuthorizeCard), then show the final
	 * confirmation with the card form bound to its secret. Nothing is held on
	 * the card until the fan applies, so coming back here after changing the
	 * count or the details opens a new one for what the fan chose now.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isPersonalDetailsValid || this.busy || !this.stock) return
		this.busy = true
		this.message = null
		try {
			const fullName = this.fullName.trim()
			const phoneNumber = this.phoneE164 ?? ''
			const cardAuthorization = await this.entryClient.authorizeCard(
				this.stock.id,
				this.ticketCount,
				fullName,
				phoneNumber,
				// The referral link's code counts only for the Series it was
				// kept for (OpenSpec `referral-attribution`, design D7).
				referralCodeForSeries(this.event?.seriesId),
				this.signal,
			)
			this.forgetCard()
			this.cardAuthorization = cardAuthorization
			const user = this.userStore.current
			if (user) this.userStore.current = { ...user, fullName, phoneNumber }
			this.stripeHandles = await this.stripe.createElements(
				cardAuthorization.secret,
			)
			if (!this.stripeHandles) {
				this.message = { key: 'resaleEntry.error.payment' }
				return
			}
			this.step = 'payment'
			// The mount host exists only once the payment step is rendered.
			queueMicrotask(() => this.mountPaymentElement())
		} catch (err) {
			if (this.signal?.aborted) return
			const code = ConnectError.from(err).code
			if (code === Code.FailedPrecondition || code === Code.InvalidArgument) {
				await this.explainRefusal(err)
				return
			}
			this.logger.error('AuthorizeCard failed', { error: err })
			this.message = { key: 'resaleEntry.error.retry' }
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
		this.cardAuthorization = null
		this.cardConfirmed = false
		this.destroyPaymentElement()
	}

	/**
	 * Apply: confirm the card authorization with the card issuer (once), then
	 * make the entry with ResaleEntryService.Confirm. A second tap while this
	 * runs does nothing.
	 */
	public async apply(): Promise<void> {
		if (this.step !== 'payment' || !this.cardAuthorization) return
		if (!this.cardConfirmed && !this.stripeHandles) {
			this.message = { key: 'resaleEntry.error.payment' }
			return
		}
		this.errorBoundary.addBreadcrumb('action', 'submit_resale_entry')
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
			this.message = { key: 'resaleEntry.error.confirm' }
			this.step = 'payment'
		}
	}

	/**
	 * The server refused the application: no entry was made and nothing will
	 * be charged. The error carries no reason, so the screen re-reads what the
	 * fan can act on: an entry already waiting, another seat type, a closed
	 * resale, or the per-account limit.
	 */
	private async explainRefusal(err: unknown): Promise<void> {
		this.logger.warn('The resale application was refused', { error: err })
		this.forgetCard()
		const step = await this.gate()
		if (this.signal?.aborted) return
		if (step !== 'count') {
			this.step = step
			return
		}
		if (this.ticketCount > this.countOptions.length) {
			this.message = {
				key: 'resaleEntry.count.limit',
				params: { limit: this.perAccountLimit },
			}
			this.ticketCount = 1
			this.step = 'count'
			return
		}
		this.message = { key: 'resaleEntry.refused.other' }
		this.step = 'refused'
	}

	/** After a refusal for another reason, the fan may apply again. */
	public tryAgain(): void {
		this.message = null
		this.step = 'count'
	}
}
