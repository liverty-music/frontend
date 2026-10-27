/**
 * What currently stops a User's account from being deleted, by kind, with how
 * many there are (OpenSpec change `delete-fan-accounts`, design D1). The
 * account can be deleted once none is left.
 */
export type DeletionBlockerKind =
	/** An Issued Ticket for an event whose date (Japan time) is today or later. */
	| 'upcomingTicket'
	/** A resale listing still Listed. */
	| 'listedResale'
	/** A lottery entry still awaiting its draw. */
	| 'pendingLotteryEntry'
	/** A checkout still being paid. */
	| 'paymentInProgress'
	/** A kind this app does not know yet (a newer server). */
	| 'other'

export interface DeletionBlocker {
	readonly kind: DeletionBlockerKind
	readonly count: number
}
