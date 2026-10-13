import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	concertCancelled,
	eventDay,
	eventStart,
	eventsByDate,
	findEvent,
	paths,
	publishBadge,
	venueName,
} from '../../../organizer/model/concert-model'
import { authoredSeries } from '../authored-series'

const tour = authoredSeries({
	series: { id: { value: 's1' }, title: { value: 'XX Tour 2026' } },
	events: [
		{
			id: { value: 'e2' },
			localDate: { value: { year: 2026, month: 11, day: 10 } },
			startTime: {
				value: timestampFromDate(new Date('2026-11-10T09:00:00Z')),
			},
			listedVenueName: { value: 'Zepp Osaka Bayside' },
			publishState: PublishState.PUBLISHED,
		},
		{
			id: { value: 'e1' },
			localDate: { value: { year: 2026, month: 11, day: 3 } },
			venue: { name: { value: 'Zepp Haneda' } },
			publishState: PublishState.DRAFT,
		},
	],
})

describe('concert model', () => {
	it('reads an event day as midnight in Japan time', () => {
		const day = eventDay(tour.events[1])
		expect(day?.toISOString()).toBe('2026-11-02T15:00:00.000Z')
	})

	it('orders events by start time, else by day', () => {
		expect(eventsByDate(tour).map((e) => e.id?.value)).toEqual(['e1', 'e2'])
	})

	it('reads the start time only when it is set', () => {
		expect(eventStart(tour.events[0])?.toISOString()).toBe(
			'2026-11-10T09:00:00.000Z',
		)
		expect(eventStart(tour.events[1])).toBeUndefined()
	})

	it('prefers the venue name over the listed name', () => {
		expect(venueName(tour.events[1])).toBe('Zepp Haneda')
		expect(venueName(tour.events[0])).toBe('Zepp Osaka Bayside')
	})

	it('finds an event of a concert by id', () => {
		expect(findEvent(tour, 'e2')?.id?.value).toBe('e2')
		expect(findEvent(tour, 'nope')).toBeUndefined()
		expect(findEvent(undefined, 'e2')).toBeUndefined()
	})

	it('calls a concert cancelled only when every event is', () => {
		expect(concertCancelled(tour)).toBe(false)
		const cancelled = authoredSeries({
			series: { id: { value: 's2' } },
			events: [{ id: { value: 'x' }, publishState: PublishState.CANCELLED }],
		})
		expect(concertCancelled(cancelled)).toBe(true)
	})

	it('labels each publish state with a tone and a catalog key', () => {
		expect(publishBadge(PublishState.PUBLISHED)).toEqual({
			tone: 'success',
			labelKey: 'publishState.published',
		})
		expect(publishBadge(PublishState.DRAFT).labelKey).toBe('publishState.draft')
		expect(publishBadge(PublishState.CANCELLED).tone).toBe('error')
	})

	it('builds the console addresses of design D1', () => {
		expect(paths.event('s1', 'e1')).toBe('/concerts/s1/events/e1/sales')
		expect(paths.reception('s1', 'e1')).toBe('/concerts/s1/events/e1/reception')
		expect(paths.lottery('s1', 'e1', 't1')).toBe(
			'/concerts/s1/events/e1/sales/lottery/t1',
		)
		expect(paths.firstCome('s1', 'e1')).toBe(
			'/concerts/s1/events/e1/sales/first-come',
		)
	})
})
