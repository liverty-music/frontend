import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { concertResolver, resolveConcerts } from './resolve-concert'

const tour = create(SeriesSchema, {
	id: { value: 's1' },
	title: { value: 'ARENA TOUR 2026' },
})
const band = create(ArtistSchema, {
	id: { value: 'a1' },
	name: { value: 'Band' },
})
const support = create(ArtistSchema, {
	id: { value: 'a2' },
	name: { value: 'Support' },
})

function concert(eventId: string, ...artistIds: string[]) {
	return create(ConcertSchema, {
		event: {
			id: { value: eventId },
			seriesId: { value: 's1' },
			localDate: { value: { year: 2026, month: 11, day: 20 } },
		},
		artistIds: artistIds.map((value) => ({ value })),
	})
}

describe('concertResolver', () => {
	it('joins a concert to its series and artists from the side lists', () => {
		const resolved = concertResolver(
			[tour],
			[band, support],
		)(concert('e1', 'a2', 'a1'))

		expect(resolved?.event.id?.value).toBe('e1')
		expect(resolved?.series?.title?.value).toBe('ARENA TOUR 2026')
		// The concert's own artist order is kept, not the side list's.
		expect(resolved?.artists.map((a) => a.id?.value)).toEqual(['a2', 'a1'])
	})

	it('skips an artist id the response does not carry', () => {
		const resolved = concertResolver([tour], [band])(concert('e1', 'a1', 'a9'))

		expect(resolved?.artists.map((a) => a.id?.value)).toEqual(['a1'])
	})

	it('drops a concert without an event', () => {
		expect(
			concertResolver([tour], [band])(create(ConcertSchema, {})),
		).toBeNull()
	})
})

describe('resolveConcerts', () => {
	it('resolves every date of a tour against the one series and artist', () => {
		const resolved = resolveConcerts({
			concerts: [concert('e1', 'a1'), concert('e2', 'a1'), concert('e3', 'a1')],
			series: [tour],
			artists: [band],
		})

		expect(resolved).toHaveLength(3)
		for (const r of resolved) {
			expect(r.series).toBe(tour)
			expect(r.artists).toEqual([band])
		}
	})
})
