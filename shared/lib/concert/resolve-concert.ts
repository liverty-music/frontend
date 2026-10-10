import type { Artist as ProtoArtist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { Event as ProtoEvent } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import type { Series as ProtoSeries } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'

/**
 * A Concert of a response with its Series and Artists resolved.
 * On the wire a Concert carries only its Event and the ids of its Artists; the
 * response carries each referenced Series and Artist once beside the Concerts.
 * {@link concertResolver} joins them back, so every app and screen reads one
 * shape.
 */
export interface ResolvedConcert {
	readonly event: ProtoEvent
	/** The Series named by `event.seriesId`; absent if the response lacks it. */
	readonly series?: ProtoSeries
	/** The performing Artists, in the Concert's `artistIds` order. */
	readonly artists: readonly ProtoArtist[]
}

/**
 * Index a response's `series` and `artists` by id and return a function that
 * resolves each of its Concerts. A Concert without an Event is dropped (null);
 * an id the response does not carry is skipped.
 */
export function concertResolver(
	series: readonly ProtoSeries[],
	artists: readonly ProtoArtist[],
): (concert: ProtoConcert) => ResolvedConcert | null {
	const seriesById = new Map<string, ProtoSeries>()
	for (const s of series) {
		const id = s.id?.value
		if (id) seriesById.set(id, s)
	}
	const artistById = new Map<string, ProtoArtist>()
	for (const a of artists) {
		const id = a.id?.value
		if (id) artistById.set(id, a)
	}
	return (concert) => {
		const event = concert.event
		if (!event) return null
		return {
			event,
			series: seriesById.get(event.seriesId?.value ?? ''),
			artists: concert.artistIds.flatMap((id) => {
				const artist = artistById.get(id.value)
				return artist ? [artist] : []
			}),
		}
	}
}

/** Resolve a response's Concerts against its `series` and `artists`. */
export function resolveConcerts(response: {
	concerts: readonly ProtoConcert[]
	series: readonly ProtoSeries[]
	artists: readonly ProtoArtist[]
}): ResolvedConcert[] {
	const resolve = concertResolver(response.series, response.artists)
	return response.concerts.flatMap((c) => {
		const r = resolve(c)
		return r ? [r] : []
	})
}
