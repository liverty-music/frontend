import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import {
	PublishState,
	SeriesSchema,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	authoredSeriesFrom,
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
		expect(
			event.startTime?.value
				? timestampDate(event.startTime.value).getHours()
				: undefined,
		).toBe(19)
		expect(
			event.openTime?.value
				? timestampDate(event.openTime.value).getHours()
				: undefined,
		).toBe(18)
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

describe('authoredSeriesFrom', () => {
	const date = (seriesId: string, eventId: string, ...artistIds: string[]) =>
		create(ConcertSchema, {
			event: { id: { value: eventId }, seriesId: { value: seriesId } },
			artistIds: artistIds.map((value) => ({ value })),
		})

	it('groups the concerts back into one entry per series, artists once', () => {
		const list = authoredSeriesFrom({
			series: [
				create(SeriesSchema, {
					id: { value: 's-draft' },
					publishState: PublishState.DRAFT,
				}),
				create(SeriesSchema, { id: { value: 's-empty' } }),
			],
			concerts: [date('s-draft', 'd1', 'a1'), date('s-draft', 'd2', 'a1')],
			artists: [create(ArtistSchema, { id: { value: 'a1' } })],
		})

		expect(list.map((s) => s.series.id?.value)).toEqual(['s-draft', 's-empty'])
		expect(list[0].events.map((e) => e.id?.value)).toEqual(['d1', 'd2'])
		expect(list[0].performers.map((a) => a.id?.value)).toEqual(['a1'])
		expect(list[1].events).toEqual([])
		expect(list[1].performers).toEqual([])
	})

	it('drops a concert whose series the response does not list', () => {
		const [only] = authoredSeriesFrom({
			series: [create(SeriesSchema, { id: { value: 's1' } })],
			concerts: [date('s1', 'e1'), date('s-unknown', 'e2')],
			artists: [],
		})

		expect(only.events.map((e) => e.id?.value)).toEqual(['e1'])
	})
})
