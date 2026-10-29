import type { FieldError } from '../i18n/field-error'
import {
	emptyJstDateTime,
	type JstDateTime,
	parseJstDateTime,
	toJstDateTime,
	unsetPartOf,
} from '../i18n/format'
import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

export type { FieldError, JstDateTime }

/** Maximum length of the sale's name, in characters. */
export const MAX_NAME_LENGTH = 100

/**
 * The editable model of the sale form: its name and window. The window's
 * start and end are each a date and a 24-hour time read as Japan time
 * whatever the browser's zone is (design D19). The seat types, prices and
 * quantities are the event's TicketStocks and the per-account limit is the
 * event's, so the sale carries none of them.
 */
export interface TicketSaleFormModel {
	name: string
	saleStart: JstDateTime
	saleEnd: JstDateTime
}

/** Per-field errors, shown next to each control. */
export interface TicketSaleFormErrors {
	name?: FieldError
	/** The start's date is unset, or the window overlaps another sale. */
	saleStartDate?: FieldError
	/** The start's time is unset. */
	saleStartTime?: FieldError
	/** The end's date is unset, or the end is out of order. */
	saleEndDate?: FieldError
	saleEndTime?: FieldError
}

/** What the form is checked against besides its own values. */
export interface TicketSaleFormContext {
	/** The event's start time; the sale must end by then. */
	readonly eventStart: Date | null
}

/** The instant of a date and time entered in Japan time, or null. */
export function parseDateTime(value: JstDateTime): Date | null {
	return parseJstDateTime(value) ?? null
}

/**
 * The form for an event without a first-come sale: the name is the given
 * default name and the sale ends at the event's start time.
 */
export function blankFormModel(
	eventStart: Date | null,
	defaultName = '',
): TicketSaleFormModel {
	return {
		name: defaultName,
		saleStart: emptyJstDateTime(),
		saleEnd: eventStart ? toJstDateTime(eventStart) : emptyJstDateTime(),
	}
}

/** The form for an existing sale, from its stored values. */
export function formModelOf(sale: {
	readonly name: string
	readonly saleStartTime: Date | null
	readonly saleEndTime: Date | null
}): TicketSaleFormModel {
	return {
		name: sale.name,
		saleStart: sale.saleStartTime
			? toJstDateTime(sale.saleStartTime)
			: emptyJstDateTime(),
		saleEnd: sale.saleEndTime
			? toJstDateTime(sale.saleEndTime)
			: emptyJstDateTime(),
	}
}

/**
 * Checks the form the way the server will, so errors show next to the field
 * before a round trip: the name 1–{@link MAX_NAME_LENGTH} characters, both
 * times required, and the end after the start and not after the event's
 * start time.
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

	const startUnset = unsetPartOf(model.saleStart)
	if (startUnset === 'date') {
		errors.saleStartDate = { key: 'firstComeEditor.error.start' }
	} else if (startUnset === 'time') {
		errors.saleStartTime = { key: 'firstComeEditor.error.start' }
	}
	const start = parseDateTime(model.saleStart)
	const end = parseDateTime(model.saleEnd)
	const endUnset = unsetPartOf(model.saleEnd)
	if (endUnset === 'date') {
		errors.saleEndDate = { key: 'firstComeEditor.error.end' }
	} else if (endUnset === 'time' || end === null) {
		errors.saleEndTime = { key: 'firstComeEditor.error.end' }
	} else if (ctx.eventStart && end.getTime() > ctx.eventStart.getTime()) {
		errors.saleEndDate = {
			key: 'firstComeEditor.error.endAfterEvent',
			params: { eventStart: ctx.eventStart },
		}
	} else if (start !== null && end.getTime() <= start.getTime()) {
		errors.saleEndDate = { key: 'firstComeEditor.error.endBeforeStart' }
	}

	return errors
}

/** True when no field has an error. */
export function isFormValid(errors: TicketSaleFormErrors): boolean {
	return Object.values(errors).every((e) => !e)
}

/**
 * Converts a validated model into the input of a FirstCome sale of the
 * event's Series naming the event. The caller gates on
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
		saleStartTime: parseDateTime(model.saleStart) ?? new Date(0),
		saleEndTime: parseDateTime(model.saleEnd) ?? new Date(0),
		eventIds: [eventId],
	}
}
