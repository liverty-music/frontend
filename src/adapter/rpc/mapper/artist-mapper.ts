import type { Artist as ProtoArtist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type {
	Artist,
	ArtistFanart,
	LogoColorProfile,
} from '../../../entities/artist'

type ProtoFanart = NonNullable<ProtoArtist['fanart']>
type ProtoLogoColorProfile = NonNullable<ProtoFanart['logoColorProfile']>

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
		hdMusicLogo: proto.hdMusicLogo?.value,
		musicLogo: proto.musicLogo?.value,
		musicBanner: proto.musicBanner?.value,
		logoColorProfile: proto.logoColorProfile
			? logoColorProfileFrom(proto.logoColorProfile)
			: undefined,
	}
}

export function logoColorProfileFrom(
	proto: ProtoLogoColorProfile,
): LogoColorProfile {
	return {
		dominantHue: proto.dominantHue,
		dominantLightness: proto.dominantLightness,
		isChromatic: proto.isChromatic,
	}
}
