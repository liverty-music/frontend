import type { IContainer } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ILocalStorage } from '../adapter/storage/local-storage'
import { SessionKeys, StorageKeys } from '../constants/storage-keys'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

interface MockUser {
	id: string
	preferredLanguage?: string
}

const mockAuth: {
	ready: Promise<void>
	isAuthenticated: boolean
} = { ready: Promise.resolve(), isAuthenticated: true }
const mockUserService = {
	current: undefined as MockUser | undefined,
	ensureLoaded: vi.fn(async () => mockUserService.current),
	updatePreferredLanguage: vi.fn(async (lang: string) => {
		mockUserService.current = {
			id: 'user-1',
			preferredLanguage: lang,
		}
		return mockUserService.current
	}),
}
const i18nState = { locale: 'en' }
const mockI18n = {
	getLocale: vi.fn(() => i18nState.locale),
	setLocale: vi.fn(async (lang: string) => {
		i18nState.locale = lang
	}),
}

// In-memory ILocalStorage stub. Independent of the global `localStorage`
// (which the project's prod code does NOT touch in these hydration paths
// after this refactor — it goes through the ILocalStorage adapter).
const lsMap = new Map<string, string>()
const mockLocalStorage: ILocalStorage = {
	getItem: vi.fn((k: string) => lsMap.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => {
		lsMap.set(k, v)
	}),
	removeItem: vi.fn((k: string) => {
		lsMap.delete(k)
	}),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		ILogger: { friendlyName: 'ILogger' },
		IContainer: { friendlyName: 'IContainer' },
		AppTask: {
			activating: (_key: unknown, fn: unknown) => fn,
		},
	}
})

vi.mock('@aurelia/i18n', () => ({
	I18N: { friendlyName: 'I18N' },
}))

vi.mock('../adapter/storage/local-storage', () => ({
	ILocalStorage: { friendlyName: 'ILocalStorage' },
}))

// Stub the auth/user service tokens used by runUserHydration.
vi.mock('./auth-service', () => ({
	IAuthService: { friendlyName: 'IAuthService' },
}))
vi.mock('./user-service', () => ({
	IUserService: { friendlyName: 'IUserService' },
}))

import { runUserHydration } from './user-hydration-task'

// Container stub: routes container.get(token) to our mocks via friendlyName.
function makeContainer(): IContainer {
	return {
		get: (token: unknown) => {
			const fn = (token as { friendlyName?: string }).friendlyName
			switch (fn) {
				case 'IAuthService':
					return mockAuth
				case 'IUserService':
					return mockUserService
				case 'ILogger':
					return mockLogger
				case 'I18N':
					return mockI18n
				case 'ILocalStorage':
					return mockLocalStorage
				default:
					throw new Error(`unmocked token: ${fn ?? String(token)}`)
			}
		},
	} as unknown as IContainer
}

// Flush microtasks so the fire-and-forget backfill promise has a chance to
// resolve before assertions run.
async function flushMicrotasks(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('runUserHydration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockUserService.current = undefined
		i18nState.locale = 'en'
		lsMap.clear()
		lsMap.set(StorageKeys.language, 'en')
		// Reset the per-tab backfill flag so tests start from a clean state.
		sessionStorage.removeItem(SessionKeys.languageBackfillAttempted)
	})

	it('skips hydration when the user is not authenticated', async () => {
		mockAuth.isAuthenticated = false

		await runUserHydration(makeContainer())

		expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()
		// localStorage stays untouched for anonymous users.
		expect(lsMap.get(StorageKeys.language)).toBe('en')
	})

	it('applies preferred_language to i18n when present and differs from clientLocale', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'ja' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})
		// clientLocale = 'en' (from beforeEach), preferred = 'ja' → setLocale runs.

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(mockI18n.setLocale).toHaveBeenCalledWith('ja')
		expect(mockUserService.updatePreferredLanguage).not.toHaveBeenCalled()
		expect(lsMap.get(StorageKeys.language)).toBeUndefined()
	})

	it('skips setLocale when preferred_language equals clientLocale', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'en' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		// Steady state: no churn from a redundant setLocale.
		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		expect(lsMap.get(StorageKeys.language)).toBeUndefined()
	})

	it('skips setLocale and warns on unsupported preferred_language', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'fr' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		// Cleanup still runs.
		expect(lsMap.get(StorageKeys.language)).toBeUndefined()
	})

	it('backfills preferred_language fire-and-forget when absent in hydrated profile', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})
		i18nState.locale = 'ja'

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(mockUserService.updatePreferredLanguage).toHaveBeenCalledWith('ja')
		// No setLocale because clientLocale is already the effective value.
		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		expect(lsMap.get(StorageKeys.language)).toBeUndefined()
		// Flag set optimistically before the awaited promise resolves.
		expect(sessionStorage.getItem(SessionKeys.languageBackfillAttempted)).toBe(
			'1',
		)
	})

	it('preserves localStorage and clears the session flag when backfill RPC fails so next session retries', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})
		mockUserService.updatePreferredLanguage.mockRejectedValueOnce(
			new Error('network'),
		)

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		// Backfill failed → KEEP localStorage['language'] so the next
		// session can re-detect the user's explicit anonymous choice and
		// retry the backfill. Removing it on failure would lose the
		// user's preference if both DB and localStorage are now empty.
		expect(lsMap.get(StorageKeys.language)).toBe('en')
		// Optimistic flag was rolled back on failure.
		expect(
			sessionStorage.getItem(SessionKeys.languageBackfillAttempted),
		).toBeNull()
	})

	it('removes localStorage["language"] after hydration even when language was already set', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'ja' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(lsMap.get(StorageKeys.language)).toBeUndefined()
	})

	it('does NOT re-fire backfill on a second call when the session flag is set', async () => {
		// First call: row has no preferred_language → backfill runs, flag set.
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockResolvedValue(mockUserService.current)
		i18nState.locale = 'ja'

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(mockUserService.updatePreferredLanguage).toHaveBeenCalledTimes(1)
		expect(sessionStorage.getItem(SessionKeys.languageBackfillAttempted)).toBe(
			'1',
		)

		// Second call in the same tab: even though the DB column is still NULL
		// (we simulate a stuck row), the flag prevents another write.
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockResolvedValue(mockUserService.current)

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		// Still 1 — second backfill blocked by the session flag.
		expect(mockUserService.updatePreferredLanguage).toHaveBeenCalledTimes(1)
	})

	it('does NOT call ensureLoaded until auth.ready resolves (deferred-ready ordering invariant)', async () => {
		// Lock in the contract that runUserHydration awaits auth.ready
		// before touching the user service. If a refactor accidentally
		// drops the await or reorders the isAuthenticated check above it,
		// hydration would race the auth bootstrap and either fire RPCs
		// without a valid token or skip hydration on cold boots.
		mockUserService.current = { id: 'user-1', preferredLanguage: 'ja' }
		mockUserService.ensureLoaded.mockResolvedValue(mockUserService.current)

		// Replace auth.ready with a deferred promise we control.
		let resolveReady!: () => void
		mockAuth.ready = new Promise<void>((resolve) => {
			resolveReady = resolve
		})

		const inFlight = runUserHydration(makeContainer())
		await flushMicrotasks()

		// auth.ready is still pending → ensureLoaded must not have run.
		expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()

		// Release auth.ready → hydration proceeds.
		resolveReady()
		await inFlight
		await flushMicrotasks()

		expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
	})

	it('skips post-hydration steps when ensureLoaded throws', async () => {
		mockUserService.ensureLoaded.mockRejectedValueOnce(new Error('boom'))

		await runUserHydration(makeContainer())
		await flushMicrotasks()

		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		expect(mockUserService.updatePreferredLanguage).not.toHaveBeenCalled()
		// localStorage cleanup is gated on a successful hydration; the legacy
		// key stays in place so the next boot can re-attempt.
		expect(lsMap.get(StorageKeys.language)).toBe('en')
	})
})
