import type { FieldError } from '../i18n/field-error'

/** Inclusive bounds of a seat type's name length, in characters. */
export const MAX_SEAT_TYPE_NAME_LENGTH = 50
/** Inclusive bounds of a seat type's tax-inclusive price, in yen. */
export const MIN_SEAT_TYPE_PRICE = 1
export const MAX_SEAT_TYPE_PRICE = 1_000_000

/** The input of 席種を追加 on the concert page, as raw strings. */
export interface SeatTypeFormModel {
	name: string
	price: string
}

export interface SeatTypeFormErrors {
	name?: FieldError
	price?: FieldError
}

export function emptySeatTypeForm(): SeatTypeFormModel {
	return { name: '', price: '' }
}

/**
 * Checks a new seat type the way the server will: a name of 1 to
 * {@link MAX_SEAT_TYPE_NAME_LENGTH} characters not used by another seat type
 * of the concert, and a whole price of {@link MIN_SEAT_TYPE_PRICE} to
 * {@link MAX_SEAT_TYPE_PRICE} yen.
 */
export function validateSeatTypeForm(
	model: SeatTypeFormModel,
	usedNames: readonly string[],
): SeatTypeFormErrors {
	const errors: SeatTypeFormErrors = {}
	const name = model.name.trim()
	if (name === '') {
		errors.name = { key: 'seatType.error.name' }
	} else if ([...name].length > MAX_SEAT_TYPE_NAME_LENGTH) {
		errors.name = {
			key: 'seatType.error.nameLength',
			params: { max: MAX_SEAT_TYPE_NAME_LENGTH },
		}
	} else if (usedNames.includes(name)) {
		errors.name = { key: 'seatType.error.nameUsed', params: { name } }
	}
	const price = model.price.trim()
	const value = /^\d+$/.test(price) ? Number(price) : Number.NaN
	if (
		!Number.isSafeInteger(value) ||
		value < MIN_SEAT_TYPE_PRICE ||
		value > MAX_SEAT_TYPE_PRICE
	) {
		errors.price = {
			key: 'seatType.error.price',
			params: { min: MIN_SEAT_TYPE_PRICE, max: MAX_SEAT_TYPE_PRICE },
		}
	}
	return errors
}

export function isSeatTypeFormValid(errors: SeatTypeFormErrors): boolean {
	return !errors.name && !errors.price
}
