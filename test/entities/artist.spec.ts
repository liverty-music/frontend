// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { type Artist, bestBackgroundUrl } from '../../src/entities/artist'

function makeArtist(overrides: Partial<Artist> = {}): Artist {
	return { id: 'a1', name: 'Test', mbid: '', ...overrides }
}

describe('bestBackgroundUrl', () => {
	it('returns artistBackground when available', () => {
		const artist = makeArtist({
			fanart: { artistBackground: 'bg.png' },
		})
		expect(bestBackgroundUrl(artist)).toBe('bg.png')
	})

	it('returns undefined when artistBackground is absent', () => {
		const artist = makeArtist({ fanart: { artistThumb: 'thumb.png' } })
		expect(bestBackgroundUrl(artist)).toBeUndefined()
	})

	it('returns undefined when fanart is absent', () => {
		expect(bestBackgroundUrl(makeArtist())).toBeUndefined()
	})

	it('returns undefined for undefined artist', () => {
		expect(bestBackgroundUrl(undefined)).toBeUndefined()
	})
})
