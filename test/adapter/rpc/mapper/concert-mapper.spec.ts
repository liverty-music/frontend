// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js',
	() => ({}),
)
vi.mock('../../../../src/constants/iso3166', () => ({
	displayName: (code: string) => `Display(${code})`,
}))

const { concertFrom, timestampToTimeString } = await import(
	'../../../../src/adapter/rpc/mapper/concert-mapper'
)

describe('timestampToTimeString', () => {
	it('formats epoch seconds to HH:MM', () => {
		// 1742054400 = 2025-03-15T16:00:00Z
		const result = timestampToTimeString(1742054400)
		expect(result).toMatch(/^\d{2}:\d{2}$/)
	})

	it('pads single-digit hours and minutes', () => {
		// 1742004300 = 2025-03-15T02:05:00Z
		const result = timestampToTimeString(1742004300)
		expect(result).toMatch(/^\d{2}:\d{2}$/)
	})

	it('handles midnight (00:00)', () => {
		// Find a midnight timestamp
		const midnight = new Date('2026-01-01T00:00:00').getTime() / 1000
		expect(timestampToTimeString(midnight)).toBe('00:00')
	})
})

describe('concertFrom', () => {
	function makeProto(overrides: Record<string, unknown> = {}) {
		return {
			id: { value: 'c1' },
			artistId: { value: 'a1' },
			title: { value: 'Test Concert' },
			localDate: { value: { year: 2026, month: 3, day: 15 } },
			startTime: { value: { seconds: BigInt(1742054400), nanos: 0 } },
			sourceUrl: { value: 'https://example.com' },
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: 'JP-13' },
			},
			...overrides,
		}
	}

	it('maps all fields from proto to entity', () => {
		const result = concertFrom(makeProto() as any, 'Artist One', 'home', true)

		expect(result).not.toBeNull()
		expect(result!.id).toBe('c1')
		expect(result!.artistId).toBe('a1')
		expect(result!.artistName).toBe('Artist One')
		expect(result!.title).toBe('Test Concert')
		expect(result!.venueName).toBe('Zepp DiverCity')
		expect(result!.locationLabel).toBe('Display(JP-13)')
		expect(result!.adminArea).toBe('JP-13')
		expect(result!.sourceUrl).toBe('https://example.com')
		expect(result!.hypeLevel).toBe('home')
		expect(result!.matched).toBe(true)
		expect(result!.date).toBeInstanceOf(Date)
		expect(result!.startTime).toMatch(/^\d{2}:\d{2}$/)
	})

	it('returns null when localDate is missing', () => {
		const result = concertFrom(
			makeProto({ localDate: undefined }) as any,
			'Artist',
			'watch',
			false,
		)
		expect(result).toBeNull()
	})

	it('returns null when localDate.value is missing', () => {
		const result = concertFrom(
			makeProto({ localDate: { value: undefined } }) as any,
			'Artist',
			'watch',
			false,
		)
		expect(result).toBeNull()
	})

	it('handles missing startTime', () => {
		const result = concertFrom(
			makeProto({ startTime: undefined }) as any,
			'Artist',
			'watch',
			false,
		)
		expect(result!.startTime).toBe('')
	})

	it('handles missing openTime', () => {
		const result = concertFrom(makeProto() as any, 'Artist', 'watch', false)
		expect(result!.openTime).toBeUndefined()
	})

	it('maps openTime when present', () => {
		const proto = makeProto({
			openTime: { value: { seconds: BigInt(1742050800), nanos: 0 } },
		})
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.openTime).toMatch(/^\d{2}:\d{2}$/)
	})

	it('falls back to listedVenueName when venue.name is missing', () => {
		const proto = makeProto({
			venue: undefined,
			listedVenueName: { value: 'Listed Venue' },
		})
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.venueName).toBe('Listed Venue')
	})

	it('returns empty venueName when both venue and listedVenueName are missing', () => {
		const proto = makeProto({ venue: undefined, listedVenueName: undefined })
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.venueName).toBe('')
	})

	it('returns empty locationLabel when adminArea is missing', () => {
		const proto = makeProto({
			venue: { name: { value: 'Venue' }, adminArea: undefined },
		})
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.locationLabel).toBe('')
		expect(result!.adminArea).toBeUndefined()
	})

	it('attaches artist when provided', () => {
		const artist = { id: 'a1', name: 'Artist', mbid: '' }
		const result = concertFrom(
			makeProto() as any,
			'Artist',
			'watch',
			false,
			artist,
		)
		expect(result!.artist).toBe(artist)
	})

	it('handles missing id and artistId gracefully', () => {
		const proto = makeProto({ id: undefined, artistId: undefined })
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.id).toBe('')
		expect(result!.artistId).toBe('')
	})
})
