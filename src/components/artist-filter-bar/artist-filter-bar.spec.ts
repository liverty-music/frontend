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
			sut.togglePending('a2')
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual(['a1', 'a2'])
			expect(sut.isSheetOpen).toBe(false)
		})

		it('clears selectedIds when all pending are deselected', () => {
			sut.selectedIds = ['a1']
			sut.openSheet()
			sut.togglePending('a1') // deselect
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual([])
		})
	})

	describe('dismiss', () => {
		it('removes the given artist from selectedIds', () => {
			sut.selectedIds = ['a1', 'a2']
			sut.dismiss('a1')

			expect(sut.selectedIds).toEqual(['a2'])
		})
	})

	describe('togglePending', () => {
		it('adds an artist when not already pending', () => {
			sut.openSheet()
			sut.togglePending('a1')

			expect(sut.pendingIds.includes('a1')).toBe(true)
		})

		it('removes an artist when already pending', () => {
			sut.openSheet()
			sut.togglePending('a1')
			sut.togglePending('a1')

			expect(sut.pendingIds.includes('a1')).toBe(false)
		})
	})

	describe('artistNameFor', () => {
		it('returns artist name for a known ID', () => {
			expect(sut.artistNameFor('a1')).toBe('Artist One')
		})

		it('falls back to the ID when artist is not found', () => {
			expect(sut.artistNameFor('unknown')).toBe('unknown')
		})
	})
})
