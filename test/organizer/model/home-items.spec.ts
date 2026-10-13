import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import {
	ScannerSchema,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	eventsWithinWeek,
	type HomeSources,
	hasLiveScanner,
	homeItems,
} from '../../../organizer/model/home-model'
import { authoredSeries } from '../authored-series'

/** Wednesday 28 October 2026, 10:00 JST. */
const NOW = new Date('2026-10-28T10:00:00+09:00').getTime()

const BAND_A = { id: { value: 'a-1' }, name: { value: 'Band A' } }
const BAND_B = { id: { value: 'a-2' }, name: { value: 'Band B' } }

/** Published 3 November 18:00 JST (next week), published 20 December without a start time. */
const tour = authoredSeries({
	series: { id: { value: 's-tour' }, title: { value: 'XX Tour 2026' } },
	performers: [BAND_B, BAND_A],
	events: [
		{
			id: { value: 'e-1103' },
			localDate: { value: { year: 2026, month: 11, day: 3 } },
			startTime: {
				value: timestampFromDate(new Date('2026-11-03T18:00:00+09:00')),
			},
			publishState: PublishState.PUBLISHED,
		},
		{
			id: { value: 'e-1220' },
			localDate: { value: { year: 2026, month: 12, day: 20 } },
			publishState: PublishState.PUBLISHED,
		},
	],
})

const draft = authoredSeries({
	series: { id: { value: 's-solo' }, title: { value: 'XX 単独公演' } },
	performers: [BAND_A],
	events: [
		{
			id: { value: 'e-solo' },
			localDate: { value: { year: 2026, month: 12, day: 24 } },
			publishState: PublishState.DRAFT,
		},
	],
})

const cancelled = authoredSeries({
	series: { id: { value: 's-off' }, title: { value: 'Off' } },
	performers: [BAND_A],
	events: [
		{
			id: { value: 'e-off' },
			localDate: { value: { year: 2026, month: 11, day: 1 } },
			startTime: {
				value: timestampFromDate(new Date('2026-11-01T18:00:00+09:00')),
			},
			publishState: PublishState.CANCELLED,
		},
	],
})

const scanner = (status: ScannerStatus) =>
	create(ScannerSchema, { id: { value: 'sc' }, status })

function sources(overrides: Partial<HomeSources> = {}): HomeSources {
	return {
		organizerId: 'org-1',
		represented: new Set(['a-1']),
		concerts: [tour, draft, cancelled],
		payoutStatus: PayoutOnboardingStatus.PENDING,
		scanners: new Map([['e-1103', []]]),
		...overrides,
	}
}

describe('homeItems', () => {
	it('lists the payout, scanner, start time and draft items in that order', () => {
		const items = homeItems(sources(), NOW)
		expect(items.map((i) => i.key)).toEqual([
			'payout',
			'scanner:e-1103',
			'startTime:e-1220',
			'draft:s-solo',
		])
		expect(items[0].actionHref).toBe('/organizers/org-1/settings#payout')
		// A concert opens under the first performer the Organizer represents.
		expect(items[1].actionHref).toBe(
			'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/scanners',
		)
		expect(items[2].actionHref).toBe(
			'/organizers/org-1/artists/a-1/series/s-tour/edit',
		)
		expect(items[3].actionHref).toBe(
			'/organizers/org-1/artists/a-1/series/s-solo',
		)
		expect(items[3].concertTitle).toBe('XX 単独公演')
	})

	it('leaves out what is done or unknown', () => {
		const items = homeItems(
			sources({
				payoutStatus: PayoutOnboardingStatus.ACTIVE,
				scanners: new Map([['e-1103', [scanner(ScannerStatus.IN_USE)]]]),
			}),
			NOW,
		)
		expect(items.map((i) => i.kind)).toEqual(['startTime', 'draft'])

		// Unread payout status and unread scanners claim nothing.
		const unread = homeItems(
			sources({ payoutStatus: undefined, scanners: new Map() }),
			NOW,
		)
		expect(unread.map((i) => i.kind)).toEqual(['startTime', 'draft'])
	})

	it('still asks for a scanner when every scanner is revoked', () => {
		const items = homeItems(
			sources({
				scanners: new Map([['e-1103', [scanner(ScannerStatus.REVOKED)]]]),
			}),
			NOW,
		)
		expect(items.some((i) => i.kind === 'scanner')).toBe(true)
	})

	it('opens a concert under its first performer when none is represented', () => {
		const items = homeItems(sources({ represented: new Set() }), NOW)
		expect(items.find((i) => i.kind === 'draft')?.actionHref).toBe(
			'/organizers/org-1/artists/a-1/series/s-solo',
		)
	})
})

describe('eventsWithinWeek and hasLiveScanner', () => {
	it('finds the published events starting within 7 days', () => {
		expect(
			eventsWithinWeek([tour, draft, cancelled], NOW).map(
				(e) => e.event.id?.value,
			),
		).toEqual(['e-1103'])
		expect(eventsWithinWeek([tour], NOW + 8 * 24 * 3600 * 1000)).toEqual([])
	})

	it('counts unused and in-use scanners as live', () => {
		expect(hasLiveScanner([scanner(ScannerStatus.UNUSED)])).toBe(true)
		expect(hasLiveScanner([scanner(ScannerStatus.IN_USE)])).toBe(true)
		expect(hasLiveScanner([scanner(ScannerStatus.REVOKED)])).toBe(false)
		expect(hasLiveScanner([])).toBe(false)
	})
})
