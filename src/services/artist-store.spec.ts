import { describe, expect, it, vi } from 'vitest'

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => ({
			listTop: vi.fn(async () => []),
			listSimilar: vi.fn(async () => []),
			search: vi.fn(async () => []),
		})),
	}
})

import { ArtistStore } from './artist-store'

describe('ArtistStore — bubble cache', () => {
	it('peekBubbles returns null before any setBubbles call', () => {
		const sut = new ArtistStore()
		expect(sut.peekBubbles()).toBeNull()
	})

	it('peekBubbles returns the stored artists after setBubbles', () => {
		const sut = new ArtistStore()
		const artists = [{ id: 'a1', name: 'YOASOBI', mbid: '' }]
		sut.setBubbles(artists)
		expect(sut.peekBubbles()).toBe(artists)
	})

	it('setBubbles overwrites the previous cache', () => {
		const sut = new ArtistStore()
		sut.setBubbles([{ id: 'a1', name: 'YOASOBI', mbid: '' }])
		const fresh = [{ id: 'a2', name: 'Ado', mbid: '' }]
		sut.setBubbles(fresh)
		expect(sut.peekBubbles()).toBe(fresh)
	})
})
