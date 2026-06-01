import type { IContainer } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionKeys } from '../constants/storage-keys'
import type { Artist } from '../entities/artist'
import { DEFAULT_HYPE, type FollowedArtist } from '../entities/follow'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockAuth: { ready: Promise<void>; isAuthenticated: boolean } = {
	ready: Promise.resolve(),
	isAuthenticated: true,
}

// ensureLoaded is the idempotent hydration call the reconcile awaits itself so
// it does NOT depend on UserHydrationTask ordering. By default it resolves a
// user into `current` (simulating the Get/Create chain); individual tests
// override it to model a not-yet-hydrated or failing hydration.
const mockUserService = {
	current: undefined as { id: string } | undefined,
	ensureLoaded: vi.fn(async (_locale: string) => {
		mockUserService.current ??= { id: 'user-1' }
		return mockUserService.current
	}),
}

const mockI18n = {
	getLocale: vi.fn(() => 'en'),
}

// The guest follow queue is owned by FollowStore (via its FollowServiceClient
// delegate) now that GuestService is dissolved; the reconcile task reads it
// through `followStore.guestFollows` and drains via `clearGuestFollows`.
const mockFollowStore = {
	guestFollowsState: [] as FollowedArtist[],
	get guestFollows(): readonly FollowedArtist[] {
		return mockFollowStore.guestFollowsState
	},
	clearGuestFollows: vi.fn(() => {
		mockFollowStore.guestFollowsState.splice(0)
	}),
	hasReceipt: vi.fn(() => false),
	migrateGuestFollows: vi.fn(async () => undefined),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		ILogger: { friendlyName: 'ILogger' },
		IContainer: { friendlyName: 'IContainer' },
		AppTask: { activating: (_key: unknown, fn: unknown) => fn },
	}
})

vi.mock('@aurelia/i18n', () => ({
	I18N: { friendlyName: 'I18N' },
}))

vi.mock('../util/change-locale', () => ({
	// Identity-ish normalize: the reconcile only needs SOME effective locale
	// string to pass to ensureLoaded; the exact value is irrelevant here.
	normalizeToSupportedLanguage: (l: string) => l,
}))

vi.mock('./auth-service', () => ({
	IAuthService: { friendlyName: 'IAuthService' },
}))
vi.mock('./user-service', () => ({
	IUserService: { friendlyName: 'IUserService' },
}))
vi.mock('./follow-store', () => ({
	IFollowStore: { friendlyName: 'IFollowStore' },
}))

import { runFollowReconcile } from './follow-reconcile-task'

const container = {
	get: vi.fn((token: { friendlyName?: string }) => {
		const map: Record<string, unknown> = {
			ILogger: mockLogger,
			IAuthService: mockAuth,
			IUserService: mockUserService,
			IFollowStore: mockFollowStore,
			I18N: mockI18n,
		}
		return map[token.friendlyName ?? '']
	}),
} as unknown as IContainer

function makeFollow(id: string): FollowedArtist {
	return { artist: { id, name: `Artist ${id}` } as Artist, hype: DEFAULT_HYPE }
}

describe('runFollowReconcile', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		sessionStorage.clear()
		mockAuth.isAuthenticated = true
		mockUserService.current = { id: 'user-1' }
		// Default ensureLoaded: idempotent hydration that ensures `current`.
		mockUserService.ensureLoaded.mockImplementation(async () => {
			mockUserService.current ??= { id: 'user-1' }
			return mockUserService.current
		})
		mockFollowStore.guestFollowsState = []
		mockFollowStore.hasReceipt.mockReturnValue(false)
		// hasReceipt becomes true after a successful migrate (write-through).
		mockFollowStore.migrateGuestFollows.mockImplementation(async () => {
			mockFollowStore.hasReceipt.mockReturnValue(true)
		})
	})

	it('skips when unauthenticated', async () => {
		mockAuth.isAuthenticated = false
		mockFollowStore.guestFollowsState = [makeFollow('a1')]

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).not.toHaveBeenCalled()
	})

	it('no-ops when the guest queue is empty', async () => {
		mockFollowStore.guestFollowsState = []

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).not.toHaveBeenCalled()
		expect(mockFollowStore.clearGuestFollows).not.toHaveBeenCalled()
	})

	it('migrates then clears when there is no receipt and a leftover queue', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).toHaveBeenCalledWith('user-1')
		expect(mockFollowStore.clearGuestFollows).toHaveBeenCalledOnce()
	})

	it('clears WITHOUT migrating when the receipt already exists (no resurrection)', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]
		mockFollowStore.hasReceipt.mockReturnValue(true)

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).not.toHaveBeenCalled()
		expect(mockFollowStore.clearGuestFollows).toHaveBeenCalledOnce()
	})

	it('is session-guarded: a second run in the same tab is a no-op', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]

		await runFollowReconcile(container)
		expect(mockFollowStore.migrateGuestFollows).toHaveBeenCalledOnce()

		// Re-arm a queue; the session flag must short-circuit the second run.
		mockFollowStore.guestFollowsState = [makeFollow('a2')]
		await runFollowReconcile(container)
		expect(mockFollowStore.migrateGuestFollows).toHaveBeenCalledOnce()
	})

	it('self-hydrates via ensureLoaded (does NOT rely on UserHydrationTask ordering)', async () => {
		// `current` starts undefined — simulating the race where UserHydrationTask
		// has not populated it yet. The reconcile must call ensureLoaded itself.
		mockUserService.current = undefined
		mockFollowStore.guestFollowsState = [makeFollow('a1')]
		mockUserService.ensureLoaded.mockImplementation(async () => {
			mockUserService.current = { id: 'user-1' }
			return mockUserService.current
		})

		await runFollowReconcile(container)

		expect(mockUserService.ensureLoaded).toHaveBeenCalledOnce()
		// Migration ran because ensureLoaded produced a user id without depending
		// on the hydration task running first.
		expect(mockFollowStore.migrateGuestFollows).toHaveBeenCalledWith('user-1')
		expect(mockFollowStore.clearGuestFollows).toHaveBeenCalledOnce()
	})

	it('defers (re-arms the session flag) when no user id is available even after ensureLoaded', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]
		mockUserService.current = undefined
		// ensureLoaded cannot bootstrap a user (e.g. no cached id and no email).
		mockUserService.ensureLoaded.mockResolvedValue(undefined)

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).not.toHaveBeenCalled()
		// Flag cleared so the next start retries once a user id exists.
		expect(
			sessionStorage.getItem(SessionKeys.followReconcileAttempted),
		).toBeNull()
	})

	it('re-arms the session flag when ensureLoaded throws', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]
		mockUserService.current = undefined
		mockUserService.ensureLoaded.mockRejectedValue(new Error('rpc down'))

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).not.toHaveBeenCalled()
		expect(
			sessionStorage.getItem(SessionKeys.followReconcileAttempted),
		).toBeNull()
	})

	it('does NOT clear when migration left failed items (no receipt written)', async () => {
		mockFollowStore.guestFollowsState = [makeFollow('a1')]
		// Simulate a partial failure: migrate runs but does not write the receipt.
		mockFollowStore.migrateGuestFollows.mockImplementation(async () => {
			mockFollowStore.hasReceipt.mockReturnValue(false)
		})

		await runFollowReconcile(container)

		expect(mockFollowStore.migrateGuestFollows).toHaveBeenCalledOnce()
		expect(mockFollowStore.clearGuestFollows).not.toHaveBeenCalled()
	})
})
