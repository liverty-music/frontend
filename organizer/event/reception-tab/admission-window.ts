import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	addWallMinutes,
	wallToInstant,
} from '../../../shared/lib/zoned-time/zoned-time'
import type { MomentAt } from '../../i18n/format'
import { eventZone } from '../../model/concert-model'

const HOUR_MS = 3_600_000

export interface AdmissionWindowTimes {
	readonly open: Date
	readonly close: Date
	/** The event's Venue zone, in which both are read; absent for a Venue with none. */
	readonly zone?: string
	/** `open` and `close` as moments in the Venue's zone, for display. */
	readonly openAt: MomentAt
	readonly closeAt: MomentAt
}

/**
 * The event's admission window, as entity.v1.AdmissionWindow defines it from
 * the event's current local date, open time and start time at its Venue: from
 * 3 hours before the open time (or before the start time when the event has no
 * open time) until 04:00 on the day after the local date, in the Venue's time
 * zone. Null when the event has no start time (it then has no admission
 * window) or no date.
 *
 * The console shows it beside the Scanners; the scanner device gets the
 * authoritative window from the server when it opens its link.
 */
export function admissionWindowOf(event: Event): AdmissionWindowTimes | null {
	const start = event.startTime?.value
	const date = event.localDate?.value
	if (!start || !date) return null
	const zone = eventZone(event)
	const read = zone ?? 'UTC'
	const doors = event.openTime?.value ?? start
	const doorsAt = wallToInstant(
		{
			year: date.year,
			month: date.month,
			day: date.day,
			hour: doors.hours,
			minute: doors.minutes,
		},
		read,
	)
	const nextMorning = {
		year: date.year,
		month: date.month,
		day: date.day + 1,
		hour: 4,
		minute: 0,
	}
	const closeAt =
		wallToInstant(addWallMinutes(nextMorning, 0), read) ??
		wallToInstant(addWallMinutes(nextMorning, 60), read)
	if (!doorsAt || !closeAt) return null
	const open = new Date(doorsAt.getTime() - 3 * HOUR_MS)
	return {
		open,
		close: closeAt,
		zone,
		openAt: { at: open, zone },
		closeAt: { at: closeAt, zone },
	}
}
