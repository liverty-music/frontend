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
		// Concert proto v0.41.0+: title / sourceUrl moved onto the embedded
		// `series` parent; the single `artistId` was replaced by a `performers`
		// repeated field. The mapper takes the caller-resolved `artist` arg
		// as the entity's artistId — no `performers[0]` fallback. When no
		// artist is resolved the artist trio (artistId / artistName /
		// artist) all go blank to keep downstream consumers internally
		// consistent (see `leaves artistId empty when no artist is
		// resolved` test for the contract assertion).
		return {
			id: { value: 'c1' },
			performers: [
				{
					id: { value: 'a1' },
					name: { value: 'Headliner' },
					mbid: { value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
				},
			],
			series: {
				id: { value: 's1' },
				title: { value: 'Test Concert' },
				sourceUrl: { value: 'https://example.com' },
			},
			localDate: { value: { year: 2026, month: 3, day: 15 } },
			startTime: { value: { seconds: BigInt(1742054400), nanos: 0 } },
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: 'JP-13' },
			},
			...overrides,
		}
	}

	it('maps all fields from proto to entity', () => {
		const artist = { id: 'a1', name: 'Artist One', mbid: '' }
		const result = concertFrom(
			makeProto() as any,
			'Artist One',
			'home',
			true,
			artist,
		)

		expect(result).not.toBeNull()
		expect(result!.id).toBe('c1')
		expect(result!.artistId).toBe('a1')
		expect(result!.artistName).toBe('Artist One')
		expect(result!.title).toBe('Test Concert')
		expect(result!.venueName).toBe('Zepp DiverCity')
		expect(result!.locationLabel).toBe('Display(JP-13)')
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

	it('handles missing id and performers gracefully', () => {
		const proto = makeProto({ id: undefined, performers: undefined })
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.id).toBe('')
		expect(result!.artistId).toBe('')
	})

	it('handles empty performers array gracefully (distinct from undefined)', () => {
		// performers: [] is a distinct server state from performers: undefined.
		// The mapper should treat both the same way (empty artistId) so a
		// malformed/zero-performer concert never throws nor surfaces a bogus
		// scalar value.
		const proto = makeProto({ performers: [] })
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.artistId).toBe('')
	})

	it('leaves artistId empty when no artist is resolved (no headliner fallback)', () => {
		// concert-store is the only production caller and always passes the
		// resolved performer as `artist`. Without that resolution the artist
		// trio (artistId / artistName / artist) all go blank so downstream
		// dashboard filters do not see an artistId pointing at the headliner
		// while artistName is empty.
		const proto = makeProto({
			performers: [
				{
					id: { value: 'headliner' },
					name: { value: 'A' },
					mbid: { value: 'm1' },
				},
				{
					id: { value: 'support' },
					name: { value: 'B' },
					mbid: { value: 'm2' },
				},
			],
		})
		const result = concertFrom(proto as any, 'Artist', 'watch', false)
		expect(result!.artistId).toBe('')
	})

	it('prefers artist.id over performers[0].id when both disagree', () => {
		// concert-store resolves the followed performer (which may not be
		// the headliner) and forwards it as `artist`. The mapper must take
		// that resolved id as the artistId so the entity's artistId /
		// artistName / artist trio stay internally consistent. Without this
		// test, swapping the operands in
		//   artist?.id ?? proto.performers?.[0]?.id?.value ?? ''
		// would go undetected because every other test uses an artist whose
		// id matches performers[0].
		const proto = makeProto({
			performers: [
				{
					id: { value: 'headliner' },
					name: { value: 'H' },
					mbid: { value: '' },
				},
			],
		})
		const artist = { id: 'followed-support', name: 'Support', mbid: '' }
		const result = concertFrom(proto as any, 'Support', 'watch', false, artist)
		expect(result!.artistId).toBe('followed-support')
		expect(result!.artist).toBe(artist)
	})
})
