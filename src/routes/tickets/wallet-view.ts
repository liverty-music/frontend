import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { MAX_TICKETS_PER_CODE } from '../../../shared/lib/admission-code/admission-code'
import { type EventPageEvent, todayInJapan } from '../event/event-page'

/**
 * A ticket's state on the tickets screen:
 * - `not-entered` (未入場): Issued and not yet admitted.
 * - `entered` (入場済み): admitted; `admitTime` says when.
 * - `void` (無効): voided by a refund or resale; never offers a QR code.
 */
export type TicketState = 'not-entered' | 'entered' | 'void'

/** One ticket as the screen shows it (and saves it for offline use). */
export interface WalletTicket {
	readonly id: string
	readonly eventId: string
	readonly orderId: string
	/** The User holding the ticket; the AdmissionCode's user. */
	readonly holderId: string
	/** The eligible person's name on the covered-ticket face. */
	readonly holderName: string
	readonly resaleWithoutConsentProhibited: boolean
	readonly state: TicketState
	readonly admitTime: Date | null
}

/** One event and the fan's tickets for it. */
export interface WalletEventGroup {
	readonly eventId: string
	/** The event's details, or null when they could not be read. */
	readonly event: EventPageEvent | null
	readonly tickets: readonly WalletTicket[]
}

/** The tickets list as last loaded, kept on the device for offline use. */
export interface WalletSnapshot {
	readonly savedAt: Date
	readonly groups: readonly WalletEventGroup[]
}

/** Map a proto Ticket to the screen's ticket. */
export function walletTicketFromProto(t: Ticket): WalletTicket {
	const admitTime = t.admitTime ? timestampDate(t.admitTime) : null
	let state: TicketState
	if (t.status === TicketStatus.VOIDED) state = 'void'
	else if (admitTime) state = 'entered'
	else state = 'not-entered'
	return {
		id: t.id?.value ?? '',
		eventId: t.eventId?.value ?? '',
		orderId: t.orderId?.value ?? '',
		holderId: t.holderId?.value ?? '',
		holderName: t.holderIdentity?.fullName ?? '',
		resaleWithoutConsentProhibited: t.resaleWithoutConsentProhibited,
		state,
		admitTime,
	}
}

/** When the event begins: its start time, else its open time, else its date. */
function sortTime(event: EventPageEvent): number {
	return (event.startTime ?? event.openTime ?? event.date).getTime()
}

/**
 * Group tickets by event, nearest event first: upcoming events (today
 * included, in Japan time) soonest first, then past events most recent first,
 * then events whose details are unknown. Tickets keep their order within an
 * event.
 */
export function groupByEvent(
	tickets: readonly WalletTicket[],
	events: ReadonlyMap<string, EventPageEvent>,
	now: Date = new Date(),
): WalletEventGroup[] {
	const byEvent = new Map<string, WalletTicket[]>()
	for (const t of tickets) {
		const list = byEvent.get(t.eventId)
		if (list) list.push(t)
		else byEvent.set(t.eventId, [t])
	}
	const today = todayInJapan(now)
	const groups: WalletEventGroup[] = [...byEvent].map(([eventId, list]) => ({
		eventId,
		event: events.get(eventId) ?? null,
		tickets: list,
	}))
	const rank = (g: WalletEventGroup): number => {
		if (!g.event) return 2
		return g.event.dateKey >= today ? 0 : 1
	}
	return groups.sort((a, b) => {
		const ra = rank(a)
		const rb = rank(b)
		if (ra !== rb) return ra - rb
		if (!a.event || !b.event) return 0
		const diff = sortTime(a.event) - sortTime(b.event)
		return ra === 0 ? diff : -diff
	})
}

/** The tickets of a group that can still enter: Issued, not yet admitted. */
export function enterableTickets(group: WalletEventGroup): WalletTicket[] {
	return group.tickets.filter((t) => t.state === 'not-entered')
}

/** Tickets ticked by default for the entry code: every enterable one, up to 10. */
export function defaultSelection(group: WalletEventGroup): string[] {
	return enterableTickets(group)
		.slice(0, MAX_TICKETS_PER_CODE)
		.map((t) => t.id)
}
