// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js',
	() => ({}),
)

const { artistFrom, fanartFrom } = await import(
	'../../../../src/adapter/rpc/mapper/artist-mapper'
)

describe('artistFrom', () => {
	it('maps all fields from proto to entity', () => {
		const proto = {
			id: { value: 'a1' },
			name: { value: 'Artist One' },
			mbid: { value: 'mbid-1' },
			fanart: {
				artistBackground: { value: 'bg.png' },
				artistThumb: { value: 'thumb.png' },
				musicBanner: { value: 'banner.png' },
			},
		}
		const result = artistFrom(proto as any)

		expect(result.id).toBe('a1')
		expect(result.name).toBe('Artist One')
		expect(result.mbid).toBe('mbid-1')
		expect(result.fanart?.artistBackground).toBe('bg.png')
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
	// @spec components/infrastructure/fan/web/global/live-highway "ListFollowed returns artist with fanart"
	it('maps all fanart fields', () => {
		const proto = {
			artistThumb: { value: 'thumb.png' },
			artistBackground: { value: 'bg.png' },
			musicBanner: { value: 'banner.png' },
		}
		const result = fanartFrom(proto as any)

		expect(result.artistThumb).toBe('thumb.png')
		expect(result.artistBackground).toBe('bg.png')
		expect(result.musicBanner).toBe('banner.png')
	})

	// @spec components/infrastructure/fan/web/global/live-highway "ListFollowed returns artist without fanart"
	it('returns undefined for missing optional fields', () => {
		const result = fanartFrom({} as any)

		expect(result.artistThumb).toBeUndefined()
		expect(result.artistBackground).toBeUndefined()
		expect(result.musicBanner).toBeUndefined()
	})
})
