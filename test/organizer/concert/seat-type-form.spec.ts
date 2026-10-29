import { describe, expect, it } from 'vitest'
import {
	emptySeatTypeForm,
	isSeatTypeFormValid,
	validateSeatTypeForm,
} from '../../../organizer/concert/seat-type-form'
import { validateStockForm } from '../../../organizer/event/sales-tab/sales-tab'

const CONCERT_SPEC = 'components/infrastructure/organizer/web/route/concert'

describe('a new seat type', () => {
	it('accepts a name of 1 to 50 characters and a price of 1 to 1,000,000 yen', () => {
		expect(
			isSeatTypeFormValid(
				validateSeatTypeForm({ name: 'S席', price: '12000' }, []),
			),
		).toBe(true)
		expect(
			validateSeatTypeForm({ name: 'あ'.repeat(50), price: '1' }, []).name,
		).toBeUndefined()
		expect(
			validateSeatTypeForm({ name: 'あ'.repeat(51), price: '1' }, []).name?.key,
		).toBe('seatType.error.nameLength')
		for (const price of ['', '0', '1000001', '12.5', '-1']) {
			expect(
				validateSeatTypeForm({ name: 'S席', price }, []).price?.key,
				price,
			).toBe('seatType.error.price')
		}
		expect(
			validateSeatTypeForm({ name: 'S席', price: '1000000' }, []).price,
		).toBeUndefined()
		expect(validateSeatTypeForm(emptySeatTypeForm(), []).name?.key).toBe(
			'seatType.error.name',
		)
	})

	it(`@spec ${CONCERT_SPEC} "Name already used"`, () => {
		const errors = validateSeatTypeForm({ name: ' S席 ', price: '9000' }, [
			'S席',
			'A席',
		])
		expect(errors.name).toEqual({
			key: 'seatType.error.nameUsed',
			params: { name: 'S席' },
		})
		expect(isSeatTypeFormValid(errors)).toBe(false)
	})
})

describe('a new stock of the event', () => {
	it('asks for a seat type not yet stocked and a quantity of at least 1', () => {
		expect(
			validateStockForm({ seatTypeId: 'seat-a', quantity: '700' }, ['seat-a']),
		).toEqual({})
		expect(
			validateStockForm({ seatTypeId: 'seat-s', quantity: '20' }, ['seat-a'])
				.seatTypeId?.key,
		).toBe('stock.error.seatType')
		for (const quantity of ['', '0', '1.5', '-3']) {
			expect(
				validateStockForm({ seatTypeId: 'seat-a', quantity }, ['seat-a'])
					.quantity?.key,
			).toBe('stock.error.quantity')
		}
	})
})
