import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { parseJstDateAndTime, toJstDateInput } from '../i18n/format'
import type {
	CalendarDate,
	EventDraftInput,
	SeriesDraftInput,
} from '../services/series-client'
import type { VenuePick } from '../ui/venue-field/venue-field'

/**
 * The editable, transport-agnostic model of a single event row in the editor.
 * Times are wall-clock `HH:mm` strings scoped to the event's local date; empty
 * strings mean "not set". Kept as plain strings so `value.bind` maps directly
 * onto the native `<input type="date">` / `<input type="time">` controls.
 */
export interface EventFormRow {
	/** The id of the stored Event this row edits; empty for a new date. */
	eventId: string
	/**
	 * The row's publish state. A new row is DRAFT: the server stores a new date
	 * as a DRAFT Event, published later on its own.
	 */
	publishState: PublishState
	/** The place picked from the map catalog; null until one is picked. */
	venue: VenuePick | null
	/** ISO `YYYY-MM-DD` from `<input type="date">`; empty when unset. */
	localDate: string
	/** `HH:mm` from `<input type="time">`; empty when unset. */
	startTime: string
	/** `HH:mm` from `<input type="time">`; empty when unset. */
	openTime: string
}

/** The editable model of the whole series form. */
export interface ConcertFormModel {
	title: string
	description: string
	type: SeriesType
	visibility: Visibility
	/**
	 * The Series' source page, kept as loaded. The editor offers no control for
	 * it, but sends it back so a save never changes it (it is fixed once the
	 * concert has a PUBLISHED or CANCELLED event).
	 */
	sourceUrl: string
	artistIds: string[]
	events: EventFormRow[]
}

/** Per-field validation errors, keyed for inline display next to each control. */
export interface ConcertFormErrors {
	title?: string
	type?: string
	visibility?: string
	artistIds?: string
	/** Form-level event errors (e.g. the whole list is empty). */
	events?: string
	/** Per-row errors, parallel to `model.events` by index. */
	rows: EventRowErrors[]
}

export interface EventRowErrors {
	venueName?: string
	localDate?: string
	time?: string
}

/** Returns a blank event row. */
export function emptyEventRow(): EventFormRow {
	return {
		eventId: '',
		publishState: PublishState.DRAFT,
		venue: null,
		localDate: '',
		startTime: '',
		openTime: '',
	}
}

/** Returns a blank form model (a SINGLE, PUBLIC draft with one empty event). */
export function emptyFormModel(): ConcertFormModel {
	return {
		title: '',
		description: '',
		type: SeriesType.SINGLE,
		visibility: Visibility.PUBLIC,
		sourceUrl: '',
		artistIds: [],
		events: [emptyEventRow()],
	}
}

/** Parses an ISO `YYYY-MM-DD` string into a calendar triple, or null. */
export function parseIsoDate(iso: string): CalendarDate | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
	if (!m) return null
	const year = Number(m[1])
	const month = Number(m[2])
	const day = Number(m[3])
	if (month < 1 || month > 12 || day < 1 || day > 31) return null
	return { year, month, day }
}

/**
 * Composes an absolute `Date` from an event's local date and a wall-clock
 * `HH:mm`. Interpreted in the browser's local timezone — the console has no
 * venue timezone, and the backend re-anchors to the venue on write; this is a
 * best-effort instant for the optional start/open fields. Returns null when the
 * time is empty or malformed.
 */
export function composeInstant(date: CalendarDate, hhmm: string): Date | null {
	const trimmed = hhmm.trim()
	if (trimmed === '') return null
	const m = /^(\d{2}):(\d{2})$/.exec(trimmed)
	if (!m) return null
	const hours = Number(m[1])
	const minutes = Number(m[2])
	if (hours > 23 || minutes > 59) return null
	const pad = (n: number) => String(n).padStart(2, '0')
	// The wall clock is Japan time, whatever the device's time zone.
	return (
		parseJstDateAndTime(
			`${date.year}-${pad(date.month)}-${pad(date.day)}`,
			`${pad(hours)}:${pad(minutes)}`,
		) ?? null
	)
}

/** Compares a calendar date against a "today" triple. Negative when before. */
function compareToToday(date: CalendarDate, today: CalendarDate): number {
	if (date.year !== today.year) return date.year - today.year
	if (date.month !== today.month) return date.month - today.month
	return date.day - today.day
}

/** Derives the caller's local-today calendar triple from a `Date`. */
export function todayCalendarDate(now: Date = new Date()): CalendarDate {
	const [year, month, day] = toJstDateInput(now).split('-').map(Number)
	return { year, month, day }
}

/**
 * Validates the form model, mirroring the backend boundary rules so an operator
 * sees inline errors before a round-trip: title required; a valid series type
 * and visibility (the UNSPECIFIED zero value is rejected); at least one
 * performer; at least one event; each event needs a venue name and a valid,
 * non-past local date; and open time must not be after start time.
 *
 * `today` is injected (defaults to the caller's local today) so the past-date
 * rule is deterministic and unit-testable. The past-date rule applies only to
 * new and DRAFT rows: a PUBLISHED or CANCELLED event legitimately carries a
 * past date while its concert is corrected. `allowPastDates` relaxes it for
 * every row.
 */
export function validateConcertForm(
	model: ConcertFormModel,
	options?: { today?: CalendarDate; allowPastDates?: boolean },
): ConcertFormErrors {
	const today = options?.today ?? todayCalendarDate()
	const allowPastDates = options?.allowPastDates ?? false
	const errors: ConcertFormErrors = { rows: [] }

	if (model.title.trim() === '') {
		errors.title = 'concertEditor.error.title'
	}
	if (model.type === SeriesType.UNSPECIFIED) {
		errors.type = 'concertEditor.error.type'
	}
	if (model.visibility === Visibility.UNSPECIFIED) {
		errors.visibility = 'concertEditor.error.visibility'
	}
	if (model.artistIds.length === 0) {
		errors.artistIds = 'concertEditor.error.performers'
	}
	if (model.events.length === 0) {
		errors.events = 'concertEditor.error.events'
	}

	for (const row of model.events) {
		const rowErrors: EventRowErrors = {}
		// A venue is a place picked from the map catalog, never a typed name.
		// A published or cancelled date keeps its venue, which is not sent.
		if (!hasFixedVenueAndDate(row) && !row.venue?.placeId) {
			rowErrors.venueName = 'concertEditor.error.venueNotPicked'
		}
		const date = parseIsoDate(row.localDate)
		if (date === null) {
			rowErrors.localDate = 'concertEditor.error.date'
		} else if (
			!allowPastDates &&
			!hasFixedVenueAndDate(row) &&
			compareToToday(date, today) < 0
		) {
			rowErrors.localDate = 'concertEditor.error.pastDate'
		} else {
			const start = composeInstant(date, row.startTime)
			const open = composeInstant(date, row.openTime)
			if (start && open && open.getTime() > start.getTime()) {
				rowErrors.time = 'concertEditor.error.openAfterStart'
			}
		}
		errors.rows.push(rowErrors)
	}

	return errors
}

/** True when the row's venue and date are fixed (a PUBLISHED or CANCELLED event). */
export function hasFixedVenueAndDate(row: EventFormRow): boolean {
	return (
		row.publishState === PublishState.PUBLISHED ||
		row.publishState === PublishState.CANCELLED
	)
}

/** True when the validation result has no field- or row-level errors. */
export function isFormValid(errors: ConcertFormErrors): boolean {
	if (
		errors.title ||
		errors.type ||
		errors.visibility ||
		errors.artistIds ||
		errors.events
	) {
		return false
	}
	return errors.rows.every((r) => !r.venueName && !r.localDate && !r.time)
}

/**
 * Converts a validated form model into the transport-agnostic
 * {@link SeriesDraftInput} the RPC client marshals. Assumes the model already
 * passed {@link validateConcertForm}; malformed dates fall back to a zero
 * triple, which the caller prevents by gating on validity first.
 */
export function toSeriesDraftInput(model: ConcertFormModel): SeriesDraftInput {
	const events: EventDraftInput[] = model.events.map((row) => {
		const date = parseIsoDate(row.localDate) ?? { year: 0, month: 0, day: 0 }
		const start = composeInstant(date, row.startTime)
		const open = composeInstant(date, row.openTime)
		return {
			...(row.eventId ? { eventId: row.eventId } : {}),
			venueName: row.venue?.name ?? '',
			...(row.venue?.placeId ? { placeId: row.venue.placeId } : {}),
			localDate: date,
			...(start ? { startTime: start } : {}),
			...(open ? { openTime: open } : {}),
		}
	})
	return {
		title: model.title.trim(),
		type: model.type,
		visibility: model.visibility,
		...(model.description.trim()
			? { description: model.description.trim() }
			: {}),
		...(model.sourceUrl ? { sourceUrl: model.sourceUrl } : {}),
		artistIds: [...model.artistIds],
		events,
	}
}
