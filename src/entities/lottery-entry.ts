/**
 * Lifecycle state of a fan's lottery entry.
 *
 * - `draft`     — started; the card authorization is not confirmed yet, so
 *                 it takes no part in the draw.
 * - `entered`   — entered, awaiting the draw (card authorized). An entry
 *                 cannot be withdrawn.
 * - `won`       — drawn; the card authorization was captured (charged).
 * - `lost`      — not drawn; the card authorization was released.
 * - `unknown`   — a state this app does not know.
 *
 * @source proto/liverty_music/entity/v1/lottery_entry.proto — LotteryEntryState
 */
export type LotteryEntryState = 'draft' | 'entered' | 'won' | 'lost' | 'unknown'

/**
 * A fan's entry to a lottery TicketType.
 *
 * @source proto/liverty_music/entity/v1/lottery_entry.proto — LotteryEntry
 */
export interface LotteryEntry {
	readonly id: string
	readonly ticketTypeId: string
	/** How many tickets the entry asks for (the companion group's size). */
	readonly ticketCount: number
	readonly state: LotteryEntryState
}
