import {
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { describe, expect, it } from 'vitest'
import {
	type ConcertFormModel,
	composeInstant,
	emptyFormModel,
	isFormValid,
	parseIsoDate,
	toSeriesDraftInput,
	validateConcertForm,
} from '../../../organizer/concert-editor/concert-form'

const TODAY = { year: 2026, month: 6, day: 15 }

/** A fully valid model anchored a day after TODAY. */
function validModel(): ConcertFormModel {
	return {
		title: 'Summer Tour',
		description: 'A tour',
		type: SeriesType.TOUR,
		visibility: Visibility.PUBLIC,
		artistIds: ['a1'],
		events: [
			{
				venueName: 'Zepp Tokyo',
				placeId: '',
				localDate: '2026-06-16',
				startTime: '19:00',
				openTime: '18:00',
			},
		],
	}
}

describe('parseIsoDate', () => {
	it('parses a valid ISO date into a calendar triple', () => {
		expect(parseIsoDate('2026-06-16')).toEqual({
			year: 2026,
			month: 6,
			day: 16,
		})
	})

	it('rejects malformed input', () => {
		expect(parseIsoDate('2026/06/16')).toBeNull()
		expect(parseIsoDate('')).toBeNull()
		expect(parseIsoDate('2026-13-01')).toBeNull()
	})
})

describe('composeInstant', () => {
	it('composes a local Date from a calendar date and HH:mm', () => {
		const d = composeInstant({ year: 2026, month: 6, day: 16 }, '19:30')
		expect(d?.getFullYear()).toBe(2026)
		expect(d?.getMonth()).toBe(5) // 0-based June
		expect(d?.getDate()).toBe(16)
		expect(d?.getHours()).toBe(19)
		expect(d?.getMinutes()).toBe(30)
	})

	it('returns null for empty or malformed times', () => {
		expect(composeInstant(TODAY, '')).toBeNull()
		expect(composeInstant(TODAY, '25:00')).toBeNull()
		expect(composeInstant(TODAY, '7pm')).toBeNull()
	})
})

describe('validateConcertForm', () => {
	it('passes a fully valid model', () => {
		const errors = validateConcertForm(validModel(), { today: TODAY })
		expect(isFormValid(errors)).toBe(true)
	})

	it('requires a title', () => {
		const model = { ...validModel(), title: '   ' }
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.title).toBeDefined()
		expect(isFormValid(errors)).toBe(false)
	})

	it('rejects the UNSPECIFIED series type and visibility', () => {
		const model = {
			...validModel(),
			type: SeriesType.UNSPECIFIED,
			visibility: Visibility.UNSPECIFIED,
		}
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.type).toBeDefined()
		expect(errors.visibility).toBeDefined()
	})

	it('requires at least one performer', () => {
		const model = { ...validModel(), artistIds: [] }
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.artistIds).toBeDefined()
	})

	it('requires a venue name per event', () => {
		const model = validModel()
		model.events[0].venueName = ''
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].venueName).toBeDefined()
	})

	it('requires a valid date per event', () => {
		const model = validModel()
		model.events[0].localDate = ''
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].localDate).toBeDefined()
	})

	it('rejects a past date by default', () => {
		const model = validModel()
		model.events[0].localDate = '2026-06-14'
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].localDate).toContain('past')
	})

	it('allows a past date when editing a published series', () => {
		const model = validModel()
		model.events[0].localDate = '2026-06-14'
		const errors = validateConcertForm(model, {
			today: TODAY,
			allowPastDates: true,
		})
		expect(errors.rows[0].localDate).toBeUndefined()
	})

	it('rejects an open time later than the start time', () => {
		const model = validModel()
		model.events[0].openTime = '20:00'
		model.events[0].startTime = '19:00'
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].time).toBeDefined()
	})

	it('accepts an open time equal to the start time', () => {
		const model = validModel()
		model.events[0].openTime = '19:00'
		model.events[0].startTime = '19:00'
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].time).toBeUndefined()
	})

	it('flags an empty event list', () => {
		const model = {
			...emptyFormModel(),
			title: 'x',
			artistIds: ['a1'],
			events: [],
		}
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.events).toBeDefined()
	})
})

describe('toSeriesDraftInput', () => {
	it('maps the model into the transport input, trimming and omitting empties', () => {
		const model = validModel()
		model.title = '  Summer Tour  '
		model.events[0].placeId = ''
		const input = toSeriesDraftInput(model)

		expect(input.title).toBe('Summer Tour')
		expect(input.type).toBe(SeriesType.TOUR)
		expect(input.visibility).toBe(Visibility.PUBLIC)
		expect(input.artistIds).toEqual(['a1'])
		expect(input.events).toHaveLength(1)
		expect(input.events[0].venueName).toBe('Zepp Tokyo')
		expect(input.events[0].placeId).toBeUndefined()
		expect(input.events[0].localDate).toEqual({ year: 2026, month: 6, day: 16 })
		expect(input.events[0].startTime).toBeInstanceOf(Date)
		expect(input.events[0].openTime).toBeInstanceOf(Date)
	})

	it('omits start/open when unset', () => {
		const model = validModel()
		model.events[0].startTime = ''
		model.events[0].openTime = ''
		const input = toSeriesDraftInput(model)
		expect(input.events[0].startTime).toBeUndefined()
		expect(input.events[0].openTime).toBeUndefined()
	})
})
