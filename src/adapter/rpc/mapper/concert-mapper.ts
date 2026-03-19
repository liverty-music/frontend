import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { displayName } from '../../../constants/iso3166'
import type { Artist } from '../../../entities/artist'
import type { Concert, HypeLevel } from '../../../entities/concert'

export function concertFrom(
	proto: ProtoConcert,
	artistName: string,
	hypeLevel: HypeLevel,
	matched: boolean,
	artist?: Artist,
): Concert | null {
	const localDate = proto.localDate?.value
	if (!localDate) return null

	const jsDate = new Date(localDate.year, localDate.month - 1, localDate.day)

	const startTime = proto.startTime?.value
		? timestampToTimeString(Number(proto.startTime.value.seconds))
		: ''
	const openTime = proto.openTime?.value
		? timestampToTimeString(Number(proto.openTime.value.seconds))
		: undefined

	const venueName =
		proto.venue?.name?.value ?? proto.listedVenueName?.value ?? ''
	const adminArea = proto.venue?.adminArea?.value
	const locationLabel = adminArea ? displayName(adminArea) : ''

	return {
		id: proto.id?.value ?? '',
		artistName,
		artistId: proto.artistId?.value ?? '',
		venueName,
		locationLabel,
		adminArea,
		date: jsDate,
		startTime,
		openTime,
		title: proto.title?.value ?? '',
		sourceUrl: proto.sourceUrl?.value ?? '',
		hypeLevel,
		matched,
		artist,
	}
}

export function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
