import {
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { describe, expect, it } from 'vitest'
import {
	type SeriesDraftInput,
	toSeriesDraft,
} from '../../../organizer/services/concert-authoring-client'

const BASE: SeriesDraftInput = {
	title: 'One-Man Live',
	type: SeriesType.SINGLE,
	visibility: Visibility.UNLISTED,
	description: 'A show',
	artistIds: ['a1', 'a2'],
	events: [
		{
			venueName: 'Zepp Tokyo',
			placeId: 'ChIJabc',
			localDate: { year: 2026, month: 6, day: 16 },
			startTime: new Date(2026, 5, 16, 19, 0, 0),
			openTime: new Date(2026, 5, 16, 18, 0, 0),
		},
	],
}

describe('toSeriesDraft', () => {
	it('marshals the series-level fields into the generated message', () => {
		const draft = toSeriesDraft(BASE)
		expect(draft.title?.value).toBe('One-Man Live')
		expect(draft.type).toBe(SeriesType.SINGLE)
		expect(draft.visibility).toBe(Visibility.UNLISTED)
		expect(draft.description?.value).toBe('A show')
		expect(draft.artistIds.map((a) => a.value)).toEqual(['a1', 'a2'])
	})

	it('marshals an event with its venue, place id, date and times', () => {
		const draft = toSeriesDraft(BASE)
		const event = draft.events[0]
		expect(event.venueName?.value).toBe('Zepp Tokyo')
		expect(event.placeId?.value).toBe('ChIJabc')
		expect(event.localDate?.value?.year).toBe(2026)
		expect(event.localDate?.value?.month).toBe(6)
		expect(event.localDate?.value?.day).toBe(16)
		expect(event.startTime?.value?.toDate().getHours()).toBe(19)
		expect(event.openTime?.value?.toDate().getHours()).toBe(18)
	})

	it('omits description, place id, and times when absent', () => {
		const input: SeriesDraftInput = {
			title: 'Bare',
			type: SeriesType.TOUR,
			visibility: Visibility.PUBLIC,
			artistIds: ['a1'],
			events: [
				{
					venueName: 'Hall',
					localDate: { year: 2026, month: 1, day: 1 },
				},
			],
		}
		const draft = toSeriesDraft(input)
		expect(draft.description).toBeUndefined()
		expect(draft.events[0].placeId).toBeUndefined()
		expect(draft.events[0].startTime).toBeUndefined()
		expect(draft.events[0].openTime).toBeUndefined()
	})
})
