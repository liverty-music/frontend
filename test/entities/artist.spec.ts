import { describe, expect, it } from 'vitest'
import {
	type Artist,
	bestBackgroundUrl,
	bestLogoUrl,
} from '../../src/entities/artist'

function makeArtist(overrides: Partial<Artist> = {}): Artist {
	return { id: 'a1', name: 'Test', mbid: '', ...overrides }
}

describe('bestLogoUrl', () => {
	it('returns hdMusicLogo when available', () => {
		const artist = makeArtist({
			fanart: { hdMusicLogo: 'hd.png', musicLogo: 'std.png' },
		})
		expect(bestLogoUrl(artist)).toBe('hd.png')
	})

	it('falls back to musicLogo when hdMusicLogo is absent', () => {
		const artist = makeArtist({ fanart: { musicLogo: 'std.png' } })
		expect(bestLogoUrl(artist)).toBe('std.png')
	})

	it('returns undefined when no logo fields exist', () => {
		const artist = makeArtist({ fanart: { artistThumb: 'thumb.png' } })
		expect(bestLogoUrl(artist)).toBeUndefined()
	})

	it('returns undefined when fanart is absent', () => {
		const artist = makeArtist()
		expect(bestLogoUrl(artist)).toBeUndefined()
	})

	it('returns undefined for undefined artist', () => {
		expect(bestLogoUrl(undefined)).toBeUndefined()
	})
})

describe('bestBackgroundUrl', () => {
	it('returns artistBackground when available', () => {
		const artist = makeArtist({
			fanart: { artistBackground: 'bg.png' },
		})
		expect(bestBackgroundUrl(artist)).toBe('bg.png')
	})

	it('returns undefined when artistBackground is absent', () => {
		const artist = makeArtist({ fanart: { musicLogo: 'logo.png' } })
		expect(bestBackgroundUrl(artist)).toBeUndefined()
	})

	it('returns undefined when fanart is absent', () => {
		expect(bestBackgroundUrl(makeArtist())).toBeUndefined()
	})

	it('returns undefined for undefined artist', () => {
		expect(bestBackgroundUrl(undefined)).toBeUndefined()
	})
})
