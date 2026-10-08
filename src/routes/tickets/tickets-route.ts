import { I18N } from '@aurelia/i18n'
import { ILogger, resolve } from 'aurelia'
import { IScreenWakeLock } from '../../adapter/browser/screen-wake-lock'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { ITicketRpcClient } from '../../adapter/rpc/client/ticket-client'
import { MAX_TICKETS_PER_CODE } from '../../lib/admission-code/admission-code'
import { admissionQrDataUrl } from '../../lib/admission-code/qr-svg'
import { ITicketWallet } from '../../services/ticket-wallet'
import { IUserStore } from '../../services/user-store'
import {
	type EventPageEvent,
	eventFromProto,
	formatEventDate,
	formatEventTime,
} from '../event/event-page'
import { EntryCodeSession } from './entry-code-session'
import {
	defaultSelection,
	enterableTickets,
	groupByEvent,
	type WalletEventGroup,
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
 * plus `checking` while it is being prepared.
 */
export type DeviceState = 'checking' | 'ready' | 'needs-connection' | 'failed'

/** While a code is shown and online, look for admissions this often. */
export const ADMISSION_POLL_MS = 5000

/**
 * The fan's tickets screen (`/tickets`): tickets grouped by event with their
 * covered-ticket face and state, and the entry QR code the device makes for
 * the tickets entering together.
 *
 * - The last loaded list is saved on the device and shown at once on the next
 *   visit, so it stays viewable without a connection.
 * - On an online visit the device is prepared (key pair created when missing,
 *   public key registered); offline, the code works only once that happened.
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

	// ── List state ───────────────────────────────────────────────────────────
	public step: TicketsViewStep = 'loading'
	public groups: WalletEventGroup[] = []
	/** True while the list shown is the saved one (no connection). */
	public offline = false
	/** When the saved list was loaded, when `offline`. */
	public savedAt: Date | null = null

	// ── Device state ─────────────────────────────────────────────────────────
	public device: DeviceState = 'checking'
	/** Registering on this visit moved the fan's key here from another device. */
	public movedToThisDevice = false

	// ── Entry code state ─────────────────────────────────────────────────────
	public codeGroup: WalletEventGroup | null = null
	/** Ticket ids ticked for the code, in the fan's order. */
	public selectedIds: string[] = []
	public readonly session = new EntryCodeSession((ticketIds, signTime) =>
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
	 * the list and prepares the device; a failed one keeps the saved list.
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
			live = await this.readLive(saved, signal)
		} catch (err) {
			if (signal.aborted) return
			this.logger.warn('Tickets read failed', { error: err })
			if (saved) {
				this.showSnapshot(saved)
			} else {
				this.step = 'error'
			}
			const prepared = await this.wallet.prepareDevice(false)
			if (signal.aborted) return
			this.device = prepared.readiness
			return
		}
		if (signal.aborted) return
		this.groups = live
		this.offline = false
		this.savedAt = null
		this.step = live.length === 0 ? 'empty' : 'loaded'
		void this.wallet.saveSnapshot<WalletSnapshot>({
			savedAt: new Date(),
			groups: live,
		})

		const prepared = await this.wallet.prepareDevice(true, signal)
		if (signal.aborted) return
		this.device = prepared.readiness
		this.movedToThisDevice = prepared.replacedOtherKey
	}

	/** The live list, with event details (falling back to saved ones). */
	private async readLive(
		saved: WalletSnapshot | undefined,
		signal: AbortSignal,
	): Promise<WalletEventGroup[]> {
		const tickets = (await this.ticketClient.getMyTickets(signal)).map(
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
					const event = eventFromProto(await this.concertClient.get(id, signal))
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

	private showSnapshot(saved: WalletSnapshot): void {
		this.groups = [...saved.groups]
		this.offline = true
		this.savedAt = saved.savedAt
		this.step = saved.groups.length === 0 ? 'empty' : 'loaded'
	}

	// ── Entry code ───────────────────────────────────────────────────────────

	/** Whether a group offers the entry code (it has a not-yet-entered ticket). */
	public offersCode(group: WalletEventGroup): boolean {
		return enterableTickets(group).length > 0
	}

	public enterable(group: WalletEventGroup): WalletTicket[] {
		return enterableTickets(group)
	}

	public get canShowCode(): boolean {
		return this.device === 'ready'
	}

	public get headCount(): number {
		return this.selectedIds.length
	}

	/** The QR image of the current code, or empty when none may be shown. */
	public get codeImage(): string {
		const text = this.session.text
		return text ? admissionQrDataUrl(text) : ''
	}

	public get isCodeOpen(): boolean {
		return this.codeGroup !== null
	}

	/** Open the code for a group with every enterable ticket (up to 10) ticked. */
	public openCode(group: WalletEventGroup): void {
		if (!this.canShowCode || !this.offersCode(group)) return
		this.codeGroup = group
		this.selectedIds = defaultSelection(group)
		void this.session.start(this.selectedIds)
		void this.wakeLock.acquire()
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		this.startPolling()
	}

	public isSelected(ticketId: string): boolean {
		return this.selectedIds.includes(ticketId)
	}

	/** A ticket can be ticked unless 10 already are. */
	public canSelect(ticketId: string): boolean {
		return (
			this.isSelected(ticketId) ||
			this.selectedIds.length < MAX_TICKETS_PER_CODE
		)
	}

	/** Tick or untick a ticket: the code is remade at once for the new set. */
	public toggle(ticketId: string, ticked: boolean): void {
		const without = this.selectedIds.filter((id) => id !== ticketId)
		if (ticked && this.canSelect(ticketId)) without.push(ticketId)
		this.selectedIds = without
		this.selectionChanged()
	}

	private selectionChanged(): void {
		void this.session.setTickets(this.selectedIds)
	}

	/** Close the code: withdraw it, let the display sleep again. */
	public closeCode(): void {
		if (this.codeGroup === null) return
		this.codeGroup = null
		this.selectedIds = []
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
		const holder = group?.tickets.find((t) => ticketIds.includes(t.id))
		if (!group || !holder) {
			return Promise.reject(new Error('no ticket to present'))
		}
		return this.wallet.signCode({
			userId: holder.holderId,
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
			tickets = (await this.ticketClient.getMyTickets(signal)).map(
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
		void this.wallet.saveSnapshot<WalletSnapshot>({
			savedAt: new Date(),
			groups: this.groups,
		})

		if (this.codeGroup) {
			const eventId = this.codeGroup.eventId
			this.codeGroup =
				this.groups.find((g) => g.eventId === eventId) ?? this.codeGroup
			const stillEnterable = this.selectedIds.filter(
				(id) => byId.get(id)?.state === 'not-entered' || !byId.has(id),
			)
			if (stillEnterable.length !== this.selectedIds.length) {
				this.selectedIds = stillEnterable
				this.selectionChanged()
			}
		}
	}

	// ── Labels ───────────────────────────────────────────────────────────────

	/** The ticket's 1-based position within its event, as shown on its card. */
	public ticketNumber(group: WalletEventGroup, ticket: WalletTicket): number {
		return group.tickets.findIndex((t) => t.id === ticket.id) + 1
	}

	public stateLabel(ticket: WalletTicket): string {
		return this.i18n.tr(`tickets.state.${ticket.state}`)
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
