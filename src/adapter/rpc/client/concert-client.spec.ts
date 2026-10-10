import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { ProximityGroupSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { resolveGroups } from './concert-client'

const tour = create(SeriesSchema, { id: { value: 's1' } })
const band = create(ArtistSchema, {
	id: { value: 'a1' },
	name: { value: 'Band' },
})
const support = create(ArtistSchema, {
	id: { value: 'a2' },
	name: { value: 'Support' },
})

function concert(eventId: string, artistId: string) {
	return create(ConcertSchema, {
		event: { id: { value: eventId }, seriesId: { value: 's1' } },
		artistIds: [{ value: artistId }],
	})
}

describe('resolveGroups', () => {
	it('resolves each lane of each group and keeps the group date', () => {
		const groups = resolveGroups({
			groups: [
				create(ProximityGroupSchema, {
					date: { value: { year: 2026, month: 11, day: 20 } },
					home: [concert('e1', 'a1')],
					away: [concert('e2', 'a2')],
				}),
			],
			series: [tour],
			artists: [band, support],
		})

		expect(groups).toHaveLength(1)
		expect(groups[0].date?.value?.day).toBe(20)
		expect(groups[0].home[0].artists[0].name?.value).toBe('Band')
		expect(groups[0].nearby).toEqual([])
		expect(groups[0].away[0].artists[0].name?.value).toBe('Support')
	})
})
