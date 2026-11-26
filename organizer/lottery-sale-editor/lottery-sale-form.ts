import type { FieldError } from '../i18n/field-error'
import {
	type DateTimeInput,
	emptyDateTimeInput,
	instantOfInput,
	toDateTimeInput,
	unsetPartOf,
	wallOfInput,
} from '../i18n/wall-input'
import { wallInZone } from '../model/sale-zone'
import { addWallMinutes } from '../../shared/lib/zoned-time/zoned-time'
import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

export type { DateTimeInput, FieldError }

/** Default application-window duration in days (server + console default). */
export const DEFAULT_WINDOW_DAYS = 10
/** Minimum accepted application-window duration in days (inclusive). */
export const MIN_WINDOW_DAYS = 1
/**
 * Maximum accepted application-window duration in days (inclusive). The 14-day
 * ceiling keeps every fan's card authorization within the JP 30-day validity
 * window (mirrors the backend + schema constraint).
 */
export const MAX_WINDOW_DAYS = 14
/** Maximum length of the sale's name, in characters. */
export const MAX_NAME_LENGTH = 100

const MINUTES_PER_DAY = 24 * 60
/** The minute steps of the console's time field (design D19). */
const MINUTE_STEP_MS = 5 * 60 * 1000

/**
 * The editable, transport-agnostic model of the lottery form: the sale's name
 * zone and window. The window's start and end are each a date and a 24-hour
 * time in the sale's time zone (design D19). The sale draws from every TicketStock of the
 * event and the per-account limit is the event's, so it carries neither.
 */
export interface LotterySaleFormModel {
	/** The sale's name, e.g. ファンクラブ先行. */
	name: string
	/** The IANA zone the window is read in; '' while none is chosen. */
	timeZone: string
	/** When the window opens, in the sale's zone. */
	saleStart: DateTimeInput
	/** When the window closes, in the sale's zone. */
	saleEnd: DateTimeInput
}

/** Per-field validation errors, keyed for inline display next to each control. */
export interface LotterySaleFormErrors {
	name?: FieldError
	/** The start's date is unset or not a calendar day. */
	/** No time zone is chosen, or the server refused the one chosen. */
	timeZone?: FieldError
	saleStartDate?: FieldError
	/** The start's time is unset, or skipped by the clocks moving forward. */
	saleStartTime?: FieldError
	saleEndDate?: FieldError
	saleEndTime?: FieldError
	/** The window as a whole (length, order, event start, overlap). */
	window?: FieldError
}

/** What the form is checked against besides its own values. */
export interface LotterySaleFormContext {
	/** The event's start; the lottery must close before it. */
	readonly eventStart?: Date | null
}

/**
 * Returns a blank form model. With a zone the window is defaulted (open now,
 * close {@link DEFAULT_WINDOW_DAYS} later on the calendar of the zone); without
 * one (several to choose from) it is left empty until a zone is chosen. "Now"
 * is rounded up to the time field's 5-minute steps, so the default is a time
 * the field offers. `now` is injected for deterministic tests.
 */
export function emptyFormModel(
	now: Date = new Date(),
	timeZone = '',
): LotterySaleFormModel {
	return {
		name: '',
		timeZone,
		...defaultWindow(now, timeZone),
	}
}

/** The default window in `zone`: open at `now` rounded up to 5 minutes, closing 10 calendar days later. */
export function defaultWindow(
	now: Date,
	timeZone: string,
): { saleStart: DateTimeInput; saleEnd: DateTimeInput } {
	if (!timeZone) {
		return { saleStart: emptyDateTimeInput(), saleEnd: emptyDateTimeInput() }
	}
	const open = new Date(
		Math.ceil(now.getTime() / MINUTE_STEP_MS) * MINUTE_STEP_MS,
	)
	const openWall = wallInZone(open, timeZone)
	return {
		saleStart: toDateTimeInput(openWall),
		saleEnd: toDateTimeInput(
			addWallMinutes(openWall, DEFAULT_WINDOW_DAYS * MINUTES_PER_DAY),
		),
	}
}

/**
 * The length of the window in days, counted on the zone's own calendar
 * (fractional), so a window across a daylight-saving change still counts its
 * calendar days.
 */
export function windowDurationDays(
	open: DateTimeInput,
	close: DateTimeInput,
): number | null {
	const a = wallOfInput(open)
	const b = wallOfInput(close)
	if (!a || !b) return null
	const at = (w: typeof a) =>
		Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
	return (at(b) - at(a)) / (MINUTES_PER_DAY * 60_000)
}

/**
 * Validates the form model, mirroring the backend boundary so a member sees
 * inline errors before a round-trip: the name required and at most
 * {@link MAX_NAME_LENGTH} characters; open/close required and parseable; the
 * window {@link MIN_WINDOW_DAYS}–{@link MAX_WINDOW_DAYS} days long with close
 * strictly after open and before the event's start time.
 */
export function validateLotterySaleForm(
	model: LotterySaleFormModel,
	ctx: LotterySaleFormContext = {},
): LotterySaleFormErrors {
	const errors: LotterySaleFormErrors = {}

	const name = model.name.trim()
	if (name === '') {
		errors.name = { key: 'lotteryEditor.error.name' }
	} else if ([...name].length > MAX_NAME_LENGTH) {
		errors.name = {
			key: 'lotteryEditor.error.nameLength',
			params: { max: MAX_NAME_LENGTH },
		}
	}

	const startUnset = unsetPartOf(model.saleStart)
	if (startUnset === 'date') {
		errors.saleStartDate = { key: 'lotteryEditor.error.start' }
	} else if (startUnset === 'time') {
		errors.saleStartTime = { key: 'lotteryEditor.error.start' }
	}
	const endUnset = unsetPartOf(model.saleEnd)
	if (endUnset === 'date') {
		errors.saleEndDate = { key: 'lotteryEditor.error.end' }
	} else if (endUnset === 'time') {
		errors.saleEndTime = { key: 'lotteryEditor.error.end' }
	}
	if (model.timeZone === '') {
		errors.timeZone = { key: 'saleEditor.error.timeZone' }
		return errors
	}
	const open = instantOfInput(model.saleStart, model.timeZone)
	const close = instantOfInput(model.saleEnd, model.timeZone)
	if (!open && !startUnset) {
		errors.saleStartTime = { key: 'saleEditor.error.timeSkipped' }
	}
	if (!close && !endUnset) {
		errors.saleEndTime = { key: 'saleEditor.error.timeSkipped' }
	}
	const days = windowDurationDays(model.saleStart, model.saleEnd)
	if (open && close && days !== null) {
		if (days <= 0) {
			errors.window = { key: 'lotteryEditor.error.endBeforeStart' }
		} else if (days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
			errors.window = {
				key: 'lotteryEditor.error.windowLength',
				params: {
					min: MIN_WINDOW_DAYS,
					max: MAX_WINDOW_DAYS,
					days: days.toFixed(1),
				},
			}
		} else if (ctx.eventStart && close.getTime() >= ctx.eventStart.getTime()) {
			errors.window = { key: 'lotteryEditor.error.closeAfterEvent' }
		}
	}

	return errors
}

/** True when the validation result has no field-level errors. */
export function isFormValid(errors: LotterySaleFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated form model into the input of a Lottery sale of the
 * event's Series naming the event. Assumes the model already
 * passed {@link validateLotterySaleForm} (the caller gates on validity
 * first); a defensive parse failure falls back to an epoch value the
 * server rejects.
 */
export function toCreateInput(
	seriesId: string,
	eventId: string,
	model: LotterySaleFormModel,
): CreateTicketSaleInput {
	const zero = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 }
	return {
		seriesId,
		name: model.name.trim(),
		method: 'lottery',
		saleStart: wallOfInput(model.saleStart) ?? zero,
		saleEnd: wallOfInput(model.saleEnd) ?? zero,
		timeZone: model.timeZone,
		eventIds: [eventId],
	}
}
