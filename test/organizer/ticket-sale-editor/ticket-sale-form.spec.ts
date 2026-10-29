import { describe, expect, it } from 'vitest'
import {
	blankFormModel,
	formModelOf,
	isFormValid,
	parseDateTime,
	type TicketSaleFormContext,
	type TicketSaleFormModel,
	toCreateInput,
	validateTicketSaleForm,
} from '../../../organizer/ticket-sale-editor/ticket-sale-form'

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))
const CTX: TicketSaleFormContext = { eventStart: EVENT_START }

function valid(): TicketSaleFormModel {
	return {
		name: '一般発売',
		saleStart: { date: '2026-11-01', time: '12:00' },
		saleEnd: { date: '2026-11-20', time: '19:00' },
	}
}

describe('Japan-time inputs', () => {
	it('reads a date and a 24-hour time as Japan time whatever the browser zone', () => {
		expect(
			parseDateTime({ date: '2026-11-20', time: '19:00' })?.toISOString(),
		).toBe('2026-11-20T10:00:00.000Z')
		// Crossing midnight in UTC.
		expect(
			parseDateTime({ date: '2026-11-21', time: '08:30' })?.toISOString(),
		).toBe('2026-11-20T23:30:00.000Z')
	})

	it('shows a stored window as Japan-time dates and times', () => {
		const model = formModelOf({
			name: '一般発売',
			saleStartTime: new Date('2026-11-20T23:30:00Z'),
			saleEndTime: EVENT_START,
		})
		expect(model.saleStart).toEqual({ date: '2026-11-21', time: '08:30' })
		expect(model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
	})

	it('rejects blank, malformed and non-existent times', () => {
		expect(parseDateTime({ date: '', time: '' })).toBeNull()
		expect(parseDateTime({ date: '2026-11-20', time: '' })).toBeNull()
		expect(parseDateTime({ date: '2026-02-30', time: '10:00' })).toBeNull()
		expect(parseDateTime({ date: '2026-11-20', time: '24:00' })).toBeNull()
	})
})

describe('blankFormModel', () => {
	it('ends the sale at the event start, with no price, quantity or limit', () => {
		const model = blankFormModel(EVENT_START, '一般発売')
		expect(model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
		expect(Object.keys(model).sort()).toEqual(['name', 'saleEnd', 'saleStart'])
		expect(model.name).toBe('一般発売')
		expect(model.saleStart).toEqual({ date: '', time: '' })
	})
})

describe('validateTicketSaleForm', () => {
	it('accepts a valid sale ending exactly at the event start', () => {
		expect(isFormValid(validateTicketSaleForm(valid(), CTX))).toBe(true)
	})

	it('rejects a sale end after the event start', () => {
		const errors = validateTicketSaleForm(
			{ ...valid(), saleEnd: { date: '2026-11-20', time: '19:30' } },
			CTX,
		)
		expect(errors.saleEndDate).toEqual({
			key: 'firstComeEditor.error.endAfterEvent',
			params: { eventStart: EVENT_START },
		})
	})

	it('rejects an end that is not after the start', () => {
		const errors = validateTicketSaleForm(
			{ ...valid(), saleStart: { date: '2026-11-20', time: '19:00' } },
			CTX,
		)
		expect(errors.saleEndDate).toEqual({
			key: 'firstComeEditor.error.endBeforeStart',
		})
	})

	it('requires both dates, then both times, each on its own field', () => {
		const noDates = validateTicketSaleForm(
			{
				...valid(),
				saleStart: { date: '', time: '12:00' },
				saleEnd: { date: '', time: '' },
			},
			CTX,
		)
		expect(noDates.saleStartDate).toEqual({
			key: 'firstComeEditor.error.start',
		})
		expect(noDates.saleEndDate).toEqual({ key: 'firstComeEditor.error.end' })
		expect(noDates.saleStartTime).toBeUndefined()
		expect(noDates.saleEndTime).toBeUndefined()

		const noTimes = validateTicketSaleForm(
			{
				...valid(),
				saleStart: { date: '2026-11-01', time: '' },
				saleEnd: { date: '2026-11-20', time: '' },
			},
			CTX,
		)
		expect(noTimes.saleStartDate).toBeUndefined()
		expect(noTimes.saleStartTime).toEqual({
			key: 'firstComeEditor.error.start',
		})
		expect(noTimes.saleEndTime).toEqual({ key: 'firstComeEditor.error.end' })
	})
})

describe('validateTicketSaleForm — name', () => {
	it.each([
		['', true],
		['一般発売', false],
		['あ'.repeat(100), false],
		['あ'.repeat(101), true],
	])('name %j is an error: %s', (name, isError) => {
		expect(
			Boolean(validateTicketSaleForm({ ...valid(), name }, CTX).name),
		).toBe(isError)
	})
})

describe('toCreateInput', () => {
	it('converts the model into a FirstCome sale naming the event', () => {
		const input = toCreateInput('series-1', 'event-1', valid())
		expect(input).toEqual({
			seriesId: 'series-1',
			name: '一般発売',
			method: 'firstCome',
			saleStartTime: new Date('2026-11-01T03:00:00Z'),
			saleEndTime: EVENT_START,
			eventIds: ['event-1'],
		})
	})
})
