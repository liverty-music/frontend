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

/** Presentation metadata for a single journey status. */
export interface JourneyStatusConfig {
	status: JourneyStatus
	/** i18n key for the human label (reuses the existing detail-sheet keys). */
	labelKey: string
	/** Emoji glyph shown alongside the label as a non-colour cue. */
	icon: string
	/** CSS custom property holding the status's semantic hue. */
	hueToken: string
}

/**
 * Canonical journey-status presentation map: the single source of truth for the
 * label, icon, and semantic hue of each status, consumed by the dashboard filter
 * chips, the concert-card badge, and the concert-detail status control, so a
 * status's visual identity is consistent app-wide. Ordered in journey-flow order
 * (process then outcome) so consumers can iterate it directly.
 */
export const JOURNEY_STATUS_CONFIG: readonly JourneyStatusConfig[] = [
	{
		status: 'tracking',
		labelKey: 'eventDetail.journeyStatus.tracking',
		icon: '👀',
		hueToken: '--journey-hue-tracking',
	},
	{
		status: 'applied',
		labelKey: 'eventDetail.journeyStatus.applied',
		icon: '📝',
		hueToken: '--journey-hue-applied',
	},
	{
		status: 'unpaid',
		labelKey: 'eventDetail.journeyStatus.unpaid',
		icon: '💰',
		hueToken: '--journey-hue-unpaid',
	},
	{
		status: 'paid',
		labelKey: 'eventDetail.journeyStatus.paid',
		icon: '🎟️',
		hueToken: '--journey-hue-paid',
	},
	{
		status: 'lost',
		labelKey: 'eventDetail.journeyStatus.lost',
		icon: '💔',
		hueToken: '--journey-hue-lost',
	},
]

/** Status → presentation config, for O(1) per-status lookup in components. */
export const JOURNEY_STATUS_CONFIG_MAP: Record<
	JourneyStatus,
	JourneyStatusConfig
> = Object.fromEntries(
	JOURNEY_STATUS_CONFIG.map((config) => [config.status, config]),
) as Record<JourneyStatus, JourneyStatusConfig>

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

/** Type guard: whether an arbitrary string is a valid journey status. */
export function isJourneyStatus(value: string): value is JourneyStatus {
	return (JOURNEY_NAV_ORDER as readonly string[]).includes(value)
}

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
