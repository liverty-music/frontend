import type { Artist } from '../../entities/artist'
import type { GuestFollow } from '../../state/app-state'

export function serializeGuestFollows(follows: GuestFollow[]): string {
	return JSON.stringify(
		follows.map((f) => ({
			artist: f.artist,
			home: f.home,
		})),
	)
}

export function deserializeGuestFollows(json: string): GuestFollow[] {
	try {
		const raw = JSON.parse(json) as unknown[]
		if (!Array.isArray(raw)) return []

		return raw
			.map((item) => {
				const f = item as Record<string, unknown>
				if (!f || typeof f !== 'object') return null

				// New format: { artist: {...}, home: ... }
				if (f.artist && typeof f.artist === 'object') {
					const artist = parseArtist(f.artist as Record<string, unknown>)
					if (!artist) return null
					return {
						artist,
						home: typeof f.home === 'string' ? f.home : null,
					}
				}

				// Legacy flat format: { artistId: '...', name: '...' }
				if (typeof f.artistId === 'string') {
					return {
						artist: {
							id: f.artistId,
							name: typeof f.name === 'string' ? f.name : '',
							mbid: '',
						},
						home: null,
					}
				}

				// Legacy direct format: { id: '...', name: '...' }
				if (typeof f.id === 'string') {
					return {
						artist: {
							id: f.id,
							name: typeof f.name === 'string' ? f.name : '',
							mbid: '',
						},
						home: null,
					}
				}

				return null
			})
			.filter((f): f is GuestFollow => f !== null)
	} catch {
		return []
	}
}

function parseArtist(raw: Record<string, unknown>): Artist | null {
	if (!raw || typeof raw !== 'object') return null

	// Detect legacy proto VO format: { id: { value: "..." }, name: { value: "..." } }
	if (isVoWrapped(raw.id)) {
		const id = unwrapVo(raw.id)
		if (!id) return null
		return {
			id,
			name: unwrapVo(raw.name) ?? '',
			mbid: unwrapVo(raw.mbid) ?? '',
			fanart: parseFanart(raw.fanart),
		}
	}

	// New flat format: { id: "...", name: "...", mbid: "..." }
	if (typeof raw.id === 'string') {
		return {
			id: raw.id,
			name: typeof raw.name === 'string' ? raw.name : '',
			mbid: typeof raw.mbid === 'string' ? raw.mbid : '',
			fanart: parseFanart(raw.fanart),
		}
	}

	return null
}

function parseFanart(raw: unknown): Artist['fanart'] {
	if (!raw || typeof raw !== 'object') return undefined
	const f = raw as Record<string, unknown>

	// Handle both VO-wrapped and flat fanart formats
	return {
		artistThumb: unwrapStringField(f.artistThumb ?? f.artist_thumb),
		artistBackground: unwrapStringField(
			f.artistBackground ?? f.artist_background,
		),
		hdMusicLogo: unwrapStringField(f.hdMusicLogo ?? f.hd_music_logo),
		musicLogo: unwrapStringField(f.musicLogo ?? f.music_logo),
		musicBanner: unwrapStringField(f.musicBanner ?? f.music_banner),
		logoColorProfile: parseLogoColorProfile(
			f.logoColorProfile ?? f.logo_color_profile,
		),
	}
}

function parseLogoColorProfile(
	raw: unknown,
): Artist['fanart'] extends { logoColorProfile?: infer T } ? T : never {
	if (!raw || typeof raw !== 'object') return undefined
	const p = raw as Record<string, unknown>
	return {
		dominantHue:
			typeof p.dominantHue === 'number'
				? p.dominantHue
				: typeof p.dominant_hue === 'number'
					? p.dominant_hue
					: undefined,
		dominantLightness:
			typeof p.dominantLightness === 'number'
				? p.dominantLightness
				: typeof p.dominant_lightness === 'number'
					? p.dominant_lightness
					: 0,
		isChromatic:
			typeof p.isChromatic === 'boolean'
				? p.isChromatic
				: typeof p.is_chromatic === 'boolean'
					? p.is_chromatic
					: false,
	}
}

function isVoWrapped(val: unknown): boolean {
	return (
		val !== null &&
		typeof val === 'object' &&
		'value' in (val as Record<string, unknown>)
	)
}

function unwrapVo(val: unknown): string | undefined {
	if (val !== null && typeof val === 'object') {
		const v = (val as Record<string, unknown>).value
		if (typeof v === 'string') return v
	}
	return undefined
}

function unwrapStringField(val: unknown): string | undefined {
	if (typeof val === 'string') return val
	if (isVoWrapped(val)) return unwrapVo(val)
	return undefined
}
