/**
 * Civil (wall-clock) times and their zones, for both apps.
 *
 * An Event's times are wall-clock times at its Venue and a TicketSale's window
 * is a civil date-time in the sale's zone. A value becomes an instant only
 * when something compares it with `now`, with `wallToInstant`, using the
 * browser's own zone data through `Intl`. Nothing here reads the device's
 * time zone except `viewerZone`.
 */

/** A civil date and time of day, to the minute. */
export interface WallClock {
	readonly year: number
	readonly month: number
	readonly day: number
	readonly hour: number
	readonly minute: number
}

/** A time of day to the minute (`google.type.TimeOfDay` without seconds). */
export interface WallTime {
	readonly hour: number
	readonly minute: number
}

const MINUTE_MS = 60_000

const formats = new Map<string, Intl.DateTimeFormat>()

function partsFormat(zone: string): Intl.DateTimeFormat {
	let f = formats.get(zone)
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			calendar: 'gregory',
			numberingSystem: 'latn',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			hourCycle: 'h23',
		})
		formats.set(zone, f)
	}
	return f
}

/** True when `zone` is an IANA name this browser knows. */
export function isKnownZone(zone: string): boolean {
	try {
		partsFormat(zone)
		return true
	} catch {
		return false
	}
}

/** The IANA name of the browser's own time zone. */
export function viewerZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** The offset of `zone` from UTC at `instant`, in milliseconds. */
export function offsetMsAt(instant: Date, zone: string): number {
	const seconds = Math.floor(instant.getTime() / 1000) * 1000
	const p: Record<string, number> = {}
	for (const part of partsFormat(zone).formatToParts(new Date(seconds))) {
		if (part.type !== 'literal') p[part.type] = Number(part.value)
	}
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
	return asUtc - seconds
}

/** The wall clock of `instant` in `zone`. */
export function instantToWall(instant: Date, zone: string): WallClock {
	const shifted = new Date(instant.getTime() + offsetMsAt(instant, zone))
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
	}
}

/**
 * The instant at which `zone`'s clocks read `wall`. A time that occurs twice
 * (the clocks move back) is the earlier instant; a time that does not occur
 * (the clocks move forward) has no instant, and the result is undefined. A
 * value that is not a calendar date or an unknown zone is undefined too.
 */
export function wallToInstant(wall: WallClock, zone: string): Date | undefined {
	if (!isKnownZone(zone)) return undefined
	if (!isCalendarWall(wall)) return undefined
	const asUtc = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
	)
	// The offsets in force a day before and after bracket any one transition.
	const offsets = new Set([
		offsetMsAt(new Date(asUtc - 24 * 60 * MINUTE_MS), zone),
		offsetMsAt(new Date(asUtc + 24 * 60 * MINUTE_MS), zone),
	])
	const instants: number[] = []
	for (const offset of offsets) {
		const candidate = asUtc - offset
		if (offsetMsAt(new Date(candidate), zone) === offset) {
			instants.push(candidate)
		}
	}
	if (instants.length === 0) return undefined
	return new Date(Math.min(...instants))
}

/** True when `wall` names a real calendar date and a time of day. */
export function isCalendarWall(wall: WallClock): boolean {
	if (
		!Number.isInteger(wall.year) ||
		!Number.isInteger(wall.month) ||
		!Number.isInteger(wall.day) ||
		!Number.isInteger(wall.hour) ||
		!Number.isInteger(wall.minute)
	) {
		return false
	}
	if (wall.hour < 0 || wall.hour > 23 || wall.minute < 0 || wall.minute > 59) {
		return false
	}
	const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day))
	return (
		d.getUTCFullYear() === wall.year &&
		d.getUTCMonth() === wall.month - 1 &&
		d.getUTCDate() === wall.day
	)
}

/** True when `wall` exists in `zone` (it is not skipped by the clocks moving forward). */
export function existsInZone(wall: WallClock, zone: string): boolean {
	return wallToInstant(wall, zone) !== undefined
}

/** `2027-02-20` for a civil date. */
export function dateKey(
	wall: Pick<WallClock, 'year' | 'month' | 'day'>,
): string {
	return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
}

/** `19:30` for a time of day. */
export function timeKey(time: WallTime): string {
	return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

/** The civil date of a `YYYY-MM-DD` key, or undefined. */
export function parseDateKey(
	key: string,
): Pick<WallClock, 'year' | 'month' | 'day'> | undefined {
	const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!m) return undefined
	const [year, month, day] = m.slice(1).map(Number)
	return isCalendarWall({ year, month, day, hour: 0, minute: 0 })
		? { year, month, day }
		: undefined
}

/** The time of day of an `HH:mm` key, or undefined. */
export function parseTimeKey(key: string): WallTime | undefined {
	const m = key.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
	return m ? { hour: Number(m[1]), minute: Number(m[2]) } : undefined
}

/**
 * The wall clock `minutes` after `wall` on the same clock face, ignoring any
 * change of the zone's rules in between (calendar arithmetic, not elapsed
 * time).
 */
export function addWallMinutes(wall: WallClock, minutes: number): WallClock {
	const d = new Date(
		Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) +
			minutes * MINUTE_MS,
	)
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
	}
}

/**
 * Midnight of a civil date in `zone`, as an instant. The clocks of a few
 * zones skip midnight; then the first instant of the day is returned.
 */
export function startOfDay(
	date: Pick<WallClock, 'year' | 'month' | 'day'>,
	zone: string,
): Date | undefined {
	const midnight = { ...date, hour: 0, minute: 0 }
	const exact = wallToInstant(midnight, zone)
	if (exact) return exact
	return wallToInstant({ ...date, hour: 1, minute: 0 }, zone)
}
