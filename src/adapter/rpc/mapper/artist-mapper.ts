import type { Artist as ProtoArtist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Artist, ArtistFanart } from '../../../entities/artist'

type ProtoFanart = NonNullable<ProtoArtist['fanart']>

export function artistFrom(proto: ProtoArtist): Artist {
	return {
		id: proto.id?.value ?? '',
		name: proto.name?.value ?? '',
		mbid: proto.mbid?.value ?? '',
		fanart: proto.fanart ? fanartFrom(proto.fanart) : undefined,
	}
}

export function fanartFrom(proto: ProtoFanart): ArtistFanart {
	return {
		artistThumb: proto.artistThumb?.value,
		artistBackground: proto.artistBackground?.value,
		musicBanner: proto.musicBanner?.value,
	}
}
