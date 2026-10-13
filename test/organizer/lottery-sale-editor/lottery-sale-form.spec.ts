import { describe, expect, it } from 'vitest'
import {
	DEFAULT_PER_ACCOUNT_LIMIT,
	DEFAULT_WINDOW_DAYS,
	emptyFormModel,
	isFormValid,
	type LotterySaleFormModel,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	parseDateTime,
	toCreateInput,
	toDateTime,
	validateLotterySaleForm,
	windowDurationDays,
} from '../../../organizer/lottery-sale-editor/lottery-sale-form'

const NOW = new Date(2026, 0, 1, 12, 0, 0)

/** A fully-valid baseline model with a `windowDays`-day window. */
function validModel(windowDays = DEFAULT_WINDOW_DAYS): LotterySaleFormModel {
	const open = new Date(NOW.getTime())
	const close = new Date(NOW.getTime() + windowDays * 24 * 60 * 60 * 1000)
	return {
		name: 'ファンクラブ先行',
		saleStart: toDateTime(open),
		saleEnd: toDateTime(close),
		quantity: '200',
		perAccountLimit: '4',
		price: '6500',
	}
}

describe('emptyFormModel', () => {
	it('opens the window now and closes it 10 days later', () => {
		// @spec components/infrastructure/organizer/web/route/lottery-sale-editor "Blank form"
		// 12:00 in Japan time, whatever the device's time zone.
		const model = emptyFormModel(new Date('2026-10-01T12:00:00+09:00'))
		expect(model.saleStart).toEqual({ date: '2026-10-01', time: '12:00' })
		expect(model.saleEnd).toEqual({ date: '2026-10-11', time: '12:00' })
		expect(model.name).toBe('')
		expect(model.perAccountLimit).toBe(String(DEFAULT_PER_ACCOUNT_LIMIT))
	})

	it('rounds "now" up to the time field\'s 5-minute steps', () => {
		const model = emptyFormModel(new Date('2026-10-01T12:07:30+09:00'))
		expect(model.saleStart).toEqual({ date: '2026-10-01', time: '12:10' })
		expect(model.saleEnd).toEqual({ date: '2026-10-11', time: '12:10' })
		// Just before midnight, the rounding moves to the next day.
		const late = emptyFormModel(new Date('2026-10-01T23:58:00+09:00'))
		expect(late.saleStart).toEqual({ date: '2026-10-02', time: '00:00' })
	})

	it('defaults the window to DEFAULT_WINDOW_DAYS (10 days) and passes window validation', () => {
		const model = emptyFormModel(NOW)
		const open = parseDateTime(model.saleStart)
		const close = parseDateTime(model.saleEnd)
		expect(open).not.toBeNull()
		expect(close).not.toBeNull()
		if (open && close) {
			expect(windowDurationDays(open, close)).toBe(DEFAULT_WINDOW_DAYS)
		}
		const errors = validateLotterySaleForm(model)
		expect(errors.window).toBeUndefined()
		expect(errors.saleStartDate).toBeUndefined()
		expect(errors.saleStartTime).toBeUndefined()
		expect(errors.saleEndDate).toBeUndefined()
		expect(errors.saleEndTime).toBeUndefined()
	})
})

describe('validateLotterySaleForm — window bounds', () => {
	it('accepts the default 10-day window', () => {
		expect(
			isFormValid(validateLotterySaleForm(validModel(DEFAULT_WINDOW_DAYS))),
		).toBe(true)
	})

	it.each([MIN_WINDOW_DAYS, 7, MAX_WINDOW_DAYS])(
		'accepts a %s-day window (within 1–14)',
		(days) => {
			const errors = validateLotterySaleForm(validModel(days))
			expect(errors.window).toBeUndefined()
			expect(isFormValid(errors)).toBe(true)
		},
	)

	it('rejects a window shorter than 1 day', () => {
		const errors = validateLotterySaleForm(validModel(0.5))
		expect(errors.window).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a window longer than 14 days', () => {
		const errors = validateLotterySaleForm(validModel(15))
		expect(errors.window).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a close time not after the open time', () => {
		const model = validModel(DEFAULT_WINDOW_DAYS)
		model.saleEnd = { ...model.saleStart }
		expect(validateLotterySaleForm(model).window).toBeDefined()
	})

	it('flags a missing or malformed date on the date field', () => {
		const model = validModel()
		model.saleStart = { date: '', time: '12:00' }
		model.saleEnd = { date: 'not-a-date', time: '12:00' }
		const errors = validateLotterySaleForm(model)
		expect(errors.saleStartDate).toEqual({ key: 'lotteryEditor.error.start' })
		expect(errors.saleEndDate).toEqual({ key: 'lotteryEditor.error.end' })
		expect(errors.saleStartTime).toBeUndefined()
		expect(errors.window).toBeUndefined()
	})

	it('flags a missing time on the time field', () => {
		const model = validModel()
		model.saleStart = { ...model.saleStart, time: '' }
		model.saleEnd = { ...model.saleEnd, time: '' }
		const errors = validateLotterySaleForm(model)
		expect(errors.saleStartDate).toBeUndefined()
		expect(errors.saleStartTime).toEqual({ key: 'lotteryEditor.error.start' })
		expect(errors.saleEndTime).toEqual({ key: 'lotteryEditor.error.end' })
	})
})

describe('validateLotterySaleForm — name', () => {
	it.each(['', '   '])('requires a name (%j)', (name) => {
		const model = validModel()
		model.name = name
		expect(validateLotterySaleForm(model).name).toBeDefined()
	})

	it('accepts a name of 100 characters and rejects 101', () => {
		const model = validModel()
		model.name = 'あ'.repeat(100)
		expect(validateLotterySaleForm(model).name).toBeUndefined()
		model.name = 'あ'.repeat(101)
		expect(validateLotterySaleForm(model).name).toBeDefined()
	})
})

describe('validateLotterySaleForm — ticket fields', () => {
	it.each(['', '0', '-5', '3.5', 'abc'])(
		'rejects a non-positive-integer quantity (%s)',
		(value) => {
			const model = validModel()
			model.quantity = value
			expect(validateLotterySaleForm(model).quantity).toBeDefined()
		},
	)

	it.each(['', '0', '-1', '2.2', 'x'])(
		'rejects a non-positive-integer per-account limit (%s)',
		(value) => {
			const model = validModel()
			model.perAccountLimit = value
			expect(validateLotterySaleForm(model).perAccountLimit).toBeDefined()
		},
	)

	it.each(['', '0', '-100', '12.5', 'free'])(
		'rejects a non-positive-integer price (%s)',
		(value) => {
			const model = validModel()
			model.price = value
			expect(validateLotterySaleForm(model).price).toBeDefined()
		},
	)

	it('rejects a per-account limit above the quantity', () => {
		const model = validModel()
		model.quantity = '3'
		model.perAccountLimit = '4'
		const errors = validateLotterySaleForm(model)
		expect(errors.perAccountLimit).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a per-account limit above one admission code (11)', () => {
		// @spec components/entity/ticket-type "Limit larger than one admission code"
		const model = validModel()
		model.quantity = '100'
		model.perAccountLimit = '11'
		const errors = validateLotterySaleForm(model)
		expect(errors.perAccountLimit).toEqual({
			key: 'lotteryEditor.error.limitMax',
			params: { max: MAX_PER_ACCOUNT_LIMIT },
		})
		expect(isFormValid(errors)).toBe(false)
	})

	it.each(['1', '10'])(
		'accepts a per-account limit at the bound (%s)',
		(value) => {
			const model = validModel()
			model.quantity = '100'
			model.perAccountLimit = value
			const errors = validateLotterySaleForm(model)
			expect(errors.perAccountLimit).toBeUndefined()
			expect(isFormValid(errors)).toBe(true)
		},
	)

	it('accepts a per-account limit equal to the quantity', () => {
		const model = validModel()
		model.quantity = '4'
		model.perAccountLimit = '4'
		const errors = validateLotterySaleForm(model)
		expect(errors.perAccountLimit).toBeUndefined()
		expect(isFormValid(errors)).toBe(true)
	})
})

describe('toCreateInput', () => {
	it('marshals a validated model into a Lottery sale with one TicketType', () => {
		const input = toCreateInput(
			'series-1',
			'event-1',
			validModel(DEFAULT_WINDOW_DAYS),
		)
		expect(input).toMatchObject({
			seriesId: 'series-1',
			name: 'ファンクラブ先行',
			method: 'lottery',
			eventId: 'event-1',
			quantity: 200,
			perAccountLimit: 4,
			price: 6500,
		})
		expect(
			windowDurationDays(input.saleStartTime, input.saleEndTime ?? new Date(0)),
		).toBe(DEFAULT_WINDOW_DAYS)
	})
})
