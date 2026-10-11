import { describe, expect, it } from 'vitest'
import {
	DEFAULT_PER_ACCOUNT_LIMIT,
	DEFAULT_WINDOW_DAYS,
	emptyFormModel,
	isFormValid,
	type LotteryPhaseFormModel,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	parseDateTimeLocal,
	toCreateInput,
	toDateTimeLocal,
	validateLotteryPhaseForm,
	windowDurationDays,
} from '../../../organizer/lottery-phase-editor/lottery-phase-form'

const NOW = new Date(2026, 0, 1, 12, 0, 0)

/** A fully-valid baseline model with a `windowDays`-day window. */
function validModel(windowDays = DEFAULT_WINDOW_DAYS): LotteryPhaseFormModel {
	const open = new Date(NOW.getTime())
	const close = new Date(NOW.getTime() + windowDays * 24 * 60 * 60 * 1000)
	return {
		name: 'ファンクラブ先行',
		openTime: toDateTimeLocal(open),
		closeTime: toDateTimeLocal(close),
		quantity: '200',
		perAccountLimit: '4',
		price: '6500',
	}
}

describe('emptyFormModel', () => {
	it('opens the window now and closes it 10 days later', () => {
		// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Blank form"
		const model = emptyFormModel(new Date(2026, 9, 1, 12, 0, 0))
		expect(model.openTime).toBe('2026-10-01T12:00')
		expect(model.closeTime).toBe('2026-10-11T12:00')
		expect(model.name).toBe('')
		expect(model.perAccountLimit).toBe(String(DEFAULT_PER_ACCOUNT_LIMIT))
	})

	it('defaults the window to DEFAULT_WINDOW_DAYS (10 days) and passes window validation', () => {
		const model = emptyFormModel(NOW)
		const open = parseDateTimeLocal(model.openTime)
		const close = parseDateTimeLocal(model.closeTime)
		expect(open).not.toBeNull()
		expect(close).not.toBeNull()
		if (open && close) {
			expect(windowDurationDays(open, close)).toBe(DEFAULT_WINDOW_DAYS)
		}
		const errors = validateLotteryPhaseForm(model)
		expect(errors.window).toBeUndefined()
		expect(errors.openTime).toBeUndefined()
		expect(errors.closeTime).toBeUndefined()
	})
})

describe('validateLotteryPhaseForm — window bounds', () => {
	it('accepts the default 10-day window', () => {
		expect(
			isFormValid(validateLotteryPhaseForm(validModel(DEFAULT_WINDOW_DAYS))),
		).toBe(true)
	})

	it.each([MIN_WINDOW_DAYS, 7, MAX_WINDOW_DAYS])(
		'accepts a %s-day window (within 1–14)',
		(days) => {
			const errors = validateLotteryPhaseForm(validModel(days))
			expect(errors.window).toBeUndefined()
			expect(isFormValid(errors)).toBe(true)
		},
	)

	it('rejects a window shorter than 1 day', () => {
		const errors = validateLotteryPhaseForm(validModel(0.5))
		expect(errors.window).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a window longer than 14 days', () => {
		const errors = validateLotteryPhaseForm(validModel(15))
		expect(errors.window).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a close time not after the open time', () => {
		const model = validModel(DEFAULT_WINDOW_DAYS)
		model.closeTime = model.openTime
		expect(validateLotteryPhaseForm(model).window).toBeDefined()
	})

	it('flags a missing/malformed open or close time', () => {
		const model = validModel()
		model.openTime = ''
		model.closeTime = 'not-a-date'
		const errors = validateLotteryPhaseForm(model)
		expect(errors.openTime).toBeDefined()
		expect(errors.closeTime).toBeDefined()
	})
})

describe('validateLotteryPhaseForm — name', () => {
	it.each(['', '   '])('requires a name (%j)', (name) => {
		const model = validModel()
		model.name = name
		expect(validateLotteryPhaseForm(model).name).toBeDefined()
	})

	it('accepts a name of 100 characters and rejects 101', () => {
		const model = validModel()
		model.name = 'あ'.repeat(100)
		expect(validateLotteryPhaseForm(model).name).toBeUndefined()
		model.name = 'あ'.repeat(101)
		expect(validateLotteryPhaseForm(model).name).toBeDefined()
	})
})

describe('validateLotteryPhaseForm — ticket fields', () => {
	it.each(['', '0', '-5', '3.5', 'abc'])(
		'rejects a non-positive-integer quantity (%s)',
		(value) => {
			const model = validModel()
			model.quantity = value
			expect(validateLotteryPhaseForm(model).quantity).toBeDefined()
		},
	)

	it.each(['', '0', '-1', '2.2', 'x'])(
		'rejects a non-positive-integer per-account limit (%s)',
		(value) => {
			const model = validModel()
			model.perAccountLimit = value
			expect(validateLotteryPhaseForm(model).perAccountLimit).toBeDefined()
		},
	)

	it.each(['', '0', '-100', '12.5', 'free'])(
		'rejects a non-positive-integer price (%s)',
		(value) => {
			const model = validModel()
			model.price = value
			expect(validateLotteryPhaseForm(model).price).toBeDefined()
		},
	)

	it('rejects a per-account limit above the quantity', () => {
		const model = validModel()
		model.quantity = '3'
		model.perAccountLimit = '4'
		const errors = validateLotteryPhaseForm(model)
		expect(errors.perAccountLimit).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects a per-account limit above one entry code (11)', () => {
		// @spec components/entity/ticket-type "Limit larger than one admission code"
		const model = validModel()
		model.quantity = '100'
		model.perAccountLimit = '11'
		const errors = validateLotteryPhaseForm(model)
		expect(errors.perAccountLimit).toContain(String(MAX_PER_ACCOUNT_LIMIT))
		expect(isFormValid(errors)).toBe(false)
	})

	it.each(['1', '10'])(
		'accepts a per-account limit at the bound (%s)',
		(value) => {
			const model = validModel()
			model.quantity = '100'
			model.perAccountLimit = value
			const errors = validateLotteryPhaseForm(model)
			expect(errors.perAccountLimit).toBeUndefined()
			expect(isFormValid(errors)).toBe(true)
		},
	)

	it('accepts a per-account limit equal to the quantity', () => {
		const model = validModel()
		model.quantity = '4'
		model.perAccountLimit = '4'
		const errors = validateLotteryPhaseForm(model)
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
