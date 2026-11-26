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
import type { CreateTicketSaleInput } from '../services/ticket-sale-client'

export type { DateTimeInput, FieldError }

/** Maximum length of the sale's name, in characters. */
export const MAX_NAME_LENGTH = 100

/**
 * The editable model of the sale form: its name, its time zone and its window.
 * The window's start and end are each a date and a 24-hour time read in the
 * sale's time zone whatever the browser's zone is (design D19). The seat
 * types, prices and quantities are the event's TicketStocks and the
 * per-account limit is the event's, so the sale carries none of them.
 */
export interface TicketSaleFormModel {
	name: string
	/** The IANA zone the window is read in; '' while none is chosen. */
	timeZone: string
	saleStart: DateTimeInput
	saleEnd: DateTimeInput
}

/** Per-field errors, shown next to each control. */
export interface TicketSaleFormErrors {
	name?: FieldError
	/** No time zone is chosen, or the server refused the one chosen. */
	timeZone?: FieldError
	/** The start's date is unset, or the window overlaps another sale. */
	saleStartDate?: FieldError
	/** The start's time is unset, or skipped by the clocks moving forward. */
	saleStartTime?: FieldError
	/** The end's date is unset, or the end is out of order. */
	saleEndDate?: FieldError
	saleEndTime?: FieldError
}

/** What the form is checked against besides its own values. */
export interface TicketSaleFormContext {
	/** The event's start; the sale must end by then. */
	readonly eventStart: Date | null
}

/**
 * The form for an event without a first-come sale: the name is the given
 * default name, the zone is the given one ('' while the member must choose)
 * and the sale ends at the event's start time in that zone.
 */
export function blankFormModel(
	eventStart: Date | null,
	defaultName = '',
	timeZone = '',
): TicketSaleFormModel {
	return {
		name: defaultName,
		timeZone,
		saleStart: emptyDateTimeInput(),
		saleEnd:
			eventStart && timeZone
				? toDateTimeInput(wallInZone(eventStart, timeZone))
				: emptyDateTimeInput(),
	}
}

/** The form for an existing sale, from its stored values. */
export function formModelOf(sale: {
	readonly name: string
	readonly timeZone: string
	readonly saleStart: DateTimeInput | null
	readonly saleEnd: DateTimeInput | null
}): TicketSaleFormModel {
	return {
		name: sale.name,
		timeZone: sale.timeZone,
		saleStart: sale.saleStart ?? emptyDateTimeInput(),
		saleEnd: sale.saleEnd ?? emptyDateTimeInput(),
	}
}

/**
 * Checks the form the way the server will, so errors show next to the field
 * before a round trip: the name 1–{@link MAX_NAME_LENGTH} characters, a time
 * zone, both times required and existing in that zone, and the end after the
 * start and not after the event's start time.
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
	if (model.timeZone === '') {
		errors.timeZone = { key: 'saleEditor.error.timeZone' }
	}

	const startUnset = unsetPartOf(model.saleStart)
	if (startUnset === 'date') {
		errors.saleStartDate = { key: 'firstComeEditor.error.start' }
	} else if (startUnset === 'time') {
		errors.saleStartTime = { key: 'firstComeEditor.error.start' }
	}
	const endUnset = unsetPartOf(model.saleEnd)
	if (endUnset === 'date') {
		errors.saleEndDate = { key: 'firstComeEditor.error.end' }
	} else if (endUnset === 'time') {
		errors.saleEndTime = { key: 'firstComeEditor.error.end' }
	}

	// The times can be compared once there is a zone to read them in.
	if (model.timeZone === '') return errors
	const start = instantOfInput(model.saleStart, model.timeZone)
	const end = instantOfInput(model.saleEnd, model.timeZone)
	if (!start && !startUnset) {
		errors.saleStartTime = { key: 'saleEditor.error.timeSkipped' }
	}
	if (!end && !endUnset) {
		errors.saleEndTime = { key: 'saleEditor.error.timeSkipped' }
	}
	if (!end || errors.saleEndDate || errors.saleEndTime) return errors
	if (ctx.eventStart && end.getTime() > ctx.eventStart.getTime()) {
		errors.saleEndDate = {
			key: 'firstComeEditor.error.endAfterEvent',
			params: {
				eventStart: {
					wall: wallInZone(ctx.eventStart, model.timeZone),
					zone: model.timeZone,
				},
			},
		}
	} else if (start && end.getTime() <= start.getTime()) {
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
	const zero = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 }
	return {
		seriesId,
		name: model.name.trim(),
		method: 'firstCome',
		saleStart: wallOfInput(model.saleStart) ?? zero,
		saleEnd: wallOfInput(model.saleEnd) ?? zero,
		timeZone: model.timeZone,
		eventIds: [eventId],
	}
}
