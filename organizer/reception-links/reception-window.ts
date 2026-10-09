import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'

const HOUR_MS = 3_600_000
/** Japan time is UTC+9 all year. */
const JST_OFFSET_HOURS = 9

export interface ReceptionWindowTimes {
	readonly open: Date
	readonly close: Date
}

/**
 * The event's reception window, as entity.v1.ReceptionWindow defines it from
 * the event's current local date, open time and start time in Japan time: from
 * 3 hours before the open time (or before the start time when the event has no
 * open time) until 04:00 on the day after the local date. Null when the event
 * has no start time (it then has no reception window) or no date.
 *
 * The console shows it beside the links; the reception device gets the
 * authoritative window from the server when it opens a link.
 */
export function receptionWindowOf(event: Event): ReceptionWindowTimes | null {
	const start = event.startTime?.value
	const date = event.localDate?.value
	if (!start || !date) return null
	const doors = event.openTime?.value ?? start
	const open = new Date(timestampDate(doors).getTime() - 3 * HOUR_MS)
	const close = new Date(
		Date.UTC(date.year, date.month - 1, date.day + 1, 4 - JST_OFFSET_HOURS),
	)
	return { open, close }
}
