import type { FieldError } from '../i18n/field-error'
import {
	parseJstDateTimeLocal as parseJst,
	toJstDateTimeLocal as toJst,
} from '../i18n/format'
import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

export type { FieldError }

/** The name a new first-come sale starts with. */
/** Maximum length of the sale's name, in characters. */
export const MAX_NAME_LENGTH = 100
/** The per-account limit a new sale starts with (server default too). */
export const DEFAULT_PER_ACCOUNT_LIMIT = 4
/** Inclusive bounds of the per-account limit (one entry QR covers ≤ 10). */
export const MIN_PER_ACCOUNT_LIMIT = 1
export const MAX_PER_ACCOUNT_LIMIT = 10
/** Inclusive bounds of the tax-inclusive price per ticket, in yen. */
export const MIN_PRICE = 1
export const MAX_PRICE = 1_000_000

/** Japan has no daylight saving time: Japan time is always UTC+9. */

/**
 * The editable model of the sale form. Times are `datetime-local` strings
 * (`YYYY-MM-DDTHH:mm`) read as Japan time whatever the browser's zone is;
 * numbers stay raw input strings so an empty control differs from `0`.
 */
export interface TicketSaleFormModel {
	name: string
	saleStartTime: string
	saleEndTime: string
	price: string
	quantity: string
	perAccountLimit: string
}

/** Per-field errors, shown next to each control. */
export interface TicketSaleFormErrors {
	name?: FieldError
	saleStartTime?: FieldError
	saleEndTime?: FieldError
	price?: FieldError
	quantity?: FieldError
	perAccountLimit?: FieldError
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
	return toJst(date)
}

export function parseJstDateTimeLocal(value: string): Date | null {
	return parseJst(value.trim()) ?? null
}

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
 * The form for an event without a first-come sale: the name is
 * the given default name, the sale ends at the event's start time and the
 * limit is {@link DEFAULT_PER_ACCOUNT_LIMIT}.
 */
export function blankFormModel(
	eventStart: Date | null,
	defaultName = '',
): TicketSaleFormModel {
	return {
		name: defaultName,
		saleStartTime: '',
		saleEndTime: eventStart ? toJstDateTimeLocal(eventStart) : '',
		price: '',
		quantity: '',
		perAccountLimit: String(DEFAULT_PER_ACCOUNT_LIMIT),
	}
}

/** The form for an existing sale, from its stored values. */
export function formModelOf(sale: {
	readonly name: string
	readonly saleStartTime: Date | null
	readonly saleEndTime: Date | null
	readonly price: bigint
	readonly quantity: number
	readonly perAccountLimit: number
}): TicketSaleFormModel {
	return {
		name: sale.name,
		saleStartTime: sale.saleStartTime
			? toJstDateTimeLocal(sale.saleStartTime)
			: '',
		saleEndTime: sale.saleEndTime ? toJstDateTimeLocal(sale.saleEndTime) : '',
		price: sale.price.toString(),
		quantity: String(sale.quantity),
		perAccountLimit: String(sale.perAccountLimit),
	}
}

/**
 * Checks the form the way the server will, so errors show next to the field
 * before a round trip: the name 1–{@link MAX_NAME_LENGTH} characters, both
 * times required, the end after the start and not after the event's start
 * time, the price {@link MIN_PRICE}–{@link MAX_PRICE} yen, the quantity at
 * least 1 and at least what is sold and held, and the limit
 * {@link MIN_PER_ACCOUNT_LIMIT}–{@link MAX_PER_ACCOUNT_LIMIT} and not above
 * the quantity.
 */
export function validateTicketSaleForm(
	model: TicketSaleFormModel,
	ctx: TicketSaleFormContext,
): TicketSaleFormErrors {
	const errors: TicketSaleFormErrors = {}

	const name = model.name.trim()
	if (name === '') {
		errors.name = { key: 'firstComeEditor.error.name' }
	} else if ([...name].length > MAX_NAME_LENGTH) {
		errors.name = {
			key: 'firstComeEditor.error.nameLength',
			params: { max: MAX_NAME_LENGTH },
		}
	}

	const start = parseJstDateTimeLocal(model.saleStartTime)
	const end = parseJstDateTimeLocal(model.saleEndTime)
	if (start === null) {
		errors.saleStartTime = { key: 'firstComeEditor.error.start' }
	}
	if (end === null) {
		errors.saleEndTime = { key: 'firstComeEditor.error.end' }
	} else if (ctx.eventStart && end.getTime() > ctx.eventStart.getTime()) {
		errors.saleEndTime = {
			key: 'firstComeEditor.error.endAfterEvent',
			params: { eventStart: ctx.eventStart },
		}
	} else if (start !== null && end.getTime() <= start.getTime()) {
		errors.saleEndTime = { key: 'firstComeEditor.error.endBeforeStart' }
	}

	const price = parseWholeNumber(model.price)
	if (price === null || price < MIN_PRICE || price > MAX_PRICE) {
		errors.price = {
			key: 'firstComeEditor.error.price',
			params: { min: MIN_PRICE, max: MAX_PRICE },
		}
	}

	const quantity = parseWholeNumber(model.quantity)
	const floor = ctx.soldCount + ctx.heldCount
	if (quantity === null || quantity < 1) {
		errors.quantity = { key: 'firstComeEditor.error.quantity' }
	} else if (quantity < floor) {
		errors.quantity = {
			key: 'firstComeEditor.error.quantityFloor',
			params: { sold: ctx.soldCount, held: ctx.heldCount, floor },
		}
	}

	const limit = parseWholeNumber(model.perAccountLimit)
	if (
		limit === null ||
		limit < MIN_PER_ACCOUNT_LIMIT ||
		limit > MAX_PER_ACCOUNT_LIMIT
	) {
		errors.perAccountLimit = {
			key: 'firstComeEditor.error.limit',
			params: { min: MIN_PER_ACCOUNT_LIMIT, max: MAX_PER_ACCOUNT_LIMIT },
		}
	} else if (quantity !== null && quantity >= 1 && limit > quantity) {
		errors.perAccountLimit = { key: 'firstComeEditor.error.limitOverQuantity' }
	}

	return errors
}

/** True when no field has an error. */
export function isFormValid(errors: TicketSaleFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated model into the input of a FirstCome sale of the
 * event's Series with one TicketType for the event. The caller gates on
 * {@link validateTicketSaleForm} first.
 */
export function toCreateInput(
	seriesId: string,
	eventId: string,
	model: TicketSaleFormModel,
): CreateTicketSaleInput {
	return {
		seriesId,
		name: model.name.trim(),
		method: 'firstCome',
		saleStartTime: parseJstDateTimeLocal(model.saleStartTime) ?? new Date(0),
		saleEndTime: parseJstDateTimeLocal(model.saleEndTime) ?? undefined,
		eventId,
		price: Number(model.price.trim()),
		quantity: Number(model.quantity.trim()),
		perAccountLimit: Number(model.perAccountLimit.trim()),
	}
}
