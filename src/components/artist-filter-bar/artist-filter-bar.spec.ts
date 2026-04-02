import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return { ...actual, bindable: actual.bindable }
})

import type { Artist } from '../../entities/artist'
import { ArtistFilterBar } from './artist-filter-bar'

function makeArtist(id: string, name: string): Artist {
	return { id, name } as Artist
}

describe('ArtistFilterBar', () => {
	let sut: ArtistFilterBar

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new ArtistFilterBar()
		sut.followedArtists = [
			makeArtist('a1', 'Artist One'),
			makeArtist('a2', 'Artist Two'),
		]
	})

	describe('openSheet', () => {
		it('copies selectedIds to pendingIds and opens the sheet', () => {
			sut.selectedIds = ['a1']
			sut.openSheet()

			expect(sut.pendingIds).toEqual(['a1'])
			expect(sut.isSheetOpen).toBe(true)
		})
	})

	describe('confirmSelection', () => {
		it('commits pendingIds to selectedIds and closes the sheet', () => {
			sut.selectedIds = ['a1']
			sut.openSheet()
			sut.pendingIds = ['a1', 'a2']
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual(['a1', 'a2'])
			expect(sut.isSheetOpen).toBe(false)
		})

		it('clears selectedIds when all pending are deselected', () => {
			sut.selectedIds = ['a1']
			sut.openSheet()
			sut.pendingIds = []
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual([])
		})
	})

	describe('openSheet with empty followedArtists', () => {
		it('sets pendingIds to [] when followedArtists is empty', () => {
			sut.followedArtists = []
			sut.selectedIds = []
			sut.openSheet()

			expect(sut.pendingIds).toEqual([])
			expect(sut.isSheetOpen).toBe(true)
		})
	})

	describe('openSheet called twice', () => {
		it('resets pendingIds to current selectedIds on second open', () => {
			sut.selectedIds = ['a1']
			sut.openSheet()
			sut.pendingIds = ['a1', 'a2']

			// Open again without confirming — pendingIds should reset
			sut.openSheet()

			expect(sut.pendingIds).toEqual(['a1'])
		})
	})
})
