import type { FieldError } from '../i18n/field-error'
import {
	type JstDateTime,
	parseJstDateTime,
	toJstDateTime,
	unsetPartOf,
} from '../i18n/format'
import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

export type { FieldError, JstDateTime }

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
/**
 * Maximum accepted per-account limit (inclusive). One entry QR code presents
 * at most 10 tickets and a companion group enters together with one code
 * (mirrors the backend + schema constraint).
 */
export const MAX_PER_ACCOUNT_LIMIT = 10
/** The per-account limit a new lottery starts with (server default too). */
export const DEFAULT_PER_ACCOUNT_LIMIT = 4
/** Maximum length of the sale's name, in characters. */
export const MAX_NAME_LENGTH = 100

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** The minute steps of the console's time field (design D19). */
const MINUTE_STEP_MS = 5 * 60 * 1000

/**
 * The editable, transport-agnostic model of the lottery form: the sale's name
 * and window, and its one TicketType for the event. The window's start and
 * end are each a date and a 24-hour time in Japan time (design D19); numeric
 * fields are kept as strings so an empty control is distinguishable from `0`
 * and `value.bind` maps onto the native `<input type="number">` without
 * coercion surprises.
 */
export interface LotterySaleFormModel {
	/** The sale's name, e.g. ファンクラブ先行. */
	name: string
	/** When the window opens, in Japan time. */
	saleStart: JstDateTime
	/** When the window closes, in Japan time. */
	saleEnd: JstDateTime
	/** Positive integer (tickets drawn for), as a raw input string. */
	quantity: string
	/** 1 to {@link MAX_PER_ACCOUNT_LIMIT}, ≤ quantity, as a raw input string. */
	perAccountLimit: string
	/** Positive whole-yen JPY price, as a raw input string. */
	price: string
}

/** Per-field validation errors, keyed for inline display next to each control. */
export interface LotterySaleFormErrors {
	name?: FieldError
	/** The start's date is unset or not a calendar day. */
	saleStartDate?: FieldError
	/** The start's time is unset. */
	saleStartTime?: FieldError
	saleEndDate?: FieldError
	saleEndTime?: FieldError
	/** The window as a whole (length, order, event start, overlap). */
	window?: FieldError
	quantity?: FieldError
	perAccountLimit?: FieldError
	price?: FieldError
}

/** What the form is checked against besides its own values. */
export interface LotterySaleFormContext {
	/** The event's start time; the lottery must close before it. */
	readonly eventStart?: Date | null
}

/** The date and time fields showing `date` in Japan time. */
export function toDateTime(date: Date): JstDateTime {
	return toJstDateTime(date)
}

/**
 * Returns a blank form model with the window defaulted (open now, close
 * {@link DEFAULT_WINDOW_DAYS} later) and the limit
 * {@link DEFAULT_PER_ACCOUNT_LIMIT}. "Now" is rounded up to the time field's
 * 5-minute steps, so the default is a time the field offers. `now` is
 * injected for deterministic tests.
 */
export function emptyFormModel(now: Date = new Date()): LotterySaleFormModel {
	const open = new Date(
		Math.ceil(now.getTime() / MINUTE_STEP_MS) * MINUTE_STEP_MS,
	)
	const close = new Date(open.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY)
	return {
		name: '',
		saleStart: toDateTime(open),
		saleEnd: toDateTime(close),
		quantity: '',
		perAccountLimit: String(DEFAULT_PER_ACCOUNT_LIMIT),
		price: '',
	}
}

/** The instant of a date and time entered in Japan time, or null. */
export function parseDateTime(value: JstDateTime): Date | null {
	return parseJstDateTime(value) ?? null
}

/** Parses a raw input string into a positive integer, or null. */
function parsePositiveInt(value: string): number | null {
	const trimmed = value.trim()
	if (trimmed === '' || !/^\d+$/.test(trimmed)) return null
	const n = Number(trimmed)
	if (!Number.isSafeInteger(n) || n <= 0) return null
	return n
}

/** Whole days (fractional) between two instants; may be fractional. */
export function windowDurationDays(open: Date, close: Date): number {
	return (close.getTime() - open.getTime()) / MS_PER_DAY
}

/**
 * Validates the form model, mirroring the backend boundary so an operator sees
 * inline errors before a round-trip: the name required and at most
 * {@link MAX_NAME_LENGTH} characters; open/close required and parseable; the
 * window {@link MIN_WINDOW_DAYS}–{@link MAX_WINDOW_DAYS} days long with close
 * strictly after open and before the event's start time; quantity and price
 * each a positive integer; and the limit 1–{@link MAX_PER_ACCOUNT_LIMIT} and
 * not above the quantity.
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
	const open = parseDateTime(model.saleStart)
	const close = parseDateTime(model.saleEnd)
	if (open !== null && close !== null) {
		const days = windowDurationDays(open, close)
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

	const quantity = parsePositiveInt(model.quantity)
	if (quantity === null) {
		errors.quantity = { key: 'lotteryEditor.error.quantity' }
	}

	const limit = parsePositiveInt(model.perAccountLimit)
	if (limit === null) {
		errors.perAccountLimit = { key: 'lotteryEditor.error.limit' }
	} else if (limit > MAX_PER_ACCOUNT_LIMIT) {
		errors.perAccountLimit = {
			key: 'lotteryEditor.error.limitMax',
			params: { max: MAX_PER_ACCOUNT_LIMIT },
		}
	} else if (quantity !== null && limit > quantity) {
		errors.perAccountLimit = { key: 'lotteryEditor.error.limitOverQuantity' }
	}

	const price = parsePositiveInt(model.price)
	if (price === null) {
		errors.price = { key: 'lotteryEditor.error.price' }
	}

	return errors
}

/** True when the validation result has no field-level errors. */
export function isFormValid(errors: LotterySaleFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated form model into the input of a Lottery sale of the
 * event's Series with one TicketType for the event. Assumes the model already
 * passed {@link validateLotterySaleForm} (the caller gates on validity
 * first); a defensive parse failure falls back to a zero/epoch value the
 * server rejects.
 */
export function toCreateInput(
	seriesId: string,
	eventId: string,
	model: LotterySaleFormModel,
): CreateTicketSaleInput {
	return {
		seriesId,
		name: model.name.trim(),
		method: 'lottery',
		saleStartTime: parseDateTime(model.saleStart) ?? new Date(0),
		saleEndTime: parseDateTime(model.saleEnd) ?? new Date(0),
		eventId,
		quantity: Number(model.quantity.trim()) || 0,
		perAccountLimit: Number(model.perAccountLimit.trim()) || 0,
		price: Number(model.price.trim()) || 0,
	}
}
