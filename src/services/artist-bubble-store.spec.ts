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

	describe('reenter — in-session field preservation (Phase 2)', () => {
		it('reuses a fresh field without re-fetching when nothing was followed', async () => {
			mockArtistStore.listTop.mockResolvedValue(ids('a', 40))
			await sut.loadInitial() // field=40, freshly built
			mockArtistStore.listTop.mockClear()

			await sut.reenter()

			// Fresh + above floor + no new follows → pure reuse, no wholesale re-fetch.
			expect(mockArtistStore.listTop).not.toHaveBeenCalled()
			expect(sut.field).toHaveLength(40)
		})

		it('removes only artists followed while away and keeps the rest (above floor → no top-up)', async () => {
			mockArtistStore.listTop.mockResolvedValue(ids('a', 40))
			await sut.loadInitial()
			// Followed a0–a4 on another route while away.
			followedArtists = ids('a', 5)
			mockArtistStore.listTop.mockClear()

			await sut.reenter()

			expect(sut.field).toHaveLength(35)
			expect(sut.field.some((x) => x.id === 'a0')).toBe(false)
			expect(sut.field.some((x) => x.id === 'a10')).toBe(true)
			expect(mockArtistStore.listTop).not.toHaveBeenCalled()
		})

		it('tops up to the display floor when follows thinned the field below it', async () => {
			mockArtistStore.listTop.mockResolvedValue(ids('a', 32))
			await sut.loadInitial() // field=32 (a0..a31), all tracked as seen
			followedArtists = ids('a', 10) // a0..a9 followed while away → 22 remain
			// Top-up fetch returns the seen a's (filtered) plus fresh b's.
			mockArtistStore.listTop.mockResolvedValue([
				...ids('a', 32),
				...ids('b', 20),
			])

			await sut.reenter()

			// 22 kept + 8 fresh b's = display floor (30); never a wholesale re-roll.
			expect(mockArtistStore.listTop).toHaveBeenCalled()
			expect(sut.field).toHaveLength(30)
			expect(sut.field.some((x) => x.id === 'a10')).toBe(true)
			expect(sut.field.filter((x) => x.id.startsWith('b'))).toHaveLength(8)
		})

		it('falls back to a full cold reload when the field is stale (past the reuse TTL)', async () => {
			vi.useFakeTimers()
			try {
				vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
				mockArtistStore.listTop.mockResolvedValue(ids('a', 40))
				await sut.loadInitial()

				// Return well past the 15-minute reuse TTL.
				vi.setSystemTime(new Date('2026-01-01T01:00:00Z'))
				mockArtistStore.listTop.mockClear()
				mockArtistStore.listTop.mockResolvedValue(ids('c', 40))

				await sut.reenter()

				expect(mockArtistStore.listTop).toHaveBeenCalled()
				expect(sut.field.some((x) => x.id === 'c0')).toBe(true)
			} finally {
				vi.useRealTimers()
			}
		})

		it('does a full load when there is no field yet (cold visit)', async () => {
			mockArtistStore.listTop.mockResolvedValue(ids('a', 10))

			await sut.reenter()

			expect(mockArtistStore.listTop).toHaveBeenCalled()
			expect(sut.field).toHaveLength(10)
		})
	})
})
