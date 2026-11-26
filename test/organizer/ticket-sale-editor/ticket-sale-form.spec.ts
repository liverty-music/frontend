import { describe, expect, it } from 'vitest'
import {
	blankFormModel,
	formModelOf,
	isFormValid,
	type TicketSaleFormContext,
	type TicketSaleFormModel,
	toCreateInput,
	validateTicketSaleForm,
} from '../../../organizer/ticket-sale-editor/ticket-sale-form'

const EDITOR =
	'components/infrastructure/organizer/web/route/ticket-sale-editor'

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))
const CTX: TicketSaleFormContext = { eventStart: EVENT_START }

function valid(): TicketSaleFormModel {
	return {
		name: '一般発売',
		timeZone: 'Asia/Tokyo',
		saleStart: { date: '2026-11-01', time: '12:00' },
		saleEnd: { date: '2026-11-20', time: '19:00' },
	}
}

describe('a window in the sale zone', () => {
	it(`@spec ${EDITOR} "Event abroad"`, () => {
		// A sale of an event at a Venue in Taipei: 12:00 on 1 February, Taipei time.
		const input = toCreateInput('series-1', 'event-1', {
			...valid(),
			timeZone: 'Asia/Taipei',
			saleStart: { date: '2027-02-01', time: '12:00' },
			saleEnd: { date: '2027-02-10', time: '18:00' },
		})
		expect(input.timeZone).toBe('Asia/Taipei')
		expect(input.saleStart).toEqual({
			year: 2027,
			month: 2,
			day: 1,
			hour: 12,
			minute: 0,
		})
	})

	it(`@spec ${EDITOR} "Device in another time zone"`, () => {
		// The form holds the wall clock the member typed; the zone is the sale's,
		// so 12:00 on 10 October is 12:00 Japan time on any device.
		const input = toCreateInput('s', 'e', {
			...valid(),
			saleStart: { date: '2026-10-10', time: '12:00' },
		})
		expect(input.timeZone).toBe('Asia/Tokyo')
		expect(input.saleStart).toMatchObject({ month: 10, day: 10, hour: 12 })
	})

	it('shows a stored window as the dates and times in its zone', () => {
		const model = formModelOf({
			name: '一般発売',
			timeZone: 'Asia/Taipei',
			saleStart: { date: '2027-02-01', time: '12:00' },
			saleEnd: null,
		})
		expect(model.saleStart).toEqual({ date: '2027-02-01', time: '12:00' })
		expect(model.timeZone).toBe('Asia/Taipei')
		expect(model.saleEnd).toEqual({ date: '', time: '' })
	})
})

describe('the sale zone', () => {
	it(`@spec ${EDITOR} "Events at venues in different zones"`, () => {
		// Several zones, none chosen: saving says a time zone must be chosen.
		const errors = validateTicketSaleForm({ ...valid(), timeZone: '' }, CTX)
		expect(errors.timeZone).toEqual({ key: 'saleEditor.error.timeZone' })
		expect(isFormValid(errors)).toBe(false)
	})

	it(`@spec ${EDITOR} "Event in Japan"`, () => {
		// The shared zone is preselected, and the form is valid with it.
		const model = blankFormModel(EVENT_START, '一般発売', 'Asia/Tokyo')
		expect(model.timeZone).toBe('Asia/Tokyo')
		expect(model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
	})
})

describe('a time the clocks skip', () => {
	it(`@spec ${EDITOR} "Time skipped by the clocks moving forward"`, () => {
		const errors = validateTicketSaleForm(
			{
				...valid(),
				timeZone: 'America/New_York',
				saleStart: { date: '2027-03-14', time: '02:30' },
				saleEnd: { date: '2027-03-20', time: '12:00' },
			},
			{ eventStart: new Date('2027-03-21T00:00:00Z') },
		)
		expect(errors.saleStartTime).toEqual({
			key: 'saleEditor.error.timeSkipped',
		})
		expect(isFormValid(errors)).toBe(false)
	})
})

describe('blankFormModel', () => {
	it(`@spec ${EDITOR} "Blank form"`, () => {
		const model = blankFormModel(EVENT_START, '一般発売', 'Asia/Tokyo')
		expect(model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
		expect(Object.keys(model).sort()).toEqual([
			'name',
			'saleEnd',
			'saleStart',
			'timeZone',
		])
		expect(model.name).toBe('一般発売')
		expect(model.saleStart).toEqual({ date: '', time: '' })
	})

	it('ends the sale at the event start in the sale zone', () => {
		const model = blankFormModel(EVENT_START, '', 'Asia/Taipei')
		// 19:00 Japan time is 18:00 in Taipei.
		expect(model.saleEnd).toEqual({ date: '2026-11-20', time: '18:00' })
	})

	it('leaves the end empty while no zone is chosen', () => {
		expect(blankFormModel(EVENT_START, '').saleEnd).toEqual({
			date: '',
			time: '',
		})
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
			params: {
				eventStart: {
					wall: { year: 2026, month: 11, day: 20, hour: 19, minute: 0 },
					zone: 'Asia/Tokyo',
				},
			},
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
	it('converts the model into a FirstCome sale naming the event, with its zone', () => {
		const input = toCreateInput('series-1', 'event-1', valid())
		expect(input).toEqual({
			seriesId: 'series-1',
			name: '一般発売',
			method: 'firstCome',
			saleStart: { year: 2026, month: 11, day: 1, hour: 12, minute: 0 },
			saleEnd: { year: 2026, month: 11, day: 20, hour: 19, minute: 0 },
			timeZone: 'Asia/Tokyo',
			eventIds: ['event-1'],
		})
	})
})
