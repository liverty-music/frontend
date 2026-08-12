import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../entities/artist'
import { SignedOut } from './events/signed-out'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const mockArtistStore = {
	listTop: vi.fn(async (): Promise<Artist[]> => []),
	listSimilar: vi.fn(async (): Promise<Artist[]> => []),
	setBubbles: vi.fn(),
}

let followedArtists: Artist[] = []
const mockFollowStore = {
	get followedArtists() {
		return followedArtists
	},
	get followedIds(): ReadonlySet<string> {
		return new Set(followedArtists.map((a) => a.id))
	},
}

type Handler = (event: unknown) => void
const subscriptions = new Map<unknown, Handler>()
const mockEa = {
	subscribe: vi.fn((channel: unknown, handler: Handler) => {
		subscriptions.set(channel, handler)
		return { dispose: vi.fn() }
	}),
	publish: vi.fn(),
}

vi.mock('../util/detect-country', () => ({
	detectCountryFromTimezone: () => 'US',
}))

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IArtistStore: mockArtistStore,
				IFollowStore: mockFollowStore,
				IEventAggregator: mockEa,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { ArtistBubbleStore } from './artist-bubble-store'

function artist(id: string, name = id): Artist {
	return { id, name, mbid: '' } as Artist
}

function ids(prefix: string, n: number): Artist[] {
	return Array.from({ length: n }, (_, i) => artist(`${prefix}${i}`))
}

describe('ArtistBubbleStore', () => {
	let sut: ArtistBubbleStore

	beforeEach(() => {
		vi.clearAllMocks()
		subscriptions.clear()
		followedArtists = []
		mockArtistStore.listTop.mockImplementation(async () => [])
		mockArtistStore.listSimilar.mockImplementation(async () => [])
		sut = new ArtistBubbleStore()
	})

	describe('loadInitial — global top path', () => {
		it('sets the field to the top artists when nothing is followed', async () => {
			mockArtistStore.listTop.mockResolvedValue([
				artist('a'),
				artist('b'),
				artist('c'),
			])

			await sut.loadInitial()

			expect(mockArtistStore.listTop).toHaveBeenCalledWith('US', '', 50)
			expect(mockArtistStore.listSimilar).not.toHaveBeenCalled()
			expect(sut.field.map((a) => a.id)).toEqual(['a', 'b', 'c'])
		})

		it('persists the final field to the re-entry cache', async () => {
			mockArtistStore.listTop.mockResolvedValue([artist('a')])
			await sut.loadInitial()
			expect(mockArtistStore.setBubbles).toHaveBeenCalledWith([artist('a')])
		})
	})

	describe('loadInitial — seed-similar path', () => {
		it('tops up sparse seed-similar with top artists, similar first, deduped', async () => {
			followedArtists = [artist('seed')]
			mockArtistStore.listSimilar.mockResolvedValue([
				artist('s1'),
				artist('s2'),
				artist('s3'),
			])
			mockArtistStore.listTop.mockResolvedValue([
				artist('t1'),
				artist('t2'),
				artist('s2'), // duplicate of a similar result — must be deduped out
			])

			await sut.loadInitial()

			expect(mockArtistStore.listSimilar).toHaveBeenCalled()
			expect(mockArtistStore.listTop).toHaveBeenCalledWith('US', '', 50)
			expect(sut.field.map((a) => a.id)).toEqual(['s1', 's2', 's3', 't1', 't2'])
		})

		it('does not top up when seed-similar already meets the target', async () => {
			followedArtists = [artist('seed')]
			mockArtistStore.listSimilar.mockResolvedValue(ids('s', 35))
			mockArtistStore.listTop.mockResolvedValue([artist('t1')])

			await sut.loadInitial()

			expect(mockArtistStore.listTop).not.toHaveBeenCalled()
			expect(sut.field).toHaveLength(35)
		})
	})

	describe('invariants applied once at the field boundary', () => {
		it('excludes followed artists when producing the field', async () => {
			followedArtists = [artist('b')]
			mockArtistStore.listTop.mockResolvedValue([
				artist('a'),
				artist('b'),
				artist('c'),
			])

			await sut.loadTop('US', '')

			expect(sut.field.map((a) => a.id)).toEqual(['a', 'c'])
		})

		it('caps the field to 50 (tail-drop) on a full replace', async () => {
			mockArtistStore.listTop.mockResolvedValue(ids('x', 60))
			await sut.loadTop('US', '')
			expect(sut.field).toHaveLength(50)
			expect(sut.field[0].id).toBe('x0') // head kept
		})

		it('publishes a new frozen array reference on each update', async () => {
			mockArtistStore.listTop.mockResolvedValue([artist('a')])
			const before = sut.field
			await sut.loadTop('US', '')
			expect(sut.field).not.toBe(before)
			expect(Object.isFrozen(sut.field)).toBe(true)
		})
	})

	describe('paintFromCache', () => {
		it('excludes followed artists from the cached snapshot synchronously', () => {
			followedArtists = [artist('b')]
			sut.paintFromCache([artist('a'), artist('b'), artist('c')])
			expect(sut.field.map((a) => a.id)).toEqual(['a', 'c'])
		})
	})

	describe('addAt — FIFO top-up', () => {
		it('keeps new candidates and evicts the oldest existing when over cap', () => {
			// Fill the field with 50 oldest→newest.
			sut.paintFromCache(ids('old', 50))
			const added = sut.addAt([artist('new0'), artist('new1')], {
				x: 10,
				y: 20,
			})

			expect(added.map((a) => a.id)).toEqual(['new0', 'new1'])
			expect(sut.field).toHaveLength(50)
			// The two oldest were evicted; the new ones are present.
			expect(sut.field.some((a) => a.id === 'old0')).toBe(false)
			expect(sut.field.some((a) => a.id === 'old1')).toBe(false)
			expect(sut.field.some((a) => a.id === 'new0')).toBe(true)
			expect(sut.field.some((a) => a.id === 'new1')).toBe(true)
		})

		it('records placement hints for the added ids', () => {
			sut.paintFromCache([artist('a')])
			sut.addAt([artist('b')], { x: 42, y: 7 })
			expect(sut.pendingPlacements.get('b')).toEqual({ x: 42, y: 7 })
		})

		it('clears placement hints on the next full replace', async () => {
			sut.paintFromCache([artist('a')])
			sut.addAt([artist('b')], { x: 42, y: 7 })
			mockArtistStore.listTop.mockResolvedValue([artist('c')])
			await sut.loadTop('US', '')
			expect(sut.pendingPlacements.size).toBe(0)
		})
	})

	describe('remove', () => {
		it('removes an artist from the field', () => {
			sut.paintFromCache([artist('a'), artist('b')])
			sut.remove('a')
			expect(sut.field.map((x) => x.id)).toEqual(['b'])
		})
	})

	describe('loadSimilar', () => {
		it('falls back to top artists when similar is exhausted', async () => {
			sut.paintFromCache([artist('tapped')])
			mockArtistStore.listSimilar.mockResolvedValue([]) // exhausted
			mockArtistStore.listTop.mockResolvedValue([artist('r1'), artist('r2')])

			const added = await sut.loadSimilar('tapped', { x: 1, y: 2 })

			expect(added).toBe(true)
			expect(mockArtistStore.listTop).toHaveBeenCalled()
			expect(sut.field.some((a) => a.id === 'r1')).toBe(true)
		})

		it('guards against concurrent loads', async () => {
			let resolveSimilar: (v: Artist[]) => void = () => {}
			mockArtistStore.listSimilar.mockReturnValue(
				new Promise<Artist[]>((r) => {
					resolveSimilar = r
				}),
			)
			const first = sut.loadSimilar('a', { x: 0, y: 0 })
			const second = await sut.loadSimilar('b', { x: 0, y: 0 })
			expect(second).toBe(false) // locked out
			resolveSimilar([artist('s1')])
			await first
		})
	})

	describe('SignedOut', () => {
		it('clears the field on sign-out (no cross-user bleed)', async () => {
			mockArtistStore.listTop.mockResolvedValue([artist('a')])
			await sut.loadTop('US', '')
			expect(sut.field).toHaveLength(1)

			const handler = subscriptions.get(SignedOut)
			expect(handler).toBeDefined()
			handler?.(new SignedOut())

			expect(sut.field).toHaveLength(0)
		})
	})
})
