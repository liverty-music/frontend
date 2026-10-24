/**
 * Targets of the Discovery onboarding progress row: the timetable is ready at
 * 5 followed artists, or at 3 followed artists with a found concert.
 */

/** Followed artists without a found concert that make the timetable ready. */
export const DASHBOARD_FOLLOW_TARGET = 5
/** Followed artists with a found concert that make the timetable ready. */
export const DASHBOARD_CONCERT_TARGET = 3

/**
 * How close the onboarding timetable is to ready, from 0 to 1. Every follow
 * moves it: one without a found concert adds 1/5, one with a found concert
 * adds 1/3. `withConcerts` may still count an artist unfollowed since its
 * lookup, so it is capped at `followed`.
 */
export function timetableReadiness(
	followed: number,
	withConcerts: number,
): number {
	const found = Math.min(withConcerts, followed)
	const without = Math.max(0, followed - found)
	return Math.min(
		1,
		without / DASHBOARD_FOLLOW_TARGET + found / DASHBOARD_CONCERT_TARGET,
	)
}
