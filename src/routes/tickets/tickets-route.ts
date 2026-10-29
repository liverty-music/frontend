import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { admissionQrDataUrl } from '../../../shared/lib/admission-code/qr-svg'
import { IScreenWakeLock } from '../../adapter/browser/screen-wake-lock'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { IOrderRpcClient } from '../../adapter/rpc/client/order-client'
import { IResaleListingRpcClient } from '../../adapter/rpc/client/resale-listing-client'
import { ITicketRpcClient } from '../../adapter/rpc/client/ticket-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import {
	RESALE_FEE_PERCENT,
	type ResaleListing,
	resaleDeadline,
} from '../../entities/resale-listing'
import { toDomesticDisplay } from '../../lib/to-e164'
import {
	type DeviceReadiness,
	ITicketWallet,
} from '../../services/ticket-wallet'
import { IUserStore } from '../../services/user-store'
import {
	type EventPageEvent,
	eventFromConcert,
	formatEventDate,
	formatEventTime,
	formatSaleStart,
} from '../event/event-page'
import { AdmissionCodeSession } from './admission-code-session'
import {
	enterableTickets,
	groupByEvent,
	listingOf,
	presentedTickets,
	type ShownTicketState,
	type StockResale,
	shownState,
	type WalletEventGroup,
	type WalletPersonalDetails,
	type WalletSnapshot,
	type WalletTicket,
	walletTicketFromProto,
} from './wallet-view'

/**
 * Discrete UI phases of the tickets screen.
 *   - `loading` — nothing to show yet (no saved list, first read in flight).
 *   - `empty`   — the fan holds no tickets.
 *   - `error`   — the read failed and no saved list exists.
 *   - `loaded`  — `groups` drives the render (live or saved).
 */
export type TicketsViewStep = 'loading' | 'empty' | 'error' | 'loaded'

/**
 * How this device stands for showing entry QR codes (see DeviceReadiness),
 * plus `checking` while the entry device is being checked.
 */
export type DeviceState = 'checking' | DeviceReadiness

/** While a code is shown and online, look for admissions this often. */
export const ADMISSION_POLL_MS = 5000

/**
 * The fan's tickets screen (`/tickets`): tickets grouped by event with their
 * covered-ticket face and state, and the entry QR code the device makes for
 * the tickets entering together.
 *
 * - The last loaded list is saved on the device and shown at once on the next
 *   visit, so it stays viewable without a connection.
 * - On an online visit the screen checks whether this is the fan's entry
 *   device; it becomes one without asking only when the fan has none, and
 *   otherwise only when the fan confirms "use this device" (key pair created
 *   when missing,
 *   public key registered); offline, the code is offered only on a device
 *   that was the entry device at the last online check.
 * - The code presents every not-yet-entered ticket of the event (up to 10)
 *   with no way to leave one out: the fan and their companions enter
 *   together.
 * - The code is signed on the device every 15 seconds, with or without a
 *   connection, while the display is kept awake.
 */
export class TicketsRoute {
	private readonly logger = resolve(ILogger).scopeTo('TicketsRoute')
	public readonly i18n = resolve(I18N)
	private readonly ticketClient = resolve(ITicketRpcClient)
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly wallet = resolve(ITicketWallet)
	private readonly wakeLock = resolve(IScreenWakeLock)
	private readonly userStore = resolve(IUserStore)
	private readonly resaleClient = resolve(IResaleListingRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private readonly orderClient = resolve(IOrderRpcClient)

	// ── List state ───────────────────────────────────────────────────────────
	public step: TicketsViewStep = 'loading'
	public groups: WalletEventGroup[] = []
	/** True while the list shown is the saved one (no connection). */
	public offline = false
	/** When the saved list was loaded, when `offline`. */
	public savedAt: Date | null = null
	/** The personal details saved with the list last shown from the device. */
	private savedPersonalDetails: WalletPersonalDetails | null = null

	// ── Official resale (公式リセール) ────────────────────────────────────────
	/** The fan's listings, newest first (saved with the list for offline use). */
	public listings: ResaleListing[] = []
	/** Each TicketStock's resale, keyed by stock id, read online; absent offline. */
	public resaleByStock = new Map<string, StockResale>()
	/** The ticket whose listing is being confirmed. */
	public listingTicket: WalletTicket | null = null
	public listingGroup: WalletEventGroup | null = null
	/** A listing call is in flight. */
	public resaleBusy = false
	/** What the last listing call said, keyed to its ticket. */
	public resaleMessage: { ticketId: string; key: string } | null = null

	// ── Device state ─────────────────────────────────────────────────────────
	public device: DeviceState = 'checking'
	/** Registering on this visit moved the fan's key here from another device. */
	public movedToThisDevice = false
	/** The fan asked to use this device and is being asked to confirm. */
	public confirmingMove = false
	/** Registering this device is in flight. */
	public moving = false
	/** Using this device failed; a retry is offered. */
	public moveFailed = false

	// ── Admission code state ─────────────────────────────────────────────────
	public codeGroup: WalletEventGroup | null = null
	/** The tickets the code presents: every enterable one, up to 10. */
	public presented: WalletTicket[] = []
	public readonly session = new AdmissionCodeSession((ticketIds, signTime) =>
		this.signFor(ticketIds, signTime),
	)

	private abortController: AbortController | null = null
	private pollTimer: ReturnType<typeof setInterval> | null = null

	public loading(): void {
		// Never hold the view swap on data: start the read and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.closeCode()
	}

	/**
	 * Show the saved list at once, then read the live list. A live read saves
	 * the list and checks the entry device; a failed one keeps the saved list.
	 */
	public async load(): Promise<void> {
		this.abortController?.abort()
		const controller = new AbortController()
		this.abortController = controller
		const { signal } = controller

		const saved = await this.wallet.loadSnapshot<WalletSnapshot>()
		if (signal.aborted) return
		if (saved && this.step !== 'loaded') this.showSnapshot(saved)

		let live: WalletEventGroup[]
		try {
			const [groups] = await Promise.all([
				this.readLive(saved, signal),
				this.readListings(signal),
			])
			live = groups
		} catch (err) {
			if (signal.aborted) return
			this.logger.warn('Tickets read failed', { error: err })
			if (saved) {
				this.showSnapshot(saved)
			} else {
				this.step = 'error'
			}
			const check = await this.wallet.checkDevice(false)
			if (signal.aborted) return
			this.device = check.readiness
			return
		}
		if (signal.aborted) return
		this.groups = live
		const withStocks = await this.readStocks(live, saved, signal)
		if (signal.aborted) return
		this.groups = withStocks
		this.offline = false
		this.savedAt = null
		this.savedPersonalDetails = saved?.personalDetails ?? null
		this.step = live.length === 0 ? 'empty' : 'loaded'
		this.saveSnapshot()

		const check = await this.wallet.checkDevice(true, signal)
		if (signal.aborted) return
		this.device = check.readiness
		this.movedToThisDevice = check.replacedOtherKey
	}

	/** The live list, with event details (falling back to saved ones). */
	private async readLive(
		saved: WalletSnapshot | undefined,
		signal: AbortSignal,
	): Promise<WalletEventGroup[]> {
		const tickets = (await this.ticketClient.list(signal)).map(
			walletTicketFromProto,
		)
		const savedEvents = new Map(
			(saved?.groups ?? []).flatMap((g) =>
				g.event ? [[g.eventId, g.event] as const] : [],
			),
		)
		const eventIds = [...new Set(tickets.map((t) => t.eventId))]
		const events = new Map<string, EventPageEvent>()
		await Promise.all(
			eventIds.map(async (id) => {
				try {
					const event = eventFromConcert(
						await this.concertClient.get(id, signal),
					)
					if (event) events.set(id, event)
				} catch (err) {
					this.logger.warn('Event read failed', { eventId: id, error: err })
				}
				const fallback = savedEvents.get(id)
				if (!events.has(id) && fallback) events.set(id, fallback)
			}),
		)
		return groupByEvent(tickets, events)
	}

	/** The fan's listings; on a failed read the last ones are kept. */
	private async readListings(signal: AbortSignal): Promise<void> {
		try {
			this.listings = await this.resaleClient.list(signal)
		} catch (err) {
			if (!signal.aborted) {
				this.logger.warn('Resale listings read failed', { error: err })
			}
		}
	}

	/**
	 * Each ticket's TicketStock and seat type, from its Order (OrderService.Get)
	 * and its event's stocks (TicketSaleService.ListByEvent), and each stock's
	 * resale: whether it is open and the price a listing would have. A ticket
	 * whose stock cannot be read keeps the seat type saved for it, if any, and
	 * offers no listing.
	 */
	private async readStocks(
		groups: readonly WalletEventGroup[],
		saved: WalletSnapshot | undefined,
		signal: AbortSignal,
	): Promise<WalletEventGroup[]> {
		const savedTickets = new Map(
			(saved?.groups ?? []).flatMap((g) => g.tickets.map((t) => [t.id, t])),
		)
		const resale = new Map<string, StockResale>()
		const orderIds = [
			...new Set(groups.flatMap((g) => g.tickets.map((t) => t.orderId))),
		].filter((id) => id)
		const stockByOrder = new Map<string, string>()
		const seatTypeByStock = new Map<string, string>()
		await Promise.all([
			...orderIds.map(async (id) => {
				try {
					const order = await this.orderClient.get(id, signal)
					const stockId = order.ticketStockId?.value
					if (stockId) stockByOrder.set(id, stockId)
				} catch (err) {
					if (!signal.aborted) {
						this.logger.warn('Order read failed', { orderId: id, error: err })
					}
				}
			}),
			...groups.map(async (g) => {
				try {
					const { stocks } = await this.saleClient.listByEvent(
						g.eventId,
						signal,
					)
					for (const stock of stocks) {
						seatTypeByStock.set(stock.id, stock.seatTypeName)
						resale.set(stock.id, {
							open: stock.resaleOpen,
							price: stock.price,
						})
					}
				} catch (err) {
					if (!signal.aborted) {
						this.logger.warn('Sales read failed', {
							eventId: g.eventId,
							error: err,
						})
					}
				}
			}),
		])
		this.resaleByStock = resale
		return groups.map((g) => ({
			...g,
			tickets: g.tickets.map((t) => {
				const stockId = stockByOrder.get(t.orderId)
				const seatTypeName = stockId ? seatTypeByStock.get(stockId) : undefined
				const before = savedTickets.get(t.id)
				return {
					...t,
					ticketStockId: stockId ?? before?.ticketStockId,
					seatTypeName: seatTypeName ?? before?.seatTypeName,
				}
			}),
		}))
	}

	private showSnapshot(saved: WalletSnapshot): void {
		this.groups = [...saved.groups]
		this.listings = [...(saved.listings ?? [])]
		this.offline = true
		this.savedAt = saved.savedAt
		this.savedPersonalDetails = saved?.personalDetails ?? null
		this.step = saved.groups.length === 0 ? 'empty' : 'loaded'
	}

	/**
	 * The eligible person on every ticket face: the fan's full name and phone
	 * number as their User records them now, or, before the User is read
	 * (offline), as they were saved with the list.
	 */
	public get personalDetails(): WalletPersonalDetails | null {
		const user = this.userStore.current
		if (!user) return this.savedPersonalDetails
		return {
			fullName: user.fullName ?? '',
			phoneNumber: user.phoneNumber ?? '',
		}
	}

	private saveSnapshot(): void {
		const personalDetails = this.personalDetails
		void this.wallet.saveSnapshot<WalletSnapshot>({
			savedAt: new Date(),
			groups: this.groups,
			listings: this.listings,
			...(personalDetails ? { personalDetails } : {}),
		})
	}

	// ── Entry device ─────────────────────────────────────────────────────────

	/**
	 * Whether to offer moving the entry QR code here: only on a device that is
	 * not the entry device, and only with a connection.
	 */
	public get canOfferMove(): boolean {
		return this.device === 'other-device' && !this.offline
	}

	/** Offer to move the entry QR code to this device (asks first). */
	public askToUseThisDevice(): void {
		if (!this.canOfferMove) return
		this.moveFailed = false
		this.confirmingMove = true
	}

	public cancelMove(): void {
		this.confirmingMove = false
	}

	/**
	 * The fan confirmed: register this device's key, replacing the other
	 * device's, so codes from the other device stop working.
	 */
	public async confirmUseThisDevice(): Promise<void> {
		if (this.moving) return
		this.moving = true
		try {
			const result = await this.wallet.useThisDevice(
				this.abortController?.signal,
			)
			this.device = result.readiness
			this.movedToThisDevice = result.replacedOtherKey
			this.moveFailed = result.failed === true
			if (!result.failed) this.confirmingMove = false
		} finally {
			this.moving = false
		}
	}

	// ── Admission code ───────────────────────────────────────────────────────

	/** Whether a group offers the admission code (it has a not-yet-entered ticket). */
	public offersCode(group: WalletEventGroup): boolean {
		return enterableTickets(group).length > 0
	}

	public get canShowCode(): boolean {
		return this.device === 'ready'
	}

	public get headCount(): number {
		return this.presented.length
	}

	/** The QR image of the current code, or empty when none may be shown. */
	public get codeImage(): string {
		const text = this.session.text
		return text ? admissionQrDataUrl(text) : ''
	}

	public get isCodeOpen(): boolean {
		return this.codeGroup !== null
	}

	/** Open the code for a group, presenting every enterable ticket (up to 10). */
	public openCode(group: WalletEventGroup): void {
		if (!this.canShowCode || !this.offersCode(group)) return
		this.codeGroup = group
		this.presented = presentedTickets(group)
		void this.session.start(this.presentedIds())
		void this.wakeLock.acquire()
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		this.startPolling()
	}

	private presentedIds(): string[] {
		return this.presented.map((t) => t.id)
	}

	/** Close the code: withdraw it, let the display sleep again. */
	public closeCode(): void {
		if (this.codeGroup === null) return
		this.codeGroup = null
		this.presented = []
		this.session.stop()
		void this.wakeLock.release()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.stopPolling()
	}

	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState === 'visible') void this.session.check()
	}

	private signFor(
		ticketIds: readonly string[],
		signTime: number,
	): Promise<string> {
		const group = this.codeGroup
		const ticket = group?.tickets.find((t) => ticketIds.includes(t.id))
		if (!group || !ticket) {
			return Promise.reject(new Error('no ticket to present'))
		}
		return this.wallet.signCode({
			userId: ticket.userId,
			eventId: group.eventId,
			ticketIds,
			signTime,
		})
	}

	// ── Admission while the code is shown ────────────────────────────────────

	private startPolling(): void {
		this.stopPolling()
		this.pollTimer = setInterval(
			() => void this.refreshStates(),
			ADMISSION_POLL_MS,
		)
	}

	private stopPolling(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	/**
	 * Re-read ticket states while the code is shown. Admitted tickets turn
	 * 入場済み and leave the code; without a connection nothing changes.
	 */
	public async refreshStates(): Promise<void> {
		const signal = this.abortController?.signal
		let tickets: WalletTicket[]
		try {
			tickets = (await this.ticketClient.list(signal)).map(
				walletTicketFromProto,
			)
		} catch {
			return
		}
		if (signal?.aborted) return
		const byId = new Map(tickets.map((t) => [t.id, t]))
		this.groups = this.groups.map((g) => ({
			...g,
			tickets: g.tickets.map((t) => byId.get(t.id) ?? t),
		}))
		this.offline = false
		this.savedAt = null
		this.saveSnapshot()

		if (this.codeGroup) {
			const eventId = this.codeGroup.eventId
			this.codeGroup =
				this.groups.find((g) => g.eventId === eventId) ?? this.codeGroup
			const before = this.presentedIds().join()
			this.presented = presentedTickets(this.codeGroup)
			// Admitted tickets leave the code: remake it for the rest at once.
			if (this.presentedIds().join() !== before) {
				void this.session.setTickets(this.presentedIds())
			}
		}
	}

	// ── Official resale (公式リセール) ────────────────────────────────────────

	// The template passes the state these read (listings, resaleByStock,
	// offline, resaleMessage) as arguments: a binding to a method call is
	// re-evaluated only when its arguments change, not when the method reads
	// another property.

	/** The ticket's state as shown, with its listing taken into account. */
	public shownState(
		ticket: WalletTicket,
		listings: readonly ResaleListing[] = this.listings,
	): ShownTicketState {
		return shownState(ticket, listings)
	}

	/** The ticket's Listed or Sold listing, if any. */
	public listingOf(
		ticket: WalletTicket,
		listings: readonly ResaleListing[] = this.listings,
	): ResaleListing | null {
		return listingOf(ticket, listings)
	}

	/** Whether the ticket can be listed: 未入場, online, and its stock's resale open. */
	public offersListing(
		ticket: WalletTicket,
		listings: readonly ResaleListing[] = this.listings,
		resaleByStock: ReadonlyMap<string, StockResale> = this.resaleByStock,
		offline: boolean = this.offline,
	): boolean {
		return (
			!offline &&
			shownState(ticket, listings) === 'not-entered' &&
			ticket.ticketStockId !== undefined &&
			resaleByStock.get(ticket.ticketStockId)?.open === true
		)
	}

	/**
	 * Whether to say that official resale opens only when the seat type sells
	 * out for the event: online, before admission opens, with a 未入場 ticket
	 * whose stock is read and not open for resale.
	 */
	public explainsNoResale(
		group: WalletEventGroup,
		listings: readonly ResaleListing[] = this.listings,
		resaleByStock: ReadonlyMap<string, StockResale> = this.resaleByStock,
		offline: boolean = this.offline,
	): boolean {
		const start = group.event?.startTime
		return (
			!offline &&
			start !== undefined &&
			Date.now() < resaleDeadline(start).getTime() &&
			group.tickets.some((t) => {
				if (shownState(t, listings) !== 'not-entered') return false
				const resale = t.ticketStockId
					? resaleByStock.get(t.ticketStockId)
					: undefined
				return resale !== undefined && !resale.open
			})
		)
	}

	/** The price a listing of the ticket would have: its seat type's, in yen. */
	public listingPrice(ticket: WalletTicket | null): number {
		const stockId = ticket?.ticketStockId
		return stockId ? (this.resaleByStock.get(stockId)?.price ?? 0) : 0
	}

	/** The resale fee of a price: 10%, rounded down to the yen. */
	public listingFee(price: number): number {
		return Math.floor((price * RESALE_FEE_PERCENT) / 100)
	}

	/** When listing closes for the group's event: when admission opens. */
	public listingDeadlineLabel(group: WalletEventGroup | null): string {
		const start = group?.event?.startTime
		return start
			? formatSaleStart(resaleDeadline(start), this.userStore.currentLanguage)
			: ''
	}

	/** Open the confirmation before listing one ticket. */
	public askToList(group: WalletEventGroup, ticket: WalletTicket): void {
		if (!this.offersListing(ticket)) return
		this.resaleMessage = null
		this.listingGroup = group
		this.listingTicket = ticket
	}

	public cancelListing(): void {
		this.listingGroup = null
		this.listingTicket = null
	}

	public get isListingOpen(): boolean {
		return this.listingTicket !== null
	}

	/** The fan confirmed: list that one ticket. */
	public async confirmListing(): Promise<void> {
		const ticket = this.listingTicket
		if (!ticket || this.resaleBusy) return
		this.resaleBusy = true
		try {
			const listing = await this.resaleClient.create(
				ticket.id,
				this.abortController?.signal,
			)
			this.listings = [listing, ...this.listings]
			this.saveSnapshot()
			this.cancelListing()
		} catch (err) {
			this.logger.warn('Listing failed', { ticketId: ticket.id, error: err })
			this.resaleMessage = {
				ticketId: ticket.id,
				key:
					ConnectError.from(err).code === Code.FailedPrecondition
						? 'tickets.resale.cannotList'
						: 'tickets.resale.failed',
			}
			this.cancelListing()
		} finally {
			this.resaleBusy = false
		}
	}

	/** Take back the ticket's listing. */
	public async withdraw(ticket: WalletTicket): Promise<void> {
		const listing = this.listingOf(ticket)
		if (!listing || listing.status !== 'listed' || this.resaleBusy) return
		this.resaleBusy = true
		this.resaleMessage = null
		try {
			const withdrawn = await this.resaleClient.withdraw(
				listing.id,
				this.abortController?.signal,
			)
			this.listings = this.listings.map((l) =>
				l.id === withdrawn.id ? withdrawn : l,
			)
			this.saveSnapshot()
		} catch (err) {
			this.logger.warn('Withdraw failed', { listingId: listing.id, error: err })
			const closed = ConnectError.from(err).code === Code.FailedPrecondition
			this.resaleMessage = {
				ticketId: ticket.id,
				key: closed ? 'tickets.resale.withdrawClosed' : 'tickets.resale.failed',
			}
			// The listing was sold or listing closed: show it as it is now.
			if (closed && this.abortController) {
				await this.readListings(this.abortController.signal)
				this.saveSnapshot()
			}
		} finally {
			this.resaleBusy = false
		}
	}

	/** The message of the last listing call for this ticket, if any. */
	public resaleMessageFor(
		ticket: WalletTicket,
		message: { ticketId: string; key: string } | null = this.resaleMessage,
	): string | null {
		return message?.ticketId === ticket.id ? message.key : null
	}

	/** A yen amount with thousands separators, e.g. "4,500". */
	public yen(amount: number): string {
		return amount.toLocaleString('ja-JP')
	}

	/** A date as month/day in Japan time, e.g. "11/14". */
	public day(value: Date | undefined): string {
		if (!value) return ''
		return new Intl.DateTimeFormat(this.userStore.currentLanguage, {
			timeZone: 'Asia/Tokyo',
			month: 'numeric',
			day: 'numeric',
		}).format(value)
	}

	// ── Labels ───────────────────────────────────────────────────────────────

	/** The ticket's 1-based position within its event, as shown on its card. */
	public ticketNumber(group: WalletEventGroup, ticket: WalletTicket): number {
		return group.tickets.findIndex((t) => t.id === ticket.id) + 1
	}

	/** The fan's phone number as a fan in Japan writes it. */
	public get phoneNumberDisplay(): string {
		return this.personalDetails?.phoneNumber
			? toDomesticDisplay(this.personalDetails.phoneNumber)
			: ''
	}

	public stateLabel(
		ticket: WalletTicket,
		listings: readonly ResaleListing[] = this.listings,
	): string {
		return this.i18n.tr(`tickets.state.${shownState(ticket, listings)}`)
	}

	public eventDate(group: WalletEventGroup): string {
		return group.event
			? formatEventDate(group.event, this.userStore.currentLanguage)
			: ''
	}

	public time(value: Date | null | undefined): string {
		return value ? formatEventTime(value) : ''
	}

	/** Admitted time as month/day and time in Japan time, e.g. "11/20 18:32". */
	public admitted(ticket: WalletTicket): string {
		if (!ticket.admitTime) return ''
		return new Intl.DateTimeFormat(this.userStore.currentLanguage, {
			timeZone: 'Asia/Tokyo',
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		}).format(ticket.admitTime)
	}

	public savedAtLabel(): string {
		if (!this.savedAt) return ''
		return new Intl.DateTimeFormat(this.userStore.currentLanguage, {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		}).format(this.savedAt)
	}
}
