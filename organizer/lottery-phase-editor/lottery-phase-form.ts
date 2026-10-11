import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

/** Default application-window duration in days (server + console default). */
export const DEFAULT_WINDOW_DAYS = 10
/** Minimum accepted application-window duration in days (inclusive). */
export const MIN_WINDOW_DAYS = 1
/**
 * Maximum accepted application-window duration in days (inclusive). The 14-day
 * ceiling keeps every applicant's card authorization within the JP 30-day hold
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

/**
 * The editable, transport-agnostic model of the lottery form: the sale's name
 * and window, and its one TicketType for the event. Times are
 * `datetime-local` strings (`YYYY-MM-DDTHH:mm`) bound directly onto native
 * `<input type="datetime-local">` controls; numeric fields are kept as strings
 * so an empty control is distinguishable from `0` and `value.bind` maps onto the
 * native `<input type="number">` without coercion surprises.
 */
export interface LotteryPhaseFormModel {
	/** The sale's name, e.g. ファンクラブ先行. */
	name: string
	/** `datetime-local` string; empty when unset. */
	openTime: string
	/** `datetime-local` string; empty when unset. */
	closeTime: string
	/** Positive integer (tickets drawn for), as a raw input string. */
	quantity: string
	/** 1 to {@link MAX_PER_ACCOUNT_LIMIT}, ≤ quantity, as a raw input string. */
	perAccountLimit: string
	/** Positive whole-yen JPY price, as a raw input string. */
	price: string
}

/** Per-field validation errors, keyed for inline display next to each control. */
export interface LotteryPhaseFormErrors {
	name?: string
	openTime?: string
	closeTime?: string
	window?: string
	quantity?: string
	perAccountLimit?: string
	price?: string
}

/** What the form is checked against besides its own values. */
export interface LotteryPhaseFormContext {
	/** The event's start time; the lottery must close before it. */
	readonly eventStart?: Date | null
}

/** Formats a `Date` as a local `YYYY-MM-DDTHH:mm` for a datetime-local input. */
export function toDateTimeLocal(date: Date): string {
	const y = date.getFullYear()
	const mo = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const h = String(date.getHours()).padStart(2, '0')
	const mi = String(date.getMinutes()).padStart(2, '0')
	return `${y}-${mo}-${d}T${h}:${mi}`
}

/**
 * Returns a blank form model with the window defaulted (open now, close
 * {@link DEFAULT_WINDOW_DAYS} later) and the limit
 * {@link DEFAULT_PER_ACCOUNT_LIMIT}. `now` is injected for deterministic tests.
 */
export function emptyFormModel(now: Date = new Date()): LotteryPhaseFormModel {
	const close = new Date(now.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY)
	return {
		name: '',
		openTime: toDateTimeLocal(now),
		closeTime: toDateTimeLocal(close),
		quantity: '',
		perAccountLimit: String(DEFAULT_PER_ACCOUNT_LIMIT),
		price: '',
	}
}

/** Parses a `datetime-local` string into a `Date`, or null when malformed. */
export function parseDateTimeLocal(value: string): Date | null {
	const trimmed = value.trim()
	if (trimmed === '') return null
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed)
	if (!m) return null
	const date = new Date(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		Number(m[4]),
		Number(m[5]),
		0,
		0,
	)
	return Number.isNaN(date.getTime()) ? null : date
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
export function validateLotteryPhaseForm(
	model: LotteryPhaseFormModel,
	ctx: LotteryPhaseFormContext = {},
): LotteryPhaseFormErrors {
	const errors: LotteryPhaseFormErrors = {}

	const name = model.name.trim()
	if (name === '') {
		errors.name = 'Enter a name for the sale, e.g. ファンクラブ先行.'
	} else if ([...name].length > MAX_NAME_LENGTH) {
		errors.name = `The name must be ${MAX_NAME_LENGTH} characters or fewer.`
	}

	const open = parseDateTimeLocal(model.openTime)
	const close = parseDateTimeLocal(model.closeTime)
	if (open === null) {
		errors.openTime = 'A valid application-window open time is required.'
	}
	if (close === null) {
		errors.closeTime = 'A valid application-window close time is required.'
	}
	if (open !== null && close !== null) {
		const days = windowDurationDays(open, close)
		if (days <= 0) {
			errors.window = 'The close time must be after the open time.'
		} else if (days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
			errors.window = `The application window must be ${MIN_WINDOW_DAYS}–${MAX_WINDOW_DAYS} days long (it is currently ${days.toFixed(1)} days).`
		} else if (ctx.eventStart && close.getTime() >= ctx.eventStart.getTime()) {
			errors.window =
				'The lottery must close before the event starts, so winners get their tickets before the doors open.'
		}
	}

	const quantity = parsePositiveInt(model.quantity)
	if (quantity === null) {
		errors.quantity = 'The number of tickets must be a positive whole number.'
	}

	const limit = parsePositiveInt(model.perAccountLimit)
	if (limit === null) {
		errors.perAccountLimit =
			'The per-account limit must be a positive whole number.'
	} else if (limit > MAX_PER_ACCOUNT_LIMIT) {
		errors.perAccountLimit = `The per-account limit cannot exceed ${MAX_PER_ACCOUNT_LIMIT} (one entry QR code covers at most ${MAX_PER_ACCOUNT_LIMIT} tickets).`
	} else if (quantity !== null && limit > quantity) {
		errors.perAccountLimit =
			'The per-account limit cannot exceed the number of tickets.'
	}

	const price = parsePositiveInt(model.price)
	if (price === null) {
		errors.price = 'Ticket price (JPY) must be a positive whole number.'
	}

	return errors
}

/** True when the validation result has no field-level errors. */
export function isFormValid(errors: LotteryPhaseFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated form model into the input of a Lottery sale of the
 * event's Series with one TicketType for the event. Assumes the model already
 * passed {@link validateLotteryPhaseForm} (the caller gates on validity
 * first); a defensive parse failure falls back to a zero/epoch value the
 * server rejects.
 */
export function toCreateInput(
	seriesId: string,
	eventId: string,
	model: LotteryPhaseFormModel,
): CreateTicketSaleInput {
	return {
		seriesId,
		name: model.name.trim(),
		method: 'lottery',
		saleStartTime: parseDateTimeLocal(model.openTime) ?? new Date(0),
		saleEndTime: parseDateTimeLocal(model.closeTime) ?? new Date(0),
		eventId,
		quantity: Number(model.quantity.trim()) || 0,
		perAccountLimit: Number(model.perAccountLimit.trim()) || 0,
		price: Number(model.price.trim()) || 0,
	}
}
