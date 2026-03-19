import type { Artist } from './artist'

/** Lane type for proximity-based grouping on the dashboard. */
export type LaneType = 'home' | 'nearby' | 'away'

/** Hype level determining which lanes an artist's concerts appear matched in. */
export type HypeLevel = 'watch' | 'home' | 'nearby' | 'away'

/** Ticket journey status reflecting where the user is in the ticket acquisition flow. */
export type JourneyStatus = 'tracking' | 'applied' | 'lost' | 'unpaid' | 'paid'

/**
 * A concert event displayed on the dashboard.
 * @source proto/liverty_music/rpc/concert/v1/concert_service.proto — Concert
 */
export interface Concert {
	// --- mapped from proto ---
	id: string
	artistName: string
	artistId: string
	venueName: string
	locationLabel: string
	adminArea?: string
	date: Date
	startTime: string
	openTime?: string
	title: string
	sourceUrl: string

	// --- UI-only ---
	hypeLevel: HypeLevel
	matched: boolean
	artist?: Artist
	journeyStatus?: JourneyStatus
}

/** A group of concerts for a single date, split by proximity lane. */
export interface DateGroup {
	label: string
	dateKey: string
	home: Concert[]
	nearby: Concert[]
	away: Concert[]
}

/** Ordinal ranking of hype levels (higher = willing to travel farther). */
export const HYPE_ORDER: Record<HypeLevel, number> = {
	watch: 0,
	home: 1,
	nearby: 2,
	away: 3,
}

/** Ordinal ranking of proximity lanes. */
export const LANE_ORDER: Record<LaneType, number> = {
	home: 1,
	nearby: 2,
	away: 3,
}

/**
 * Determine whether a hype level qualifies a concert for display in a lane.
 * A hype level matches a lane when its ordinal is >= the lane's ordinal.
 */
export function isHypeMatched(hype: HypeLevel, lane: LaneType): boolean {
	return HYPE_ORDER[hype] >= LANE_ORDER[lane]
}
