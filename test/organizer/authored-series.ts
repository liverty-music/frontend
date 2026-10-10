import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import type { AuthoredSeries } from '../../organizer/services/concert-authoring-client'

/** An authored Series as ConcertAuthoringClient returns it, for screen tests. */
export function authoredSeries(init: {
	series: MessageInitShape<typeof SeriesSchema>
	events?: MessageInitShape<typeof EventSchema>[]
	performers?: MessageInitShape<typeof ArtistSchema>[]
}): AuthoredSeries {
	return {
		series: create(SeriesSchema, init.series),
		events: (init.events ?? []).map((e) => create(EventSchema, e)),
		performers: (init.performers ?? []).map((a) => create(ArtistSchema, a)),
	}
}
