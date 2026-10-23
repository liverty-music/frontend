import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ILocalStorage } from '../adapter/storage/local-storage'
import { guestMergedReceiptKey } from '../constants/storage-keys'
import type { Artist } from '../entities/artist'
import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type Hype,
} from '../entities/follow'
import { GuestMigrationRequested } from './events/guest-migration-requested'
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

const mockAuth = {
	isAuthenticated: true,
	user: { profile: { sub: 'sub-1' } } as { profile: { sub: string } } | null,
}

const mockRpcClient = {
	list: vi.fn(async (): Promise<FollowedArtist[]> => []),
	follow: vi.fn(async (_id: string) => undefined),
	unfollow: vi.fn(async (_id: string) => undefined),
	setHype: vi.fn(async (_id: string, _hype: Hype) => undefined),
}

const mockConcertStore = {
	invalidateFollowerCache: vi.fn(),
}

// FollowStore now hydrates the guest follow queue from the guest-storage adapter
// on construction (FollowServiceClient is dissolved). Drive it via a mutable
// seed array that loadFollows returns and saveFollows mirrors back.
let guestSeed: FollowedArtist[] = []
const saveFollows = vi.fn((follows: FollowedArtist[]) => {
	guestSeed = [...follows]
})
vi.mock('../adapter/storage/guest-storage', () => ({
	loadFollows: vi.fn(() => [...guestSeed]),
	saveFollows: (follows: FollowedArtist[]) => saveFollows(follows),
}))

const lsMap = new Map<string, string>()
const mockStorage: ILocalStorage = {
	getItem: vi.fn((k: string) => lsMap.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => {
		lsMap.set(k, v)
	}),
	removeItem: vi.fn((k: string) => {
		lsMap.delete(k)
	}),
	removeByPrefix: vi.fn((prefix: string) => {
		for (const k of [...lsMap.keys()]) {
			if (k.startsWith(prefix)) lsMap.delete(k)
		}
	}),
}

// Capture EA subscriptions so the test can fire GuestMigrationRequested / SignedOut.
type Handler = (event: unknown) => void
const subscriptions = new Map<unknown, Handler>()
const mockEa = {
	subscribe: vi.fn((channel: unknown, handler: Handler) => {
		subscriptions.set(channel, handler)
		return { dispose: vi.fn() }
	}),
	publish: vi.fn(),
}

const mockHaptic = {
	tap: vi.fn(),
	confirm: vi.fn(),
	pulse: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				// Key actions add a step for the error report.
				IErrorBoundaryService: { addBreadcrumb: () => {} },
				IAuthService: mockAuth,
				IFollowRpcClient: mockRpcClient,
				IConcertStore: mockConcertStore,
				ILocalStorage: mockStorage,
				IEventAggregator: mockEa,
				IHapticService: mockHaptic,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { FollowStore } from './follow-store'

function makeArtist(id: string, name: string): Artist {
	return { id, name } as Artist
}

function makeFollow(id: string, hype: Hype = DEFAULT_HYPE): FollowedArtist {
	return { artist: makeArtist(id, `Artist ${id}`), hype }
}

function makeFollowedArtist(id: string, name: string): FollowedArtist {
	return { artist: makeArtist(id, name), hype: DEFAULT_HYPE }
}

describe('FollowStore', () => {
	let sut: FollowStore

	beforeEach(() => {
		vi.clearAllMocks()
		subscriptions.clear()
		lsMap.clear()
		guestSeed = []
		mockAuth.isAuthenticated = true
		// clearAllMocks keeps per-test mockImplementation overrides, so restore
		// the happy-path RPC defaults to prevent one test's failure-injection
		// (e.g. follow throwing) from leaking into the next.
		mockRpcClient.follow.mockImplementation(async (_id: string) => undefined)
		mockRpcClient.setHype.mockImplementation(
			async (_id: string, _hype: Hype) => undefined,
		)
		sut = new FollowStore()
	})

	function fireMigrationRequested(userId: string): Promise<void> {
		const handler = subscriptions.get(GuestMigrationRequested)
		handler?.(new GuestMigrationRequested(userId))
		// Migration runs as a fire-and-forget promise inside the handler; flush
		// the microtask queue so its awaits settle before assertions.
		return Promise.resolve()
	}

	describe('follow — cache invalidation', () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Cache invalidated after follow"
		it('calls invalidateFollowerCache on successful follow', async () => {
			mockRpcClient.follow.mockResolvedValueOnce(undefined)
			const artist = makeArtist('a1', 'Artist One')

			await sut.follow(artist)

			expect(mockConcertStore.invalidateFollowerCache).toHaveBeenCalledOnce()
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Cache not invalidated on follow RPC failure"
		it('does NOT call invalidateFollowerCache when follow RPC fails', async () => {
			mockRpcClient.follow.mockRejectedValueOnce(new Error('network error'))
			const artist = makeArtist('a1', 'Artist One')

			await expect(sut.follow(artist)).rejects.toThrow('network error')

			expect(mockConcertStore.invalidateFollowerCache).not.toHaveBeenCalled()
		})

		it('rolls back the optimistic projection when the follow RPC fails', async () => {
			mockRpcClient.follow.mockRejectedValueOnce(new Error('network error'))
			const artist = makeArtist('a1', 'Artist One')

			await expect(sut.follow(artist)).rejects.toThrow('network error')

			expect(sut.followedArtists).toEqual([])
		})
	})

	describe('unfollow — cache invalidation', () => {
		it('calls invalidateFollowerCache on successful unfollow', async () => {
			mockRpcClient.unfollow.mockResolvedValueOnce(undefined)
			// Seed followedArtists so the filter doesn't no-op into empty
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await sut.unfollow('a1')

			expect(mockConcertStore.invalidateFollowerCache).toHaveBeenCalledOnce()
		})

		it('does NOT call invalidateFollowerCache when unfollow RPC fails', async () => {
			mockRpcClient.unfollow.mockRejectedValueOnce(new Error('network error'))
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await expect(sut.unfollow('a1')).rejects.toThrow('network error')

			expect(mockConcertStore.invalidateFollowerCache).not.toHaveBeenCalled()
		})
	})

	describe('getFollowedArtistMap — always issues RPC (hype data not cached)', () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Follow state not yet loaded"
		it('calls FollowService.List RPC when followedArtists is empty', async () => {
			mockRpcClient.list.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
			])

			await sut.getFollowedArtistMap()

			expect(mockRpcClient.list).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Follow state already in memory"
		it('calls FollowService.List RPC on each call (hype data lives in RPC response)', async () => {
			mockRpcClient.list.mockResolvedValue([
				makeFollowedArtist('a1', 'Artist One'),
			])
			// Even with followedArtists populated, FollowService.List must be called
			// to retrieve per-artist hype values which are not stored in followedArtists.
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await sut.getFollowedArtistMap()

			expect(mockRpcClient.list).toHaveBeenCalledTimes(1)
		})
	})

	describe('ensureLoaded', () => {
		it('loads the signed-in follow list once and shares it between callers', async () => {
			mockRpcClient.list.mockResolvedValue([makeFollowedArtist('a1', 'One')])

			const [first, second] = await Promise.all([
				sut.ensureLoaded(),
				sut.ensureLoaded(),
			])
			await sut.ensureLoaded()

			expect(mockRpcClient.list).toHaveBeenCalledOnce()
			expect(first).toBe(second)
			expect(sut.followedArtists).toEqual([makeArtist('a1', 'One')])
		})

		it('retries on the next call after a failed load', async () => {
			mockRpcClient.list
				.mockRejectedValueOnce(new Error('unavailable'))
				.mockResolvedValueOnce([makeFollowedArtist('a1', 'One')])

			await expect(sut.ensureLoaded()).rejects.toThrow('unavailable')
			await sut.ensureLoaded()

			expect(mockRpcClient.list).toHaveBeenCalledTimes(2)
		})

		it('loads again after the session is cleared', async () => {
			mockRpcClient.list.mockResolvedValue([])
			await sut.ensureLoaded()

			sut.clear()
			await sut.ensureLoaded()

			expect(mockRpcClient.list).toHaveBeenCalledTimes(2)
		})
	})

	describe('listFollowed', () => {
		it('sets followedArtists to the mapped Artist array when authenticated', async () => {
			mockRpcClient.list.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
				makeFollowedArtist('a2', 'Artist Two'),
			])

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([
				makeArtist('a1', 'Artist One'),
				makeArtist('a2', 'Artist Two'),
			])
		})

		// @spec components/infrastructure/fan/web/route/discovery "Seeds come from the follows kept on the device"
		it('keeps the signed-in list on the device for the next start, per account', async () => {
			mockRpcClient.list.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
			])

			await sut.listFollowed()

			expect(sut.keptFollowedArtists().map((a) => a.id)).toEqual(['a1'])
			mockAuth.user = { profile: { sub: 'sub-2' } }
			expect(sut.keptFollowedArtists()).toEqual([])
			mockAuth.user = { profile: { sub: 'sub-1' } }
		})

		it('sets followedArtists from guest storage follows when not authenticated', async () => {
			mockAuth.isAuthenticated = false
			guestSeed = [makeFollowedArtist('g1', 'Guest Artist')]
			// Reconstruct so the guest queue hydrates from the new seed.
			sut = new FollowStore()

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([makeArtist('g1', 'Guest Artist')])
		})

		it('sets followedArtists to [] when result is empty', async () => {
			mockRpcClient.list.mockResolvedValueOnce([])
			sut.followedArtists = [makeArtist('stale', 'Stale Artist')]

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([])
		})
	})

	describe('guest follow queue (localStorage-backed, no RPC)', () => {
		beforeEach(() => {
			mockAuth.isAuthenticated = false
		})

		it('persists a guest follow with NO RPC and exposes it via guestFollows', async () => {
			await sut.follow(makeArtist('g1', 'Guest One'))

			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['g1'])
			expect(saveFollows).toHaveBeenCalled()
			expect(mockRpcClient.follow).not.toHaveBeenCalled()
		})

		it('removeGuestFollows drains a batch in a single persist', async () => {
			guestSeed = [
				makeFollowedArtist('g1', 'One'),
				makeFollowedArtist('g2', 'Two'),
				makeFollowedArtist('g3', 'Three'),
			]
			sut = new FollowStore()

			sut.removeGuestFollows(['g1', 'g3'])

			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['g2'])
			expect(saveFollows).toHaveBeenCalledTimes(1)
		})

		it('clearGuestFollows empties the persisted queue', async () => {
			guestSeed = [makeFollowedArtist('g1', 'One')]
			sut = new FollowStore()

			sut.clearGuestFollows()

			expect(sut.guestFollows).toHaveLength(0)
		})

		it('setHype persists a guest hype change with NO RPC', async () => {
			guestSeed = [makeFollowedArtist('g1', 'One')]
			sut = new FollowStore()

			await sut.setHype('g1', 'away')

			expect(sut.guestFollows[0]?.hype).toBe('away')
			expect(mockRpcClient.setHype).not.toHaveBeenCalled()
		})
	})

	describe('GuestMigrationRequested → migrate', () => {
		beforeEach(() => {
			// Migration moves the guest queue to the backend, so the queue must be
			// populated; auth state does not gate the migration RPC calls.
			mockAuth.isAuthenticated = false
		})

		it('follows each guest artist, drains the batch, and writes the receipt', async () => {
			guestSeed = [makeFollow('a1'), makeFollow('a2')]
			sut = new FollowStore()

			await sut.migrateGuestFollows('user-1')

			expect(mockRpcClient.follow).toHaveBeenCalledTimes(2)
			expect(mockRpcClient.follow).toHaveBeenCalledWith('a1')
			expect(mockRpcClient.follow).toHaveBeenCalledWith('a2')
			// Batched drain emptied the queue.
			expect(sut.guestFollows).toHaveLength(0)
			// Receipt written for the account.
			expect(lsMap.get(guestMergedReceiptKey('user-1'))).toBe('1')
		})

		it('drains the fully-migrated batch with a SINGLE persist (no O(n^2) write storm)', async () => {
			guestSeed = [makeFollow('a1'), makeFollow('a2'), makeFollow('a3')]
			sut = new FollowStore()

			await sut.migrateGuestFollows('user-1')

			// One persist for the batched drain rather than one write per item.
			// follow/setHype are guest-internal here, so the only persist on the
			// migration path is the batched removeGuestFollows.
			expect(saveFollows).toHaveBeenCalledOnce()
		})

		it('migrates non-default hype only for successfully followed artists', async () => {
			guestSeed = [makeFollow('a1', 'away'), makeFollow('a2')]
			sut = new FollowStore()

			await sut.migrateGuestFollows('user-1')

			expect(mockRpcClient.setHype).toHaveBeenCalledOnce()
			expect(mockRpcClient.setHype).toHaveBeenCalledWith('a1', 'away')
		})

		it('leaves only the failed item in the queue and DEFERS the receipt', async () => {
			guestSeed = [makeFollow('a1'), makeFollow('a2')]
			sut = new FollowStore()
			mockRpcClient.follow.mockImplementation(async (id: string) => {
				if (id === 'a2') throw new Error('network')
			})

			await sut.migrateGuestFollows('user-1')

			// a1 drained, a2 failed → remains.
			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['a2'])
			// No receipt: the next reconcile must retry the failed item.
			expect(lsMap.has(guestMergedReceiptKey('user-1'))).toBe(false)
		})

		it('does NOT drain an item whose SetHype fails, and DEFERS the receipt', async () => {
			// a1 has a non-default hype; its Follow succeeds but SetHype throws.
			guestSeed = [makeFollow('a1', 'away'), makeFollow('a2')]
			sut = new FollowStore()
			mockRpcClient.setHype.mockImplementation(async (id: string) => {
				if (id === 'a1') throw new Error('hype rpc failed')
			})

			await sut.migrateGuestFollows('user-1')

			// a1 Follow succeeded but its hype did not migrate → keep it for retry
			// so the non-default hype is not lost; a2 (default hype) drains.
			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['a1'])
			// Receipt deferred so reconcile re-issues SetHype for a1.
			expect(lsMap.has(guestMergedReceiptKey('user-1'))).toBe(false)
		})

		it('writes the receipt even when the guest queue is empty', async () => {
			guestSeed = []
			sut = new FollowStore()

			await sut.migrateGuestFollows('user-1')

			expect(mockRpcClient.follow).not.toHaveBeenCalled()
			expect(lsMap.get(guestMergedReceiptKey('user-1'))).toBe('1')
		})

		it('is triggered by the GuestMigrationRequested event subscription', async () => {
			const migrateSpy = vi
				.spyOn(sut, 'migrateGuestFollows')
				.mockResolvedValue()

			await fireMigrationRequested('user-evt')

			expect(migrateSpy).toHaveBeenCalledWith('user-evt')
		})

		it('does not double-migrate: a second pass with an empty queue re-asserts the receipt only', async () => {
			guestSeed = [makeFollow('a1')]
			sut = new FollowStore()
			await sut.migrateGuestFollows('user-1')
			expect(mockRpcClient.follow).toHaveBeenCalledTimes(1)

			// Queue already drained → second pass issues no new Follow calls.
			await sut.migrateGuestFollows('user-1')
			expect(mockRpcClient.follow).toHaveBeenCalledTimes(1)
			expect(lsMap.get(guestMergedReceiptKey('user-1'))).toBe('1')
		})
	})

	describe('SignedOut → self-clear + cache eviction', () => {
		it('clears the guest follow queue and evicts the projection', () => {
			mockAuth.isAuthenticated = false
			guestSeed = [makeFollow('a1')]
			sut = new FollowStore()
			sut.followedArtists = [makeArtist('a1', 'Artist a1')]

			const handler = subscriptions.get(SignedOut)
			handler?.(new SignedOut())

			expect(sut.guestFollows).toHaveLength(0)
			expect(sut.followedArtists).toEqual([])
		})

		// @spec components/infrastructure/fan/web/route/discovery "Seeds come from the follows kept on the device"
		it('forgets the kept follow list', async () => {
			mockRpcClient.list.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
			])
			await sut.listFollowed()

			subscriptions.get(SignedOut)?.(new SignedOut())

			expect(sut.keptFollowedArtists()).toEqual([])
		})

		it('clears the guest-merge receipts so a fresh post-sign-out guest session can migrate again', () => {
			// Two accounts previously migrated in this browser.
			lsMap.set(guestMergedReceiptKey('user-1'), '1')
			lsMap.set(guestMergedReceiptKey('user-2'), '1')

			const handler = subscriptions.get(SignedOut)
			handler?.(new SignedOut())

			expect(mockStorage.removeByPrefix).toHaveBeenCalledOnce()
			expect(sut.hasReceipt('user-1')).toBe(false)
			expect(sut.hasReceipt('user-2')).toBe(false)
		})

		it('leaves the kept referral code on the device', () => {
			// A referral link's code is not account data: it stays across
			// sign-out until it expires (OpenSpec `referral-attribution`, D7).
			const kept = JSON.stringify({
				code: 'member-a',
				seriesId: 's1',
				expiresAt: Date.now() + 1000,
			})
			lsMap.set('referral', kept)

			const handler = subscriptions.get(SignedOut)
			handler?.(new SignedOut())

			expect(lsMap.get('referral')).toBe(kept)
		})

		it('clear() is idempotent and evicts the projection', () => {
			sut.followedArtists = [makeArtist('a1', 'Artist a1')]
			sut.clear()
			sut.clear()
			expect(sut.guestFollows).toHaveLength(0)
			expect(sut.followedArtists).toEqual([])
		})
	})

	describe('hasReceipt', () => {
		it('reflects the persisted per-account receipt key', () => {
			expect(sut.hasReceipt('user-1')).toBe(false)
			lsMap.set(guestMergedReceiptKey('user-1'), '1')
			expect(sut.hasReceipt('user-1')).toBe(true)
		})
	})
})
