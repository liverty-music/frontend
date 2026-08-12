import { describe, expect, it } from 'vitest'
import type { Artist } from '../entities/artist'
import {
	capTo,
	dedupById,
	excludeFollowed,
	SeenTracker,
} from './bubble-invariants'

function artist(id: string, name = id, mbid = ''): Artist {
	return { id, name, mbid } as Artist
}

describe('dedupById', () => {
	it('drops intra-array duplicates by id, keeping the first occurrence', () => {
		const out = dedupById([artist('a'), artist('b'), artist('a', 'A2')])
		expect(out.map((a) => a.id)).toEqual(['a', 'b'])
		expect(out[0].name).toBe('a') // first occurrence wins
	})

	it('drops same-name duplicates arriving under different ids (the Vaundy×3 bug)', () => {
		// Seed-similar `results.flat()` merged the same artist across seeds under
		// different ids; the old pool dedup (seen-set only) let these through.
		const out = dedupById([
			artist('id1', 'Vaundy'),
			artist('id2', 'vaundy '), // different id, same normalized name
			artist('id3', 'VAUNDY'),
		])
		expect(out.map((a) => a.id)).toEqual(['id1'])
	})

	it('drops duplicates sharing an mbid', () => {
		const out = dedupById([
			artist('id1', 'A', 'mb-1'),
			artist('id2', 'B', 'mb-1'),
		])
		expect(out.map((a) => a.id)).toEqual(['id1'])
	})
})

describe('excludeFollowed', () => {
	it('removes followed artists', () => {
		const out = excludeFollowed(
			[artist('a'), artist('b'), artist('c')],
			new Set(['b']),
		)
		expect(out.map((a) => a.id)).toEqual(['a', 'c'])
	})
})

describe('capTo', () => {
	it('drops from the tail (head keeps priority)', () => {
		const out = capTo([artist('a'), artist('b'), artist('c')], 2)
		expect(out.map((a) => a.id)).toEqual(['a', 'b'])
	})

	it('returns a copy when already within the cap', () => {
		const input = [artist('a')]
		const out = capTo(input, 5)
		expect(out).toEqual(input)
		expect(out).not.toBe(input)
	})
})

describe('SeenTracker', () => {
	it('filters out artists already tracked by name/id/mbid', () => {
		const seen = new SeenTracker()
		seen.trackAll([artist('a', 'Ado')])
		const out = seen.filterUnseen([
			artist('a2', 'ado'), // same normalized name
			artist('b', 'YOASOBI'),
		])
		expect(out.map((a) => a.id)).toEqual(['b'])
	})

	it('resetWith clears then re-seeds so prior-seen artists can reappear', () => {
		const seen = new SeenTracker()
		seen.trackAll([artist('old')])
		seen.resetWith([artist('keep')])
		expect(seen.isSeen(artist('old'))).toBe(false)
		expect(seen.isSeen(artist('keep'))).toBe(true)
	})
})
