import { dateTimeInit, timeOfDayInit } from '../../shared/lib/zoned-time/proto'
import { instantToWall } from '../../shared/lib/zoned-time/zoned-time'

/**
 * Fixtures for the wall-clock times of the console's screens: an instant
 * written as the wall clock it reads in a zone, the way the server sends a
 * start time (TimeOfDay) or a sale's window (DateTime with its zone). The
 * zone defaults to Japan's, where every Organizer's venue was before venues
 * abroad.
 */
export const FIXTURE_ZONE = 'Asia/Tokyo'

/** `2026-11-03` and `18:00` read in `zone` as an instant. */
export function at(date: string, time: string, zone = FIXTURE_ZONE): Date {
	const w = instantToWall(new Date(`${date}T${time}:00Z`), 'UTC')
	// Search the instant whose wall clock in `zone` is the given one.
	let guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
	for (let i = 0; i < 3; i++) {
		const read = instantToWall(new Date(guess), zone)
		const diff =
			Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) -
			Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute)
		if (diff === 0) break
		guess += diff
	}
	return new Date(guess)
}

/** The TimeOfDay an instant reads as in `zone`. */
export function timeOfDayAt(instant: Date, zone = FIXTURE_ZONE) {
	return timeOfDayInit(instantToWall(instant, zone))
}

/** The DateTime an instant reads as in `zone`, carrying the zone. */
export function dateTimeAt(instant: Date, zone = FIXTURE_ZONE) {
	return dateTimeInit(instantToWall(instant, zone), zone)
}

/** A Venue at `zone`. */
export function venueIn(name: string, zone = FIXTURE_ZONE) {
	return { name: { value: name }, timeZone: { value: zone } }
}
