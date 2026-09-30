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
	date: Date
	startTime: string
	openTime?: string
	title: string
	sourceUrl: string

	// --- UI-only ---
	hypeLevel: HypeLevel
	matched: boolean
	/**
	 * The artist's colour identity as an OKLCH hue (0–359), derived from the
	 * artist name. Computed once when the concert is built, so a card hands it
	 * to CSS as data instead of hashing the name while it renders.
	 */
	artistHue: number
	artist?: Artist
	journeyStatus?: JourneyStatus
}

/** A group of concerts for a single date, split by proximity lane. */
export interface DateGroup {
	label: string
	dateKey: string
	/** True when this group is the first entry for its month (drives separator rendering). */
	isFirstOfMonth: boolean
	/** Formatted month label shown in the separator, e.g. "2026年7月". Empty when !isFirstOfMonth. */
	monthSeparatorLabel: string
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

/**
 * Where the fan was in the timetable, expressed as the date group at the top of
 * the viewport rather than a pixel offset.
 *
 * A pixel offset cannot survive navigation here: the timetable builds only a
 * window of dates, and on return that window starts at the remembered date, so
 * the dates above it are not built and a pixel value would count past a
 * different set of groups. Naming the date is independent of what is built
 * around it.
 */
export interface TimetableAnchor {
	/** `dateKey` of the group that was at the top edge. */
	dateKey: string
	/** How far the fan had scrolled into that group, in pixels. */
	offset: number
}
