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

// Guest follow source backed by a mutable array so per-item drain is observable.
const mockGuest = {
	follows: [] as FollowedArtist[],
	removeFollow: vi.fn((id: string) => {
		const idx = mockGuest.follows.findIndex((f) => f.artist.id === id)
		if (idx >= 0) mockGuest.follows.splice(idx, 1)
	}),
	// Counts calls so a test can assert the drain persisted ONCE for the batch.
	removeFollows: vi.fn((ids: readonly string[]) => {
		const remove = new Set(ids)
		mockGuest.follows = mockGuest.follows.filter(
			(f) => !remove.has(f.artist.id),
		)
	}),
	clearFollows: vi.fn(() => {
		mockGuest.follows.splice(0)
	}),
}

const mockRpcClient = {
	follow: vi.fn(async (_id: string) => undefined),
	setHype: vi.fn(async (_id: string, _hype: Hype) => undefined),
}

const mockDelegate = {
	followedArtists: [] as Artist[],
	followedIds: new Set<string>(),
	followedCount: 0,
	hydrate: vi.fn(),
	clear: vi.fn(() => {
		mockDelegate.followedArtists = []
	}),
	follow: vi.fn(async () => undefined),
	unfollow: vi.fn(async () => undefined),
	listFollowed: vi.fn(async () => [] as FollowedArtist[]),
	setHype: vi.fn(async () => undefined),
	getFollowedArtistMap: vi.fn(async () => new Map()),
}

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

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IGuestService: mockGuest,
				IFollowRpcClient: mockRpcClient,
				IFollowServiceClient: mockDelegate,
				ILocalStorage: mockStorage,
				IEventAggregator: mockEa,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { FollowStore } from './follow-store'

function makeArtist(id: string, name: string): Artist {
	return { id, name } as Artist
}

function makeFollow(id: string, hype: Hype = DEFAULT_HYPE): FollowedArtist {
	return { artist: makeArtist(id, `Artist ${id}`), hype }
}

describe('FollowStore', () => {
	let sut: FollowStore

	beforeEach(() => {
		vi.clearAllMocks()
		subscriptions.clear()
		lsMap.clear()
		mockGuest.follows = []
		mockDelegate.followedArtists = []
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

	describe('GuestMigrationRequested → migrate', () => {
		it('follows each guest artist, drains the batch, and writes the receipt', async () => {
			mockGuest.follows = [makeFollow('a1'), makeFollow('a2')]

			await sut.migrateGuestFollows('user-1')

			expect(mockRpcClient.follow).toHaveBeenCalledTimes(2)
			expect(mockRpcClient.follow).toHaveBeenCalledWith('a1')
			expect(mockRpcClient.follow).toHaveBeenCalledWith('a2')
			// Batched drain emptied the queue.
			expect(mockGuest.follows).toHaveLength(0)
			// Receipt written for the account.
			expect(lsMap.get(guestMergedReceiptKey('user-1'))).toBe('1')
		})

		it('drains the fully-migrated batch with a SINGLE persist (no O(n^2) write storm)', async () => {
			mockGuest.follows = [makeFollow('a1'), makeFollow('a2'), makeFollow('a3')]

			await sut.migrateGuestFollows('user-1')

			// One batched removeFollows call rather than one removeFollow per item.
			expect(mockGuest.removeFollows).toHaveBeenCalledOnce()
			expect(mockGuest.removeFollows).toHaveBeenCalledWith(['a1', 'a2', 'a3'])
			expect(mockGuest.removeFollow).not.toHaveBeenCalled()
		})

		it('migrates non-default hype only for successfully followed artists', async () => {
			mockGuest.follows = [makeFollow('a1', 'away'), makeFollow('a2')]

			await sut.migrateGuestFollows('user-1')

			expect(mockRpcClient.setHype).toHaveBeenCalledOnce()
			expect(mockRpcClient.setHype).toHaveBeenCalledWith('a1', 'away')
		})

		it('leaves only the failed item in the queue and DEFERS the receipt', async () => {
			mockGuest.follows = [makeFollow('a1'), makeFollow('a2')]
			mockRpcClient.follow.mockImplementation(async (id: string) => {
				if (id === 'a2') throw new Error('network')
			})

			await sut.migrateGuestFollows('user-1')

			// a1 drained, a2 failed → remains.
			expect(mockGuest.follows.map((f) => f.artist.id)).toEqual(['a2'])
			// No receipt: the next reconcile must retry the failed item.
			expect(lsMap.has(guestMergedReceiptKey('user-1'))).toBe(false)
		})

		it('does NOT drain an item whose SetHype fails, and DEFERS the receipt', async () => {
			// a1 has a non-default hype; its Follow succeeds but SetHype throws.
			mockGuest.follows = [makeFollow('a1', 'away'), makeFollow('a2')]
			mockRpcClient.setHype.mockImplementation(async (id: string) => {
				if (id === 'a1') throw new Error('hype rpc failed')
			})

			await sut.migrateGuestFollows('user-1')

			// a1 Follow succeeded but its hype did not migrate → keep it for retry
			// so the non-default hype is not lost; a2 (default hype) drains.
			expect(mockGuest.follows.map((f) => f.artist.id)).toEqual(['a1'])
			expect(mockGuest.removeFollows).toHaveBeenCalledWith(['a2'])
			// Receipt deferred so reconcile re-issues SetHype for a1.
			expect(lsMap.has(guestMergedReceiptKey('user-1'))).toBe(false)
		})

		it('writes the receipt even when the guest queue is empty', async () => {
			mockGuest.follows = []

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
			mockGuest.follows = [makeFollow('a1')]
			await sut.migrateGuestFollows('user-1')
			expect(mockRpcClient.follow).toHaveBeenCalledTimes(1)

			// Queue already drained → second pass issues no new Follow calls.
			await sut.migrateGuestFollows('user-1')
			expect(mockRpcClient.follow).toHaveBeenCalledTimes(1)
			expect(lsMap.get(guestMergedReceiptKey('user-1'))).toBe('1')
		})
	})

	describe('SignedOut → self-clear + cache eviction', () => {
		it('clears the guest follow queue and evicts the projection cache via the delegate', () => {
			mockGuest.follows = [makeFollow('a1')]
			mockDelegate.followedArtists = [makeArtist('a1', 'Artist a1')]

			const handler = subscriptions.get(SignedOut)
			handler?.(new SignedOut())

			expect(mockGuest.clearFollows).toHaveBeenCalledOnce()
			// Eviction routes through the delegate's own clear(), not a direct
			// cross-object field write.
			expect(mockDelegate.clear).toHaveBeenCalledOnce()
			expect(mockDelegate.followedArtists).toEqual([])
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

		it('clear() is idempotent and routes eviction through the delegate', () => {
			sut.clear()
			sut.clear()
			expect(mockGuest.clearFollows).toHaveBeenCalledTimes(2)
			expect(mockDelegate.clear).toHaveBeenCalledTimes(2)
			expect(mockDelegate.followedArtists).toEqual([])
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
