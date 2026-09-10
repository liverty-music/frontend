import type { JourneyStatus } from './concert'

/**
 * The kind of ticket-related email a fan imports, as a domain union that mirrors
 * the proto `TicketEmailType` enum. Kept here (not imported from `@buf/*`) so no
 * consumer outside the RPC adapter depends on generated types.
 *
 * - `lottery_info`   — a lottery announcement (sales dates + application URL).
 * - `lottery_result` — a win/loss notification (payment details).
 */
export type TicketEmailType = 'lottery_info' | 'lottery_result'

/**
 * A ticket-related email imported by a fan, in domain form. Produced by
 * `ticket-email-mapper` from the proto `TicketEmail`; timestamps are surfaced as
 * native `Date`s and the id/event references as plain strings so consumers never
 * touch proto wrapper shapes.
 */
export interface TicketEmail {
	/** The record's unique id (empty string when unset). */
	id: string
	/** The event this email is associated with (empty string when unset). */
	eventId: string
	/** Whether this is a lottery announcement or a lottery result. */
	emailType: TicketEmailType
	/** The raw email body as imported (optionally redacted by the user). */
	rawBody: string
	/** Lottery application URL — present only for `lottery_info` emails. */
	applicationUrl?: string
	/** Start of the lottery application window — present only for `lottery_info`. */
	lotteryStart?: Date
	/** End of the lottery application window — present only for `lottery_info`. */
	lotteryEnd?: Date
	/** Payment deadline — present only for a winning `lottery_result`. */
	paymentDeadline?: Date
	/** The ticket-journey status derived from the email, if any. */
	journeyStatus?: JourneyStatus
}
