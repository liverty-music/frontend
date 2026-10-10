import type { HolderIdentity } from './holder-identity'

/**
 * Lifecycle state of a single lottery application, as a domain union that mirrors
 * the proto `TicketApplicationState` enum. Kept here (not imported from `@buf/*`)
 * so the fan-facing route depends on domain types only.
 *
 * - `unspecified` — default / never persisted; treated as the waiting bucket.
 * - `applied`     — submitted, awaiting the draw (card held, withdrawable).
 * - `won`         — selected; the authorization was captured (charged).
 * - `lost`        — not selected; the authorization was released.
 * - `withdrawn`   — withdrawn before the draw; the authorization was released.
 */
export type TicketApplicationState =
	| 'unspecified'
	| 'applied'
	| 'won'
	| 'lost'
	| 'withdrawn'

/**
 * A fan's application to a lottery phase, in domain form. Produced by
 * `lottery-mapper` from the proto `TicketApplication`; carries only the fields the
 * fan-facing my-application / result view reads.
 */
export interface TicketApplication {
	/** How many tickets this application requested (companion-group size). */
	requestedTicketCount: number
	/** The 本人確認 bound to the application. */
	identity: HolderIdentity
	/** The application's current lifecycle state (its result once the draw ran). */
	state: TicketApplicationState
}
