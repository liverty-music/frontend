import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	concertCancelled,
	concertsOf,
	eventDay,
	eventStart,
	eventsByDate,
	findEvent,
	homeArtistOf,
	instructionOf,
	paths,
	performs,
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
		const scope = { organizer: 'o1', artist: 'a1' }
		const series = '/organizers/o1/artists/a1/series'
		expect(paths.home('o1')).toBe('/organizers/o1')
		expect(paths.settings('o1')).toBe('/organizers/o1/settings')
		expect(paths.payout('o1')).toBe('/organizers/o1/settings#payout')
		expect(paths.artists('o1')).toBe('/organizers/o1/artists')
		expect(paths.concerts(scope)).toBe(series)
		expect(paths.newConcert(scope)).toBe(`${series}/new`)
		expect(paths.concert(scope, 's1')).toBe(`${series}/s1`)
		expect(paths.editConcert(scope, 's1')).toBe(`${series}/s1/edit`)
		expect(paths.event(scope, 's1', 'e1')).toBe(
			`${series}/s1/events/e1/ticket-sales`,
		)
		expect(paths.scanners(scope, 's1', 'e1')).toBe(
			`${series}/s1/events/e1/scanners`,
		)
		expect(paths.newSale(scope, 's1', 'e1', 'lottery')).toBe(
			`${series}/s1/events/e1/ticket-sales/new?method=lottery`,
		)
		expect(paths.newSale(scope, 's1', 'e1', 'first-come')).toBe(
			`${series}/s1/events/e1/ticket-sales/new?method=first-come`,
		)
		expect(paths.editSale(scope, 's1', 'e1', 't1')).toBe(
			`${series}/s1/events/e1/ticket-sales/t1/edit`,
		)
	})

	it('escapes an id so it stays one address segment', () => {
		expect(paths.home('a/b')).toBe('/organizers/a%2Fb')
	})

	describe('concerts of an Artist', () => {
		const coHeadlined = authoredSeries({
			series: { id: { value: 'xy' }, title: { value: 'XX × YY 2026' } },
			performers: [
				{ id: { value: 'guest' }, name: { value: 'Guest' } },
				{ id: { value: 'a1' }, name: { value: 'Band A' } },
				{ id: { value: 'a2' }, name: { value: 'Band B' } },
			],
		})
		const onlyB = authoredSeries({
			series: { id: { value: 'yy' }, title: { value: 'YY Live' } },
			performers: [{ id: { value: 'a2' }, name: { value: 'Band B' } }],
		})

		it('lists the concerts each performer is in', () => {
			expect(concertsOf([coHeadlined, onlyB], 'a1')).toEqual([coHeadlined])
			expect(concertsOf([coHeadlined, onlyB], 'a2')).toEqual([
				coHeadlined,
				onlyB,
			])
			expect(performs(onlyB, 'a1')).toBe(false)
		})

		it('opens a concert from Home under its first represented performer', () => {
			expect(homeArtistOf(coHeadlined, new Set(['a2', 'a1']))).toBe('a1')
			expect(homeArtistOf(onlyB, new Set())).toBe('a2')
		})
	})
})

describe('instructionOf', () => {
	it('reads the root path as the empty instruction, keeping its query', () => {
		expect(instructionOf(paths.landing)).toBe('')
		expect(instructionOf('/?org=e2e-test')).toBe('?org=e2e-test')
		expect(instructionOf('/#top')).toBe('#top')
	})

	it('leaves every other path unchanged', () => {
		expect(instructionOf('/organizers/o-1/settings?tab=1')).toBe(
			'/organizers/o-1/settings?tab=1',
		)
		expect(instructionOf(paths.otherOrganizer)).toBe('/other-organizer')
	})
})
