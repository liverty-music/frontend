import type { JourneyStatus } from './concert'

/**
 * The ticket-acquisition journey as a fixed state machine:
 * `tracking → applied → { lost | unpaid → paid }`.
 *
 * This is domain knowledge (the order and branching of the journey), kept here
 * as the single source of truth rather than embedded in a component, so every
 * consumer (detail sheet, future timeline, tests) derives from the same graph.
 */

/** Display state of a single journey node relative to the current status. */
export type JourneyNodeState = 'completed' | 'current' | 'future'

/**
 * Linear focus/navigation order across the branching graph, used for keyboard
 * arrow navigation of the journey radiogroup (DOM order: process then outcome).
 */
export const JOURNEY_NAV_ORDER: readonly JourneyStatus[] = [
	'tracking',
	'applied',
	'unpaid',
	'paid',
	'lost',
]

/** Nodes already passed for each status, per the journey DAG. */
const COMPLETED_BY: Record<JourneyStatus, readonly JourneyStatus[]> = {
	tracking: [],
	applied: ['tracking'],
	lost: ['tracking', 'applied'],
	unpaid: ['tracking', 'applied'],
	paid: ['tracking', 'applied', 'unpaid'],
}

/** Resolve a node's display state relative to the current status. */
export function journeyNodeState(
	node: JourneyStatus,
	current: JourneyStatus | undefined,
): JourneyNodeState {
	if (node === current) return 'current'
	if (current && COMPLETED_BY[current].includes(node)) return 'completed'
	return 'future'
}

/**
 * Which side of the win/lose fork the journey has resolved to. `pending` means
 * no result is recorded yet (before/at application). Single source for the
 * outcome-phase gating and the mutual-exclusivity dimming of the two routes.
 */
export type JourneyOutcome = 'pending' | 'won' | 'lost'

/** Classify the current status into the outcome fork. */
export function journeyOutcome(
	current: JourneyStatus | undefined,
): JourneyOutcome {
	if (current === 'unpaid' || current === 'paid') return 'won'
	if (current === 'lost') return 'lost'
	return 'pending'
}
