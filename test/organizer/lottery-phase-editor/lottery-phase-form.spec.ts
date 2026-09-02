import { describe, expect, it } from 'vitest'
import {
	DEFAULT_WINDOW_DAYS,
	emptyFormModel,
	isFormValid,
	type LotteryPhaseFormModel,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	parseDateTimeLocal,
	toConfigureInput,
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
		openTime: toDateTimeLocal(open),
		closeTime: toDateTimeLocal(close),
		ticketCapacity: '200',
		maxTicketsPerApplication: '4',
		ticketPrice: '6500',
	}
}

describe('emptyFormModel', () => {
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

	it.each([
		MIN_WINDOW_DAYS,
		7,
		MAX_WINDOW_DAYS,
	])('accepts a %s-day window (within 1–14)', (days) => {
		const errors = validateLotteryPhaseForm(validModel(days))
		expect(errors.window).toBeUndefined()
		expect(isFormValid(errors)).toBe(true)
	})

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

describe('validateLotteryPhaseForm — ticket fields', () => {
	it.each([
		'',
		'0',
		'-5',
		'3.5',
		'abc',
	])('rejects a non-positive-integer capacity (%s)', (value) => {
		const model = validModel()
		model.ticketCapacity = value
		expect(validateLotteryPhaseForm(model).ticketCapacity).toBeDefined()
	})

	it.each([
		'',
		'0',
		'-1',
		'2.2',
		'x',
	])('rejects a non-positive-integer max-per-application (%s)', (value) => {
		const model = validModel()
		model.maxTicketsPerApplication = value
		expect(
			validateLotteryPhaseForm(model).maxTicketsPerApplication,
		).toBeDefined()
	})

	it.each([
		'',
		'0',
		'-100',
		'12.5',
		'free',
	])('rejects a non-positive-integer price (%s)', (value) => {
		const model = validModel()
		model.ticketPrice = value
		expect(validateLotteryPhaseForm(model).ticketPrice).toBeDefined()
	})

	it('rejects max-per-application exceeding capacity', () => {
		const model = validModel()
		model.ticketCapacity = '3'
		model.maxTicketsPerApplication = '4'
		const errors = validateLotteryPhaseForm(model)
		expect(errors.maxTicketsPerApplication).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('accepts max-per-application equal to capacity', () => {
		const model = validModel()
		model.ticketCapacity = '4'
		model.maxTicketsPerApplication = '4'
		const errors = validateLotteryPhaseForm(model)
		expect(errors.maxTicketsPerApplication).toBeUndefined()
		expect(isFormValid(errors)).toBe(true)
	})
})

describe('toConfigureInput', () => {
	it('marshals a validated model into the transport-agnostic input', () => {
		const input = toConfigureInput('event-1', validModel(DEFAULT_WINDOW_DAYS))
		expect(input.eventId).toBe('event-1')
		expect(input.ticketCapacity).toBe(200)
		expect(input.maxTicketsPerApplication).toBe(4)
		expect(input.ticketPrice).toBe(6500)
		expect(windowDurationDays(input.openTime, input.closeTime)).toBe(
			DEFAULT_WINDOW_DAYS,
		)
	})
})
