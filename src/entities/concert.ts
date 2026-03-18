import type { Artist } from './artist'

/** Lane type for proximity-based grouping on the dashboard. */
export type LaneType = 'home' | 'nearby' | 'away'

/** Hype level determining which lanes an artist's concerts appear matched in. */
export type HypeLevel = 'watch' | 'home' | 'nearby' | 'away'

/** Ticket journey status reflecting where the user is in the ticket acquisition flow. */
export type JourneyStatus = 'tracking' | 'applied' | 'lost' | 'unpaid' | 'paid'

/** A concert event displayed on the dashboard. */
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
