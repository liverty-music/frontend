import type { ConfigureLotteryPhaseInput } from '../services/lottery-phase-client'

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

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The editable, transport-agnostic model of the lottery-phase form. Times are
 * `datetime-local` strings (`YYYY-MM-DDTHH:mm`) bound directly onto native
 * `<input type="datetime-local">` controls; numeric fields are kept as strings
 * so an empty control is distinguishable from `0` and `value.bind` maps onto the
 * native `<input type="number">` without coercion surprises.
 */
export interface LotteryPhaseFormModel {
	/** `datetime-local` string; empty when unset. */
	openTime: string
	/** `datetime-local` string; empty when unset. */
	closeTime: string
	/** Positive integer (ticket capacity), as a raw input string. */
	ticketCapacity: string
	/** Positive integer, ≤ capacity, as a raw input string. */
	maxTicketsPerApplication: string
	/** Positive whole-yen JPY price, as a raw input string. */
	ticketPrice: string
}

/** Per-field validation errors, keyed for inline display next to each control. */
export interface LotteryPhaseFormErrors {
	openTime?: string
	closeTime?: string
	window?: string
	ticketCapacity?: string
	maxTicketsPerApplication?: string
	ticketPrice?: string
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
 * Returns a blank form model with the window defaulted: open now, close
 * {@link DEFAULT_WINDOW_DAYS} later. `now` is injected for deterministic tests.
 */
export function emptyFormModel(now: Date = new Date()): LotteryPhaseFormModel {
	const close = new Date(now.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY)
	return {
		openTime: toDateTimeLocal(now),
		closeTime: toDateTimeLocal(close),
		ticketCapacity: '',
		maxTicketsPerApplication: '',
		ticketPrice: '',
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
 * inline errors before a round-trip: open/close required and parseable; the
 * window must be {@link MIN_WINDOW_DAYS}–{@link MAX_WINDOW_DAYS} days long with
 * close strictly after open; capacity, max-per-application, and price each a
 * positive integer; and max must not exceed capacity.
 */
export function validateLotteryPhaseForm(
	model: LotteryPhaseFormModel,
): LotteryPhaseFormErrors {
	const errors: LotteryPhaseFormErrors = {}

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
		}
	}

	const capacity = parsePositiveInt(model.ticketCapacity)
	if (capacity === null) {
		errors.ticketCapacity = 'Ticket capacity must be a positive whole number.'
	}

	const max = parsePositiveInt(model.maxTicketsPerApplication)
	if (max === null) {
		errors.maxTicketsPerApplication =
			'Max tickets per application must be a positive whole number.'
	} else if (capacity !== null && max > capacity) {
		errors.maxTicketsPerApplication =
			'Max tickets per application cannot exceed the ticket capacity.'
	}

	const price = parsePositiveInt(model.ticketPrice)
	if (price === null) {
		errors.ticketPrice = 'Ticket price (JPY) must be a positive whole number.'
	}

	return errors
}

/** True when the validation result has no field-level errors. */
export function isFormValid(errors: LotteryPhaseFormErrors): boolean {
	return (
		!errors.openTime &&
		!errors.closeTime &&
		!errors.window &&
		!errors.ticketCapacity &&
		!errors.maxTicketsPerApplication &&
		!errors.ticketPrice
	)
}

/**
 * Converts a validated form model into the transport-agnostic
 * {@link ConfigureLotteryPhaseInput}. Assumes the model already passed
 * {@link validateLotteryPhaseForm} (the caller gates on validity first); a
 * defensive parse failure falls back to a zero/epoch value the server rejects.
 */
export function toConfigureInput(
	eventId: string,
	model: LotteryPhaseFormModel,
): ConfigureLotteryPhaseInput {
	return {
		eventId,
		openTime: parseDateTimeLocal(model.openTime) ?? new Date(0),
		closeTime: parseDateTimeLocal(model.closeTime) ?? new Date(0),
		ticketCapacity: Number(model.ticketCapacity.trim()) || 0,
		maxTicketsPerApplication:
			Number(model.maxTicketsPerApplication.trim()) || 0,
		ticketPrice: Number(model.ticketPrice.trim()) || 0,
	}
}
