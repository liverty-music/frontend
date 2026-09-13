import type { Order } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { OrderStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { ITicketRpcClient } from '../../adapter/rpc/client/ticket-client'

/**
 * Discrete UI phases of the Order detail view.
 *   - `loading`   — the initial round-trips are in flight.
 *   - `notfound`  — the order does not belong to the caller (non-revealing).
 *   - `error`     — the load failed; `error` carries the message copy.
 *   - `loaded`    — the order + its tickets are present; drives the render.
 */
export type OrderViewStep = 'loading' | 'notfound' | 'error' | 'loaded'

/**
 * The visual bucket for order status used by the template. Derived from
 * `OrderStatus`:
 *   - `paid`      — ORDER_STATUS_PAID (normal, tickets issued)
 *   - `refunded`  — ORDER_STATUS_REFUNDED (event cancelled / refund issued)
 *   - `failed`    — ORDER_STATUS_FAILED (issuance failed, refunded automatically)
 */
export type OrderStatusKind = 'paid' | 'refunded' | 'failed' | 'unknown'

/**
 * Plain view model for the order's payment details. Proto objects are mapped
 * here — the template does not leak proto API calls.
 */
export interface OrderView {
	id: string
	statusKind: OrderStatusKind
	/** Formatted total amount e.g. "¥10,000" */
	amountFormatted: string
	/** E.g. "JPY" */
	currency: string
	/** Displayable card brand, e.g. "visa" — empty string when unavailable. */
	cardBrand: string
	/** Last four digits of the card — empty string when unavailable. */
	cardLast4: string
	paidAt: Date | null
}

/**
 * Plain view model for a single issued ticket colocated with this order.
 * Mirrors TicketView in tickets-route so the two presentations stay consistent
 * without extracting a shared component this pass.
 * TODO(refactor): extract shared ticket-card component used by both routes.
 */
export interface OrderTicketView {
	id: string
	// TODO(tickets): resolve event title once a fan-facing event-read RPC exists.
	eventId: string
	holderName: string
	holderPhone: string
	issuedAt: Date | null
	isIssued: boolean
	isVoided: boolean
	resaleWithoutConsentProhibited: boolean
}

/**
 * Fan-facing Order detail route (roadmap ⑤, §5.1 + §5.2).
 *
 * Loads the caller's order identified by `orderId` from the URL and
 * its associated issued covered tickets, then renders:
 *   - **§5.1 Payment result**: tax-inclusive (税込) total, payment status
 *     (支払済み / 返金済み / 失敗), card brand + •••• last4, paid date.
 *   - **§5.1 Issued tickets**: per-ticket holder name, issued date, status,
 *     特定興行入場券 resale-prohibition notice. Voided tickets de-emphasised.
 *   - **§5.2 Refund/cancellation status**: prominent 返金済み banner when
 *     ORDER_STATUS_REFUNDED; distinct 失敗 state when ORDER_STATUS_FAILED.
 *
 * Note: `Order.amount` is a bigint (proto int64 in JPY). It is safely
 * converted to Number for display (JPY yen values fit within Number.MAX_SAFE_INTEGER).
 */
export class OrderRoute {
	// ── Route params ──────────────────────────────────────────────────────────
	public orderId = ''

	// ── View state ────────────────────────────────────────────────────────────
	public step: OrderViewStep = 'loading'
	public error = ''
	public order: OrderView | null = null
	public tickets: OrderTicketView[] = []

	private readonly logger = resolve(ILogger).scopeTo('OrderRoute')
	private readonly ticketClient = resolve(ITicketRpcClient)
	private abortController: AbortController | null = null

	public loading(params: Params): void {
		if (params.orderId) this.orderId = String(params.orderId)
		// Abort any stale in-flight request so it can never write into a new
		// activation of this VM instance (params-only re-navigation).
		this.abortController?.abort()
		this.abortController = new AbortController()
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	/**
	 * Fetches the order and all caller tickets, filtering to this order's issued
	 * tickets. NotFound → `notfound`; any other non-abort failure → `error`.
	 * On success the view objects are populated and step flips to `loaded`.
	 */
	public async load(): Promise<void> {
		this.step = 'loading'
		this.error = ''
		try {
			// Fetch order and tickets in parallel to minimize latency.
			const [rawOrder, allTickets] = await Promise.all([
				this.ticketClient.getOrder(this.orderId, this.abortController?.signal),
				this.ticketClient.getMyTickets(this.abortController?.signal),
			])
			this.order = this.toOrderView(rawOrder)
			this.tickets = allTickets
				.filter((t) => t.orderId?.value === this.orderId)
				.map((t) => this.toTicketView(t))
			this.step = 'loaded'
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				// Non-revealing: the order either does not exist or does not belong
				// to the caller. Show a generic "not found" state.
				this.step = 'notfound'
				return
			}
			this.logger.error('getOrder / getMyTickets failed', { error: err })
			this.error =
				'注文情報の読み込みに失敗しました。時間をおいて再度お試しください。'
			this.step = 'error'
		}
	}

	// ── Derived / mapping helpers ─────────────────────────────────────────────

	private toOrderView(o: Order): OrderView {
		return {
			id: o.id?.value ?? '',
			statusKind: this.orderStatusKind(o.status),
			// JPY yen values are whole numbers well within Number.MAX_SAFE_INTEGER.
			amountFormatted: this.formatAmount(Number(o.amount), o.currency),
			currency: o.currency,
			cardBrand: o.payment?.cardBrand ?? '',
			cardLast4: o.payment?.cardLast4 ?? '',
			paidAt: o.paidAt ? timestampDate(o.paidAt) : null,
		}
	}

	private toTicketView(t: Ticket): OrderTicketView {
		return {
			id: t.id?.value ?? '',
			eventId: t.eventId?.value ?? '',
			holderName: t.holderIdentity?.fullName ?? '',
			holderPhone: t.holderIdentity?.phoneNumber ?? '',
			issuedAt: t.issuedAt ? timestampDate(t.issuedAt) : null,
			isIssued: t.status === TicketStatus.ISSUED,
			isVoided: t.status === TicketStatus.VOIDED,
			resaleWithoutConsentProhibited: t.resaleWithoutConsentProhibited,
		}
	}

	private orderStatusKind(status: OrderStatus): OrderStatusKind {
		// Fail SAFE: only an explicit PAID renders as paid. Anything else —
		// REFUNDED, FAILED, the proto3 zero value ORDER_STATUS_UNSPECIFIED (the
		// decode default for an unset/unknown field), or a future backend status —
		// must NOT render the "支払済み" badge, so an unconfirmed order never looks
		// paid (mirrors the unverified-degrade convention in verified-identity-mapper).
		switch (status) {
			case OrderStatus.PAID:
				return 'paid'
			case OrderStatus.REFUNDED:
				return 'refunded'
			case OrderStatus.FAILED:
				return 'failed'
			default:
				return 'unknown'
		}
	}

	private formatAmount(amount: number, currency: string): string {
		try {
			return new Intl.NumberFormat('ja-JP', {
				style: 'currency',
				currency: currency || 'JPY',
			}).format(amount)
		} catch {
			// Fallback if an unknown currency is passed.
			return `${amount}`
		}
	}

	/**
	 * Japanese label for the order status badge displayed in the template.
	 */
	public get statusLabel(): string {
		switch (this.order?.statusKind) {
			case 'paid':
				return '支払済み'
			case 'refunded':
				return '返金済み'
			case 'failed':
				return '失敗'
			case 'unknown':
				return '状態不明'
			default:
				return '—'
		}
	}

	/**
	 * Japanese label for the ticket status badge.
	 */
	public ticketStatusLabel(ticket: OrderTicketView): string {
		if (ticket.isIssued) return '発券済み'
		if (ticket.isVoided) return '無効'
		return '—'
	}

	/**
	 * Formats a date to a readable Japanese locale string, or `—` when unavailable.
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
