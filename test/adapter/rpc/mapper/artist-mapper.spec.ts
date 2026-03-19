import { describe, expect, it, vi } from 'vitest'

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js',
	() => ({}),
)

const { artistFrom, fanartFrom, logoColorProfileFrom } = await import(
	'../../../../src/adapter/rpc/mapper/artist-mapper'
)

describe('artistFrom', () => {
	it('maps all fields from proto to entity', () => {
		const proto = {
			id: { value: 'a1' },
			name: { value: 'Artist One' },
			mbid: { value: 'mbid-1' },
			fanart: {
				hdMusicLogo: { value: 'hd.png' },
				musicLogo: { value: 'std.png' },
				artistBackground: { value: 'bg.png' },
				artistThumb: { value: 'thumb.png' },
				musicBanner: { value: 'banner.png' },
				logoColorProfile: {
					dominantHue: 120,
					dominantLightness: 0.5,
					isChromatic: true,
				},
			},
		}
		const result = artistFrom(proto as any)

		expect(result.id).toBe('a1')
		expect(result.name).toBe('Artist One')
		expect(result.mbid).toBe('mbid-1')
		expect(result.fanart?.hdMusicLogo).toBe('hd.png')
		expect(result.fanart?.logoColorProfile?.dominantHue).toBe(120)
	})

	it('handles undefined VOs gracefully', () => {
		const proto = {}
		const result = artistFrom(proto as any)

		expect(result.id).toBe('')
		expect(result.name).toBe('')
		expect(result.mbid).toBe('')
		expect(result.fanart).toBeUndefined()
	})

	it('handles null-ish id/name/mbid', () => {
		const proto = { id: undefined, name: null, mbid: undefined }
		const result = artistFrom(proto as any)

		expect(result.id).toBe('')
		expect(result.name).toBe('')
		expect(result.mbid).toBe('')
	})
})

describe('fanartFrom', () => {
	it('maps all fanart fields', () => {
		const proto = {
			artistThumb: { value: 'thumb.png' },
			artistBackground: { value: 'bg.png' },
			hdMusicLogo: { value: 'hd.png' },
			musicLogo: { value: 'std.png' },
			musicBanner: { value: 'banner.png' },
		}
		const result = fanartFrom(proto as any)

		expect(result.artistThumb).toBe('thumb.png')
		expect(result.artistBackground).toBe('bg.png')
		expect(result.hdMusicLogo).toBe('hd.png')
		expect(result.musicLogo).toBe('std.png')
		expect(result.musicBanner).toBe('banner.png')
	})

	it('returns undefined for missing optional fields', () => {
		const result = fanartFrom({} as any)

		expect(result.artistThumb).toBeUndefined()
		expect(result.artistBackground).toBeUndefined()
		expect(result.hdMusicLogo).toBeUndefined()
		expect(result.musicLogo).toBeUndefined()
		expect(result.musicBanner).toBeUndefined()
		expect(result.logoColorProfile).toBeUndefined()
	})
})

describe('logoColorProfileFrom', () => {
	it('maps color profile fields', () => {
		const proto = {
			dominantHue: 200,
			dominantLightness: 0.7,
			isChromatic: false,
		}
		const result = logoColorProfileFrom(proto as any)

		expect(result.dominantHue).toBe(200)
		expect(result.dominantLightness).toBe(0.7)
		expect(result.isChromatic).toBe(false)
	})

	it('preserves zero values', () => {
		const proto = {
			dominantHue: 0,
			dominantLightness: 0,
			isChromatic: false,
		}
		const result = logoColorProfileFrom(proto as any)

		expect(result.dominantHue).toBe(0)
		expect(result.dominantLightness).toBe(0)
	})
})
