import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { describe, expect, it } from 'vitest'
import {
	type ConcertFormModel,
	composeInstant,
	emptyFormModel,
	isFormValid,
	nextEventRow,
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
		sourceUrl: '',
		artistIds: ['a1'],
		events: [
			{
				eventId: '',
				publishState: PublishState.DRAFT,
				venue: {
					placeId: 'ChIJ-zepp-tokyo',
					name: 'Zepp Tokyo',
					address: '東京都江東区青海1-3-11',
				},
				localDate: '2026-06-16',
				startTime: '19:00',
				openTime: '18:00',
				perAccountLimit: '4',
			},
		],
	}
}

const LIMIT_SPEC =
	'components/infrastructure/organizer/web/route/concert-editor'

describe('a new concert and an added date (design D19)', () => {
	it('starts the first date of a new concert with doors 17:00 and start 19:00', () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Defaults of a new concert"
		const [first] = emptyFormModel().events
		expect(first.openTime).toBe('17:00')
		expect(first.startTime).toBe('19:00')
		expect(first.publishState).toBe(PublishState.DRAFT)
		expect(first.venue).toBeNull()
		expect(first.localDate).toBe('')
	})

	it('copies the previous date into a new draft date', () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Another night at the same venue"
		const previous = {
			eventId: 'e-1103',
			publishState: PublishState.PUBLISHED,
			venue: {
				placeId: 'ChIJ-haneda',
				name: 'Zepp Haneda (TOKYO)',
				address: '大田区羽田空港',
			},
			localDate: '2026-11-03',
			openTime: '17:00',
			startTime: '18:00',
			perAccountLimit: '6',
		}
		const next = nextEventRow(previous)
		expect(next).toEqual({
			eventId: '',
			publishState: PublishState.DRAFT,
			venue: previous.venue,
			localDate: '2026-11-03',
			openTime: '17:00',
			startTime: '18:00',
			// A new date starts at the default limit, not the previous date's.
			perAccountLimit: '4',
		})
		// The new date has its own venue, so a new pick changes only it.
		expect(next.venue).not.toBe(previous.venue)
	})

	it('does not copy a venue that was never matched to a map place', () => {
		const next = nextEventRow({
			eventId: 'e-old',
			publishState: PublishState.PUBLISHED,
			venue: { placeId: '', name: '渋谷のライブハウス', address: '' },
			localDate: '2026-11-03',
			openTime: '',
			startTime: '18:00',
			perAccountLimit: '4',
		})
		expect(next.venue).toBeNull()
		expect(next.localDate).toBe('2026-11-03')
		expect(next.startTime).toBe('18:00')
	})
})

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
	it('reads a calendar date and HH:mm as Japan time', () => {
		const d = composeInstant({ year: 2026, month: 6, day: 16 }, '19:30')
		// 19:30 JST is 10:30 UTC, whatever the device's time zone.
		expect(d?.toISOString()).toBe('2026-06-16T10:30:00.000Z')
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

	it('needs no picked place for a published date, which keeps its venue', () => {
		const model = validModel()
		model.events[0].publishState = PublishState.PUBLISHED
		model.events[0].venue = { placeId: '', name: 'Zepp Tokyo', address: '' }
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].venueName).toBeUndefined()
		expect(toSeriesDraftInput(model).events[0].placeId).toBeUndefined()
	})

	it('requires a venue picked from the map catalog per event', () => {
		const model = validModel()
		model.events[0].venue = null
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].venueName).toBe('concertEditor.error.venueNotPicked')
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

	it('allows the past date of a published or cancelled event, not of a draft', () => {
		const model = validModel()
		model.events = [
			{
				...model.events[0],
				eventId: 'e1',
				publishState: PublishState.PUBLISHED,
				localDate: '2026-06-14',
			},
			{
				...model.events[0],
				eventId: 'e2',
				publishState: PublishState.CANCELLED,
				localDate: '2026-06-14',
			},
			{ ...model.events[0], localDate: '2026-06-14' },
		]
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].localDate).toBeUndefined()
		expect(errors.rows[1].localDate).toBeUndefined()
		expect(errors.rows[2].localDate).toContain('past')
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
		const input = toSeriesDraftInput(model)

		expect(input.title).toBe('Summer Tour')
		expect(input.type).toBe(SeriesType.TOUR)
		expect(input.visibility).toBe(Visibility.PUBLIC)
		expect(input.artistIds).toEqual(['a1'])
		expect(input.events).toHaveLength(1)
		expect(input.events[0].venueName).toBe('Zepp Tokyo')
		// The picked place goes with the venue name: never a typed name alone.
		expect(input.events[0].placeId).toBe('ChIJ-zepp-tokyo')
		expect(input.events[0].localDate).toEqual({ year: 2026, month: 6, day: 16 })
		expect(input.events[0].startTime).toBeInstanceOf(Date)
		expect(input.events[0].openTime).toBeInstanceOf(Date)
	})

	it('sends the id of a stored event and none for a new date', () => {
		const model = validModel()
		model.events = [
			{
				...model.events[0],
				eventId: 'e1',
				publishState: PublishState.PUBLISHED,
			},
			{ ...model.events[0] },
		]
		const input = toSeriesDraftInput(model)
		expect(input.events[0].eventId).toBe('e1')
		expect(input.events[1].eventId).toBeUndefined()
	})

	it('sends the loaded source page back unchanged', () => {
		const model = validModel()
		model.sourceUrl = 'https://example.com/tour'
		expect(toSeriesDraftInput(model).sourceUrl).toBe('https://example.com/tour')
		expect(toSeriesDraftInput(validModel()).sourceUrl).toBeUndefined()
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

describe("each date's per-account limit", () => {
	it(`@spec ${LIMIT_SPEC} "New date"`, () => {
		expect(emptyFormModel().events[0].perAccountLimit).toBe('4')
		expect(nextEventRow(undefined).perAccountLimit).toBe('4')
	})

	it(`@spec ${LIMIT_SPEC} "Group tickets"`, () => {
		const model = validModel()
		model.events[0].perAccountLimit = '6'
		const errors = validateConcertForm(model, { today: TODAY })
		expect(isFormValid(errors)).toBe(true)
		expect(toSeriesDraftInput(model).events[0].perAccountLimit).toBe(6)
	})

	it(`@spec ${LIMIT_SPEC} "Above one admission code"`, () => {
		for (const value of ['11', '0', '', '2.5']) {
			const model = validModel()
			model.events[0].perAccountLimit = value
			const errors = validateConcertForm(model, { today: TODAY })
			expect(errors.rows[0].perAccountLimit).toBe(
				'concertEditor.error.perAccountLimit',
			)
			expect(isFormValid(errors)).toBe(false)
		}
		const model = validModel()
		model.events[0].perAccountLimit = '10'
		expect(
			validateConcertForm(model, { today: TODAY }).rows[0].perAccountLimit,
		).toBeUndefined()
	})

	it(`@spec ${LIMIT_SPEC} "Published date"`, () => {
		// A published date's limit is not checked and goes back as loaded,
		// so Update keeps it.
		const model = validModel()
		model.events[0] = {
			...model.events[0],
			eventId: 'e1',
			publishState: PublishState.PUBLISHED,
			perAccountLimit: '6',
		}
		const errors = validateConcertForm(model, { today: TODAY })
		expect(errors.rows[0].perAccountLimit).toBeUndefined()
		expect(toSeriesDraftInput(model).events[0].perAccountLimit).toBe(6)
	})
})
