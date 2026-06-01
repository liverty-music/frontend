import type { ILogger } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../entities/artist'
import { BubbleManager } from './bubble-manager'

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as ILogger

function artist(id: string, name = id): Artist {
	return { id, name, mbid: '' } as Artist
}

describe('BubbleManager.reset', () => {
	let listTop: ReturnType<typeof vi.fn>
	let listSimilar: ReturnType<typeof vi.fn>
	let followed: Set<string>

	beforeEach(() => {
		listTop = vi.fn()
		listSimilar = vi.fn(async () => [])
		followed = new Set<string>()
	})

	function makeManager(): BubbleManager {
		return new BubbleManager({ listTop, listSimilar }, logger, () => followed)
	}

	it('replaces the pool with the global top artists', async () => {
		listTop.mockResolvedValue([artist('a'), artist('b'), artist('c')])
		const mgr = makeManager()

		await mgr.reset([])

		// Always the global top path: empty tag, full cap, never similar-seeded.
		expect(listTop).toHaveBeenCalledWith(expect.any(String), '', 50)
		expect(listSimilar).not.toHaveBeenCalled()
		expect(mgr.poolBubbles.map((a) => a.id)).toEqual(['a', 'b', 'c'])
	})

	it('excludes followed artists from the reset pool', async () => {
		listTop.mockResolvedValue([artist('a'), artist('b'), artist('c')])
		followed = new Set(['b'])
		const mgr = makeManager()

		await mgr.reset([artist('b')])

		expect(mgr.poolBubbles.map((a) => a.id)).toEqual(['a', 'c'])
	})

	it('clears seen-sets so a previously seen artist can reappear', async () => {
		// Initial load tracks old1/old2 as seen.
		listTop.mockResolvedValueOnce([artist('old1'), artist('old2')])
		const mgr = makeManager()
		await mgr.loadInitialArtists([], 'US', '')
		expect(mgr.poolBubbles).toHaveLength(2)

		// Reset fetches a fresh list that re-includes old1. If seen-sets were NOT
		// cleared, dedup would drop old1; clearing them lets it reappear.
		listTop.mockResolvedValueOnce([
			artist('new1'),
			artist('new2'),
			artist('old1'),
		])
		await mgr.reset([])

		expect(mgr.poolBubbles.map((a) => a.id)).toEqual(['new1', 'new2', 'old1'])
	})
})

describe('BubbleManager.loadInitialArtists', () => {
	let listTop: ReturnType<typeof vi.fn>
	let listSimilar: ReturnType<typeof vi.fn>
	let followed: Set<string>

	beforeEach(() => {
		listTop = vi.fn()
		listSimilar = vi.fn(async () => [])
		followed = new Set<string>()
	})

	function makeManager(): BubbleManager {
		return new BubbleManager({ listTop, listSimilar }, logger, () => followed)
	}

	it('tops up with top artists when seed-similar resolves to nothing', async () => {
		// User follows an artist, so the similar-seed path is taken — but every
		// similar lookup returns empty (e.g. no Last.fm match), which would leave
		// the field blank without the top-up.
		followed = new Set(['seed'])
		listSimilar.mockResolvedValue([])
		listTop.mockResolvedValue([artist('top1'), artist('top2')])
		const mgr = makeManager()

		await mgr.loadInitialArtists([artist('seed')], 'US', '')

		expect(listSimilar).toHaveBeenCalled()
		expect(listTop).toHaveBeenCalledWith('US', '', 50)
		expect(mgr.poolBubbles.map((a) => a.id)).toEqual(['top1', 'top2'])
	})

	it('tops up sparse seed-similar with top artists, similar first', async () => {
		// 3 similar artists resolve (< target 30) → field is topped up with
		// global top artists, but the similar artists keep priority.
		followed = new Set(['seed'])
		listSimilar.mockResolvedValue([artist('s1'), artist('s2'), artist('s3')])
		listTop.mockResolvedValue([
			artist('t1'),
			artist('t2'),
			artist('s2'), // duplicate of a similar result — must be deduped out
		])
		const mgr = makeManager()

		await mgr.loadInitialArtists([artist('seed')], 'US', '')

		expect(listTop).toHaveBeenCalledWith('US', '', 50)
		expect(mgr.poolBubbles.map((a) => a.id)).toEqual([
			's1',
			's2',
			's3',
			't1',
			't2',
		])
	})

	it('does not top up when seed-similar already meets the target', async () => {
		// 30+ similar artists resolve → no need to dilute with top artists.
		followed = new Set(['seed'])
		const many = Array.from({ length: 35 }, (_, i) => artist(`s${i}`))
		listSimilar.mockResolvedValue(many)
		listTop.mockResolvedValue([artist('t1')])
		const mgr = makeManager()

		await mgr.loadInitialArtists([artist('seed')], 'US', '')

		expect(listTop).not.toHaveBeenCalled()
		expect(mgr.poolBubbles).toHaveLength(35)
	})
})
