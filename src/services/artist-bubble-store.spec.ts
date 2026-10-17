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
	listSimilar: vi.fn(
		async (_id: string, _limit: number): Promise<Artist[]> => [],
	),
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

function deferred<T>(): {
	promise: Promise<T>
	resolve: (v: T) => void
	reject: (e: unknown) => void
} {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

async function flush(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve()
}

function ids(prefix: string, n: number): Artist[] {
	return Array.from({ length: n }, (_, i) => artist(`${prefix}${i}`))
}

// Seed the field through the production load path (the store is now the single
// cache; the field is only mutated via its own methods). Uses the global-top
// path (no follows), so callers set `followedArtists` AFTER seeding.
async function seed(
	store: ArtistBubbleStore,
	artists: Artist[],
): Promise<void> {
	mockArtistStore.listTop.mockResolvedValueOnce(artists)
	await store.loadInitial()
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

		it('holds the loaded field as the single in-session cache', async () => {
			mockArtistStore.listTop.mockResolvedValue([artist('a')])
			await sut.loadInitial()
			// The singleton's field IS the cache — no second snapshot is persisted.
			expect(sut.field.map((a) => a.id)).toEqual(['a'])
		})
	})

	describe('loadInitial — path reported for the reveal timing', () => {
		it('records the top path with no seeds when nothing is followed', async () => {
			await sut.loadInitial()
			expect(sut.lastInitialLoad).toEqual({ path: 'top', seedCount: 0 })
		})

		it('records the seed-similar path and seed count before any seed answers', () => {
			followedArtists = ids('f', 7)
			mockArtistStore.listSimilar.mockReturnValue(new Promise(() => {}))

			void sut.loadInitial()

			expect(sut.lastInitialLoad).toEqual({
				path: 'seed_similar',
				seedCount: 5,
			})
		})

		it('forgets the path on sign-out', async () => {
			await sut.loadInitial()
			subscriptions.get(SignedOut)?.(new SignedOut())
			expect(sut.lastInitialLoad).toBeNull()
		})
	})

	describe('loadInitial — seed-similar path', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Sparse seed-similar results are topped up"
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

		// @spec components/infrastructure/fan/web/route/discovery "Sufficient seed-similar results are not diluted"
		it('does not top up when seed-similar already meets the target, even though top was fetched', async () => {
			followedArtists = [artist('seed')]
			mockArtistStore.listSimilar.mockResolvedValue(ids('s', 35))
			mockArtistStore.listTop.mockResolvedValue([artist('t1')])

			await sut.loadInitial()

			expect(sut.field).toHaveLength(35)
			expect(sut.field.some((a) => a.id === 't1')).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Empty seed-similar still fills the field"
		it('fills the field with top artists when every seed fails', async () => {
			followedArtists = [artist('f1'), artist('f2')]
			mockArtistStore.listSimilar.mockRejectedValue(new Error('unavailable'))
			mockArtistStore.listTop.mockResolvedValue([artist('t1'), artist('t2')])

			await sut.loadInitial()

			expect(sut.field.map((a) => a.id)).toEqual(['t1', 't2'])
		})

		// @spec components/infrastructure/fan/web/route/discovery "Top-up does not wait for a second round trip"
		it('requests the top-up together with the seeds, not after them', async () => {
			followedArtists = [artist('f1')]
			const seed = deferred<Artist[]>()
			mockArtistStore.listSimilar.mockReturnValue(seed.promise)
			mockArtistStore.listTop.mockResolvedValue([artist('t1')])

			const load = sut.loadInitial()
			// The top-up is already in flight while the seed is still pending.
			expect(mockArtistStore.listTop).toHaveBeenCalledTimes(1)

			seed.resolve([artist('s1')])
			await load

			expect(mockArtistStore.listTop).toHaveBeenCalledTimes(1)
			expect(sut.field.map((a) => a.id)).toEqual(['s1', 't1'])
		})

		// @spec components/infrastructure/fan/web/route/discovery "User has followed artists (Step 1-b)"
		it('asks for similar artists of each seed with the limit spread over 50', async () => {
			followedArtists = [artist('f1'), artist('f2')]

			await sut.loadInitial()

			expect(mockArtistStore.listSimilar).toHaveBeenCalledTimes(2)
			expect(mockArtistStore.listSimilar).toHaveBeenCalledWith('f1', 25)
			expect(mockArtistStore.listSimilar).toHaveBeenCalledWith('f2', 25)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Seed selection with fewer than 5 followed artists"
		it('uses every followed artist as a seed when fewer than 5 are followed', async () => {
			followedArtists = [artist('f1'), artist('f2'), artist('f3')]

			await sut.loadInitial()

			const seeds = mockArtistStore.listSimilar.mock.calls.map((c) => c[0])
			expect(seeds.sort()).toEqual(['f1', 'f2', 'f3'])
			for (const call of mockArtistStore.listSimilar.mock.calls) {
				expect(call[1]).toBe(16)
			}
		})

		it('picks 5 seeds at 10 each when more than 5 are followed', async () => {
			followedArtists = ids('f', 8)

			await sut.loadInitial()

			expect(mockArtistStore.listSimilar).toHaveBeenCalledTimes(5)
			for (const call of mockArtistStore.listSimilar.mock.calls) {
				expect(call[1]).toBe(10)
			}
		})
	})

	describe('loadInitial — progressive reveal on a cold visit', () => {
		function realIds(field: readonly Artist[]): string[] {
			return field.filter((a) => !a.isGhost).map((a) => a.id)
		}
		function ghostCount(field: readonly Artist[]): number {
			return field.filter((a) => a.isGhost).length
		}

		// @spec components/infrastructure/fan/web/route/discovery "Seed results are revealed as each seed answers"
		// @spec components/infrastructure/fan/web/route/discovery "Cold visit uses ghost bubbles"
		it('replaces ghosts with each seed result as it arrives, deduped and without follows', async () => {
			followedArtists = [artist('f1'), artist('f2')]
			const s1 = deferred<Artist[]>()
			const s2 = deferred<Artist[]>()
			mockArtistStore.listSimilar.mockImplementation(async (id: string) =>
				id === 'f1' ? s1.promise : s2.promise,
			)
			mockArtistStore.listTop.mockResolvedValue([])
			expect(sut.prepareEntry()).toBe(true)

			const load = sut.loadInitial()
			// The second seed answers first: its artists show at once, minus the
			// followed artist and the duplicate, and ghosts fill the rest.
			s2.resolve([artist('b1'), artist('f1'), artist('b1'), artist('b2')])
			await flush()
			expect(realIds(sut.field)).toEqual(['b1', 'b2'])
			expect(ghostCount(sut.field)).toBe(48)

			s1.resolve([artist('a1'), artist('b2')])
			await load
			expect(ghostCount(sut.field)).toBe(0)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Progressive reveal converges to the all-at-once field"
		it('ends with the same field as an all-at-once load, with no ghost left', async () => {
			followedArtists = [artist('f1'), artist('f2'), artist('f3')]
			const results: Record<string, Artist[]> = {
				f1: [artist('a1'), artist('x'), artist('f2')],
				f2: [artist('b1'), artist('x')],
				f3: ids('c', 12),
			}
			mockArtistStore.listTop.mockResolvedValue([artist('t1'), artist('a1')])

			// All at once: no ghosts on the field, so no partial commits.
			mockArtistStore.listSimilar.mockImplementation(
				async (id: string) => results[id],
			)
			const once = new ArtistBubbleStore()
			await once.loadInitial()

			// Progressive: seeds answer one by one in reverse order.
			const pending = new Map<string, ReturnType<typeof deferred<Artist[]>>>()
			mockArtistStore.listSimilar.mockImplementation((id: string) => {
				const d = deferred<Artist[]>()
				pending.set(id, d)
				return d.promise
			})
			sut.prepareEntry()
			const load = sut.loadInitial()
			for (const id of ['f3', 'f2', 'f1']) {
				pending.get(id)?.resolve(results[id])
				await flush()
			}
			await load

			expect(new Set(sut.field.map((a) => a.id))).toEqual(
				new Set(once.field.map((a) => a.id)),
			)
			expect(ghostCount(sut.field)).toBe(0)
		})

		// @spec components/infrastructure/fan/web/route/discovery "A failed seed does not hold back the others"
		it('reveals the answering seeds while another seed fails', async () => {
			followedArtists = [artist('f1'), artist('f2')]
			const s1 = deferred<Artist[]>()
			mockArtistStore.listSimilar.mockImplementation(async (id: string) =>
				id === 'f1' ? s1.promise : [artist('b1')],
			)
			mockArtistStore.listTop.mockResolvedValue([])
			sut.prepareEntry()

			const load = sut.loadInitial()
			await flush()
			expect(realIds(sut.field)).toEqual(['b1'])

			s1.reject(new Error('unavailable'))
			await load
			expect(sut.field.map((a) => a.id)).toEqual(['b1'])
		})

		it('does not mix ghosts into a real field on a stale re-entry reload', async () => {
			await seed(sut, [artist('old')])
			followedArtists = [artist('f1')]
			const s1 = deferred<Artist[]>()
			mockArtistStore.listSimilar.mockReturnValue(s1.promise)

			const load = sut.loadInitial()
			s1.resolve([artist('s1')])
			await flush()
			expect(ghostCount(sut.field)).toBe(0)
			await load
		})
	})

	describe('loadSimilar during the initial load', () => {
		it('waits for the initial load, then adds similar artists instead of reporting none', async () => {
			followedArtists = [artist('f1')]
			const s1 = deferred<Artist[]>()
			mockArtistStore.listSimilar.mockImplementation(
				async (id: string, limit: number) =>
					limit === 30 ? [artist('tapSim')] : s1.promise,
			)
			mockArtistStore.listTop.mockResolvedValue([])
			sut.prepareEntry()

			const load = sut.loadInitial()
			const tap = sut.loadSimilar('b1', { x: 1, y: 2 })
			s1.resolve([artist('b1'), artist('b2')])

			await load
			expect(await tap).toBe(true)
			expect(sut.field.some((a) => a.id === 'tapSim')).toBe(true)
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

	describe('prepareEntry', () => {
		it('re-applies invariants on entry, dropping artists followed while away', async () => {
			await seed(sut, [artist('a'), artist('b'), artist('c')])
			followedArtists = [artist('b')] // followed b on another route while away
			sut.prepareEntry()
			expect(sut.field.map((a) => a.id)).toEqual(['a', 'c'])
		})

		it('paints ghost placeholders on a cold visit (empty field)', () => {
			expect(sut.prepareEntry()).toBe(true)
			expect(sut.field).toHaveLength(50)
			expect(sut.field.every((a) => a.isGhost === true)).toBe(true)
		})

		it('reports no cold visit when it repaints a cached field', async () => {
			await seed(sut, [artist('a')])
			expect(sut.prepareEntry()).toBe(false)
		})
	})

	describe('addAt — FIFO top-up', () => {
		it('keeps new candidates and evicts the oldest existing when over cap', async () => {
			// Fill the field with 50 oldest→newest.
			await seed(sut, ids('old', 50))
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

		it('records placement hints for the added ids', async () => {
			await seed(sut, [artist('a')])
			sut.addAt([artist('b')], { x: 42, y: 7 })
			expect(sut.pendingPlacements.get('b')).toEqual({ x: 42, y: 7 })
		})

		it('clears placement hints on the next full replace', async () => {
			await seed(sut, [artist('a')])
			sut.addAt([artist('b')], { x: 42, y: 7 })
			mockArtistStore.listTop.mockResolvedValue([artist('c')])
			await sut.loadTop('US', '')
			expect(sut.pendingPlacements.size).toBe(0)
		})
	})

	describe('remove', () => {
		it('removes an artist from the field', async () => {
			await seed(sut, [artist('a'), artist('b')])
			sut.remove('a')
			expect(sut.field.map((x) => x.id)).toEqual(['b'])
		})
	})

	describe('loadSimilar', () => {
		it('falls back to top artists when similar is exhausted', async () => {
			await seed(sut, [artist('tapped')])
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
