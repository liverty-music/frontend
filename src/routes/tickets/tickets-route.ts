import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { ITicketRpcClient } from '../../adapter/rpc/client/ticket-client'

/**
 * Discrete UI phases of the My Tickets view.
 *   - `loading`  — the initial `getMyTickets` round-trip is in flight.
 *   - `empty`    — the caller has no issued tickets.
 *   - `error`    — the load failed; `error` carries the message copy.
 *   - `loaded`   — tickets are present; `tickets` drives the render.
 */
export type TicketsViewStep = 'loading' | 'empty' | 'error' | 'loaded'

/**
 * Plain view model for a single issued ticket. Proto objects are mapped
 * here — the template does not leak proto API calls.
 */
export interface TicketView {
	id: string
	// TODO(tickets): resolve event title once a fan-facing event-read RPC exists.
	eventId: string
	/** The order that issued this ticket; used to link to the Order detail route. */
	orderId: string
	holderName: string
	holderPhone: string
	issuedAt: Date | null
	/** True when the ticket is active (発券済み). */
	isIssued: boolean
	/** True when the ticket has been voided (無効). */
	isVoided: boolean
	/** Whether resale without the organizer's consent is prohibited. */
	resaleWithoutConsentProhibited: boolean
}

/**
 * Fan-facing My Tickets route (roadmap ⑤, task 5.1).
 * Loads the caller's account-bound covered tickets issued from captured
 * lottery wins and renders them with:
 *   - event context (eventId; title deferred — see TODO above),
 *   - holder 本人確認 details (name, phone),
 *   - issued date,
 *   - status badge (発券済み / 無効),
 *   - 特定興行入場券 resale-prohibition notice.
 *
 * Voided tickets are visually de-emphasised in the template.
 */
export class TicketsRoute {
	// ── View state ────────────────────────────────────────────────────────────
	public step: TicketsViewStep = 'loading'
	public error = ''
	public tickets: TicketView[] = []

	private readonly logger = resolve(ILogger).scopeTo('TicketsRoute')
	private readonly ticketClient = resolve(ITicketRpcClient)
	private abortController: AbortController | null = null

	public loading(): void {
		// Abort any stale in-flight request so it can never write into a new
		// activation of this VM instance.
		this.abortController?.abort()
		this.abortController = new AbortController()
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	/**
	 * Fetches the caller's tickets. Empty list → `empty`; any non-abort
	 * failure → `error`. On success the flat display objects are populated
	 * and the step flips to `loaded`.
	 */
	public async load(): Promise<void> {
		this.step = 'loading'
		this.error = ''
		try {
			const raw = await this.ticketClient.getMyTickets(
				this.abortController?.signal,
			)
			if (raw.length === 0) {
				this.step = 'empty'
				return
			}
			this.tickets = raw.map((t) => this.toView(t))
			this.step = 'loaded'
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('getMyTickets failed', { error: err })
			this.error =
				'チケット情報の読み込みに失敗しました。時間をおいて再度お試しください。'
			this.step = 'error'
		}
	}

	// ── Derived / mapping helpers ─────────────────────────────────────────────

	/**
	 * Map a proto Ticket message to a plain TicketView. Keeps all proto API
	 * calls confined to the VM so the template stays free of proto concepts.
	 */
	private toView(t: Ticket): TicketView {
		return {
			id: t.id?.value ?? '',
			eventId: t.eventId?.value ?? '',
			orderId: t.orderId?.value ?? '',
			holderName: t.holderIdentity?.fullName ?? '',
			holderPhone: t.holderIdentity?.phoneNumber ?? '',
			issuedAt: t.issuedAt ? timestampDate(t.issuedAt) : null,
			isIssued: t.status === TicketStatus.ISSUED,
			isVoided: t.status === TicketStatus.VOIDED,
			resaleWithoutConsentProhibited: t.resaleWithoutConsentProhibited,
		}
	}

	/**
	 * Japanese label for the ticket status badge displayed in the template.
	 */
	public statusLabel(ticket: TicketView): string {
		if (ticket.isIssued) return '発券済み'
		if (ticket.isVoided) return '無効'
		return '—'
	}

	/**
	 * Formats an issued date to a readable Japanese locale string, or `—`
	 * when unavailable.
	 */
	public formatDate(date: Date | null): string {
		if (!date) return '—'
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		})
	}
}
