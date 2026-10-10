import { formatJstDateTime } from '../../shared/lib/reception/jst-format'
import type { ConfigureTicketSaleInput } from '../services/ticket-sale-client'

/** The per-account limit a new sale starts with (server default too). */
export const DEFAULT_PER_ACCOUNT_LIMIT = 4
/** Inclusive bounds of the per-account limit (one entry QR covers ≤ 10). */
export const MIN_PER_ACCOUNT_LIMIT = 1
export const MAX_PER_ACCOUNT_LIMIT = 10
/** Inclusive bounds of the tax-inclusive price per ticket, in yen. */
export const MIN_PRICE = 1
export const MAX_PRICE = 1_000_000

/** Japan has no daylight saving time: Japan time is always UTC+9. */
const JST_OFFSET_HOURS = 9

/**
 * The editable model of the sale form. Times are `datetime-local` strings
 * (`YYYY-MM-DDTHH:mm`) read as Japan time whatever the browser's zone is;
 * numbers stay raw input strings so an empty control differs from `0`.
 */
export interface TicketSaleFormModel {
	saleStart: string
	saleEnd: string
	price: string
	quantity: string
	perAccountLimit: string
}

/** Per-field errors, shown next to each control. */
export interface TicketSaleFormErrors {
	saleStart?: string
	saleEnd?: string
	price?: string
	quantity?: string
	perAccountLimit?: string
}

/** What the form is checked against besides its own values. */
export interface TicketSaleFormContext {
	/** The event's start time; the sale must end by then. */
	readonly eventStart: Date | null
	/** Tickets sold plus held: the quantity cannot go below it. */
	readonly soldCount: number
	readonly heldCount: number
}

/** Formats an instant as a Japan-time `YYYY-MM-DDTHH:mm`. */
export function toJstDateTimeLocal(date: Date): string {
	return formatJstDateTime(date).replace(' ', 'T')
}

/**
 * Reads a `YYYY-MM-DDTHH:mm` string as Japan time, or null when it is blank
 * or not a real calendar time.
 */
export function parseJstDateTimeLocal(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
	if (!m) return null
	const [y, mo, d, h, mi] = m.slice(1).map(Number)
	const date = new Date(Date.UTC(y, mo - 1, d, h - JST_OFFSET_HOURS, mi))
	// Reject rollovers such as 2026-02-30 or 25:00.
	return toJstDateTimeLocal(date) === value.trim() ? date : null
}

/** Parses a raw input string into a whole number, or null. */
function parseWholeNumber(value: string): number | null {
	const trimmed = value.trim()
	if (!/^\d+$/.test(trimmed)) return null
	const n = Number(trimmed)
	return Number.isSafeInteger(n) ? n : null
}

const yen = new Intl.NumberFormat('ja-JP')

/** `3,000` for 3000. */
export function formatYen(value: number | bigint): string {
	return yen.format(value)
}

/**
 * The form for an event without a sale: the sale ends at the event's start
 * time and the limit is {@link DEFAULT_PER_ACCOUNT_LIMIT}.
 */
export function blankFormModel(eventStart: Date | null): TicketSaleFormModel {
	return {
		saleStart: '',
		saleEnd: eventStart ? toJstDateTimeLocal(eventStart) : '',
		price: '',
		quantity: '',
		perAccountLimit: String(DEFAULT_PER_ACCOUNT_LIMIT),
	}
}

/** The form for an existing sale, from its stored values. */
export function formModelOf(sale: {
	readonly saleStart: Date | null
	readonly saleEnd: Date | null
	readonly price: bigint
	readonly quantity: number
	readonly perAccountLimit: number
}): TicketSaleFormModel {
	return {
		saleStart: sale.saleStart ? toJstDateTimeLocal(sale.saleStart) : '',
		saleEnd: sale.saleEnd ? toJstDateTimeLocal(sale.saleEnd) : '',
		price: sale.price.toString(),
		quantity: String(sale.quantity),
		perAccountLimit: String(sale.perAccountLimit),
	}
}

/**
 * Checks the form the way the server will, so errors show next to the field
 * before a round trip: both times required, the end after the start and not
 * after the event's start time, the price {@link MIN_PRICE}–{@link MAX_PRICE}
 * yen, the quantity at least 1 and at least what is sold and held, and the
 * limit {@link MIN_PER_ACCOUNT_LIMIT}–{@link MAX_PER_ACCOUNT_LIMIT}.
 */
export function validateTicketSaleForm(
	model: TicketSaleFormModel,
	ctx: TicketSaleFormContext,
): TicketSaleFormErrors {
	const errors: TicketSaleFormErrors = {}

	const start = parseJstDateTimeLocal(model.saleStart)
	const end = parseJstDateTimeLocal(model.saleEnd)
	if (start === null) {
		errors.saleStart = '販売開始日時を入力してください。'
	}
	if (end === null) {
		errors.saleEnd = '販売終了日時を入力してください。'
	} else if (ctx.eventStart && end.getTime() > ctx.eventStart.getTime()) {
		errors.saleEnd = `販売終了は開演時刻（${formatJstDateTime(ctx.eventStart)}）以前にしてください。`
	} else if (start !== null && end.getTime() <= start.getTime()) {
		errors.saleEnd = '販売終了は販売開始より後にしてください。'
	}

	const price = parseWholeNumber(model.price)
	if (price === null || price < MIN_PRICE || price > MAX_PRICE) {
		errors.price = `価格は${formatYen(MIN_PRICE)}円から${formatYen(MAX_PRICE)}円の整数で入力してください。`
	}

	const quantity = parseWholeNumber(model.quantity)
	const floor = ctx.soldCount + ctx.heldCount
	if (quantity === null || quantity < 1) {
		errors.quantity = '販売数は1枚以上の整数で入力してください。'
	} else if (quantity < floor) {
		errors.quantity = `販売済み${ctx.soldCount}枚と確保中${ctx.heldCount}枚の合計（${floor}枚）を下回る販売数にはできません。`
	}

	const limit = parseWholeNumber(model.perAccountLimit)
	if (
		limit === null ||
		limit < MIN_PER_ACCOUNT_LIMIT ||
		limit > MAX_PER_ACCOUNT_LIMIT
	) {
		errors.perAccountLimit = `1アカウントあたりの上限は${MIN_PER_ACCOUNT_LIMIT}〜${MAX_PER_ACCOUNT_LIMIT}枚で入力してください。`
	}

	return errors
}

/** True when no field has an error. */
export function isFormValid(errors: TicketSaleFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated model into the client input. The caller gates on
 * {@link validateTicketSaleForm} first.
 */
export function toConfigureInput(
	eventId: string,
	model: TicketSaleFormModel,
): ConfigureTicketSaleInput {
	return {
		eventId,
		saleStartTime: parseJstDateTimeLocal(model.saleStart) ?? new Date(0),
		saleEndTime: parseJstDateTimeLocal(model.saleEnd) ?? undefined,
		price: Number(model.price.trim()),
		quantity: Number(model.quantity.trim()),
		perAccountLimit: Number(model.perAccountLimit.trim()),
	}
}
