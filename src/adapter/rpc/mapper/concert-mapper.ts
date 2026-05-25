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
	// Reject partially-defaulted proto3 Date messages — same rule as
	// formatLocalDate in import-ticket-email-route. A field defaulted to 0
	// (e.g. {year: 2026, month: 0, day: 15}) would silently roll through
	// `new Date(2026, -1, 15)` to 2025-12-15 and bucket the concert into
	// the wrong date group one month in the past. Returning null drops
	// the bad row instead of misplacing it.
	if (localDate.year === 0 || localDate.month === 0 || localDate.day === 0) {
		return null
	}

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

	// Concert proto v0.41.0+ moved title and sourceUrl onto the embedded
	// `series` parent and replaced the singular artistId with a `performers`
	// repeated field. The dashboard entity is still single-artist-flat, so the
	// caller resolves the "primary" artist for this row (e.g. the followed
	// performer for a follower-based listing, which may not be the headliner)
	// and we pull its ID from the resolved Artist object. When no artist is
	// resolved the trio `artistId / artistName / artist` ALL go empty — a
	// performers[0] (headliner) fallback would leave an artistId pointing at
	// the headliner while artistName / artist stay blank, so a dashboard
	// filter on artistId would link to one identity while the visible name
	// is empty. Symmetric blanks keep downstream consumers internally
	// consistent.
	return {
		id: proto.id?.value ?? '',
		artistName,
		artistId: artist?.id ?? '',
		venueName,
		locationLabel,
		adminArea,
		date: jsDate,
		startTime,
		openTime,
		// proto.series is guaranteed non-null on Concert by the v0.41.0+ BSR
		// schema (required field). The `?.` chain is defensive against
		// proto3's permissive-field-default typing, NOT a fallback for a
		// legitimately series-less concert — there is no such state. A
		// blank title here means the schema invariant was violated upstream
		// and should be investigated rather than silently re-derived.
		title: proto.series?.title?.value ?? '',
		sourceUrl: proto.series?.sourceUrl?.value ?? '',
		hypeLevel,
		matched,
		artist,
	}
}

export function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
