/**
 * A soulbound ticket minted for an event.
 * @source proto/liverty_music/entity/v1/ticket.proto — Ticket
 */
export interface Ticket {
	readonly id: string
	readonly eventId: string
	readonly userId: string
	readonly tokenId?: string
	readonly mintTime?: Date
}
