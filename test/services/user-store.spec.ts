import { Signals } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import type { User } from '../../src/entities/user'
import { IAuthService } from '../../src/services/auth-service'
import { IUserStore, UserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

// Dedicated guest keys (decoupled from the i18next detector's 'language'
// cache). Kept in sync with guest-storage.ts.
const GUEST_HOME_KEY = 'guest.home'
const GUEST_LANGUAGE_KEY = 'guest.language'
// The i18next-browser-languagedetector's own active-locale cache key.
const DETECTOR_LANGUAGE_KEY = 'language'

// Auth-bootstrap fixtures (absorbed from the former UserServiceClient suite).
const externalID = 'ext-abc'
const internalID = 'user-uuid-1'
const cacheKey = `liverty:userId:${externalID}`
const userEmail = 'u@test.com'

const stubUser: User = {
	id: internalID,
	externalId: externalID,
	email: userEmail,
	name: 'U',
} as User

type LocaleSubscriber = (payload: {
	oldLocale: string
	newLocale: string
}) => void

function makeEa() {
	let localeSubscriber: LocaleSubscriber | undefined
	const ea = {
		subscribe: vi.fn((channel: string, cb: LocaleSubscriber) => {
			if (channel === Signals.I18N_EA_CHANNEL) localeSubscriber = cb
			return { dispose: vi.fn() }
		}),
		publish: vi.fn(),
	}
	return {
		ea,
		// Simulate i18n publishing a locale change on its EA channel.
		emitLocaleChange(newLocale: string): void {
			localeSubscriber?.({ oldLocale: 'ja', newLocale })
		},
	}
}

// Simple auth stub for the guest/getter tests that only need isAuthenticated.
function makeAuth(isAuthenticated: boolean): IAuthService {
	return { isAuthenticated } as unknown as IAuthService
}

// Auth stub carrying OIDC profile claims (sub/email) for the bootstrap tests
// that exercise the per-external_id user_id cache and Create recovery.
function makeAuthWithProfile(opts?: { email?: string | null }) {
	const profile: { sub: string; email?: string } = { sub: externalID }
	if (opts?.email !== null) {
		profile.email = opts?.email ?? userEmail
	}
	return createMockAuth({
		isAuthenticated: true,
		user: { profile } as never,
	})
}

function makeStorage() {
	const map = new Map<string, string>()
	return {
		map,
		impl: {
			getItem: vi.fn((k: string) => map.get(k) ?? null),
			setItem: vi.fn((k: string, v: string) => {
				map.set(k, v)
			}),
			removeItem: vi.fn((k: string) => {
				map.delete(k)
			}),
		},
	}
}

function makeRpcClient() {
	return {
		get: vi.fn(),
		create: vi.fn(),
		updateHome: vi.fn(),
		updatePreferredLanguage: vi.fn(),
		resendEmailVerification: vi.fn(),
	}
}

// UserStore now OWNS both the guest home/language slice (hydrating from
// localStorage on construction) AND the authenticated User entity (the
// cache→Get→Create chain + write-through updates, absorbed from the former
// UserService). Seed the dedicated guest keys BEFORE building so the store's
// @observable fields pick them up.
function seedGuest(opts?: { home?: string | null; language?: string | null }) {
	if (opts?.home != null) localStorage.setItem(GUEST_HOME_KEY, opts.home)
	if (opts?.language != null)
		localStorage.setItem(GUEST_LANGUAGE_KEY, opts.language)
}

function build(opts: {
	auth: IAuthService
	rpc?: ReturnType<typeof makeRpcClient>
	storage?: ReturnType<typeof makeStorage>
}) {
	const { ea, emitLocaleChange } = makeEa()
	const rpc = opts.rpc ?? makeRpcClient()
	const storage = opts.storage ?? makeStorage()
	const container = createTestContainer(
		Registration.instance(IAuthService, opts.auth),
		Registration.instance(IUserRpcClient, rpc as never),
		Registration.instance(ILocalStorage, storage.impl as never),
		Registration.instance(IEventAggregator, ea as never),
	)
	container.register(Registration.singleton(IUserStore, UserStore))
	const store = container.get(IUserStore)
	return { store, emitLocaleChange, ea, rpc, storage }
}

describe('UserStore', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		sessionStorage.clear()
		localStorage.clear()
	})

	describe('currentLanguage — guest', () => {
		it('falls back to the active i18n locale when the guest made no explicit choice', () => {
			const { store } = build({ auth: makeAuth(false) })
			// createTestContainer's mock i18n.getLocale() defaults to 'ja'.
			expect(store.currentLanguage).toBe('ja')
		})

		it('reflects an explicit guest language choice from the observable source', () => {
			seedGuest({ language: 'en' })
			const { store } = build({ auth: makeAuth(false) })
			expect(store.currentLanguage).toBe('en')
		})

		it('updates reactively when the guest language changes', () => {
			const { store } = build({ auth: makeAuth(false) })
			expect(store.currentLanguage).toBe('ja')

			// Mutating the @observable guest source re-resolves the getter with
			// no manual mirror. The store owns the setter now.
			store.setGuestLanguage('en')
			expect(store.currentLanguage).toBe('en')
		})
	})

	describe('currentLanguage — authenticated', () => {
		it('reads preferredLanguage from current', () => {
			const { store } = build({ auth: makeAuth(true) })
			store.current = { id: 'u', preferredLanguage: 'en' } as User
			expect(store.currentLanguage).toBe('en')
		})

		it('normalizes a non-supported backend tag to a supported code', () => {
			const { store } = build({ auth: makeAuth(true) })
			store.current = { id: 'u', preferredLanguage: 'en-US' } as User
			// 'en-US' is not in SUPPORTED_LANGUAGES; normalize so the selector
			// still highlights the 'en' option.
			expect(store.currentLanguage).toBe('en')
		})

		it('falls back to the i18n mirror and does NOT backfill when preferredLanguage is NULL', () => {
			const { store, rpc } = build({ auth: makeAuth(true) })
			store.current = { id: 'u' } as User // no preferredLanguage

			// Surfaces the active locale ('ja' from the mock i18n) ...
			expect(store.currentLanguage).toBe('ja')
			// ... and is a PURE projection: the backfill RPC is owned by
			// user-hydration-task, never the getter (no retry storm, no
			// requireUserId throw before a user is loaded).
			store.currentLanguage
			expect(rpc.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('currentLanguage — reactive i18n mirror', () => {
		it('re-resolves the guest fallback when the i18n locale changes', () => {
			const { store, emitLocaleChange } = build({ auth: makeAuth(false) })
			expect(store.currentLanguage).toBe('ja')

			// Guest never set an explicit language, so the store tracks the
			// active locale via the observable i18n mirror (not a render-time
			// getLocale() read).
			emitLocaleChange('en')
			expect(store.currentLanguage).toBe('en')
		})
	})

	describe('currentHome', () => {
		it('reads from the authenticated user entity', () => {
			const { store } = build({ auth: makeAuth(true) })
			store.current = { id: 'u', home: { level1: 'JP-13' } } as User
			expect(store.currentHome).toBe('JP-13')
		})

		it('reads from the observable guest source for a guest', () => {
			seedGuest({ home: 'JP-27' })
			const { store } = build({ auth: makeAuth(false) })
			expect(store.currentHome).toBe('JP-27')
		})

		it('reflects a guest home change via setGuestHome', () => {
			const { store } = build({ auth: makeAuth(false) })
			expect(store.currentHome).toBeNull()

			store.setGuestHome('JP-13')
			expect(store.currentHome).toBe('JP-13')
			// Persisted through the guestHomeChanged write-through.
			expect(localStorage.getItem(GUEST_HOME_KEY)).toBe('JP-13')
		})
	})

	// Round-trip against the REAL guest-storage keys, exercising the dedicated
	// 'guest.home' / 'guest.language' keys (decoupled from the i18next detector's
	// 'language' cache).
	describe('guest slice — real localStorage round-trip', () => {
		it('falls back to the i18n mirror when no explicit choice was stored', () => {
			// No 'guest.language' key written → loadLanguage() returns null.
			const { store } = build({ auth: makeAuth(false) })
			expect(store.guestLanguage).toBeNull()
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBeNull()
			expect(store.currentLanguage).toBe('ja')
		})

		it('persists and reflects an explicit guest choice via the dedicated key', () => {
			const { store } = build({ auth: makeAuth(false) })

			store.setGuestLanguage('ja')
			// guestLanguageChanged() write-through hits the real saveLanguage.
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('ja')

			store.setGuestLanguage('en')
			expect(store.guestLanguage).toBe('en')
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('en')
			expect(store.currentLanguage).toBe('en')
		})

		it('clearGuest() removes only the guest keys, never the detector cache', () => {
			// Seed the detector's own active-locale cache (written by
			// i18next-browser-languagedetector, NOT the store).
			localStorage.setItem(DETECTOR_LANGUAGE_KEY, 'en')

			const { store } = build({ auth: makeAuth(false) })
			store.setGuestHome('JP-13')
			store.setGuestLanguage('en')
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('en')

			store.clearGuest()
			// guest.language + guest.home cleared (their dedicated keys removed) ...
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBeNull()
			expect(localStorage.getItem(GUEST_HOME_KEY)).toBeNull()
			// ... but the detector's 'language' cache survives, so a cancelled
			// login does not lose the chosen UI language.
			expect(localStorage.getItem(DETECTOR_LANGUAGE_KEY)).toBe('en')
		})
	})

	// ── Authenticated User-entity bootstrap (absorbed from UserServiceClient) ──
	//
	// These exercise the auth-bootstrap chain that runs on every authed boot and
	// the signup/signin path: the in-memory + localStorage user_id cache, the
	// cache→Get→Create recovery, PermissionDenied self-heal, and the
	// write-through update patterns. Behavior is MOVED verbatim from the former
	// UserService — keep these assertions identical when refactoring the chain.

	describe('ensureLoaded', () => {
		it('falls back to idempotent Create when no user_id is cached and reports created=true', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			const result = await store.ensureLoaded('ja')

			expect(rpc.get).not.toHaveBeenCalled()
			expect(rpc.create).toHaveBeenCalledWith(userEmail, 'ja')
			expect(result.user).toBe(stubUser)
			// No cached user_id → reached Create on the new-account path.
			expect(result.created).toBe(true)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('returns undefined user (created=false) when no cache AND no email in JWT claims', async () => {
			const rpc = makeRpcClient()
			const { store } = build({
				auth: makeAuthWithProfile({ email: null }),
				rpc,
			})

			const result = await store.ensureLoaded('ja')

			expect(result.user).toBeUndefined()
			expect(result.created).toBe(false)
			expect(rpc.get).not.toHaveBeenCalled()
			expect(rpc.create).not.toHaveBeenCalled()
		})

		it('calls Get with cached user_id, writes back to cache, and reports created=false', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			const result = await store.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledWith(internalID)
			expect(rpc.create).not.toHaveBeenCalled()
			expect(result.user).toBe(stubUser)
			// Cache hit → returning account, not new.
			expect(result.created).toBe(false)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('returns the in-memory cached user (created=false) without re-issuing Get on subsequent calls', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await store.ensureLoaded('ja')
			const second = await store.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledTimes(1)
			expect(second.user).toBe(stubUser)
			expect(second.created).toBe(false)
		})

		it('self-heals when cached user_id is rejected with PermissionDenied — clears cache and recovers via Create', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, 'stale-uuid')
			rpc.get.mockRejectedValue(
				new ConnectError('user_id mismatch', Code.PermissionDenied),
			)
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			const result = await store.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledWith('stale-uuid')
			expect(storage.impl.removeItem).toHaveBeenCalledWith(cacheKey)
			expect(rpc.create).toHaveBeenCalledWith(userEmail, 'ja')
			expect(result.user).toBe(stubUser)
			// New userId should be cached after Create succeeds
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('rethrows non-PermissionDenied errors from Get without clearing cache', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.get.mockRejectedValue(new ConnectError('not found', Code.NotFound))
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await expect(store.ensureLoaded('ja')).rejects.toThrow(/not found/)
			expect(storage.impl.removeItem).not.toHaveBeenCalled()
			expect(rpc.create).not.toHaveBeenCalled()
		})
	})

	describe('create', () => {
		it('writes the returned user_id to localStorage and reports created=true for a fresh-cache identity', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			const result = await store.create('u@test.com', 'ja')

			expect(result.user).toBe(stubUser)
			// No cached user_id before the call → genuinely new account.
			expect(result.created).toBe(true)
			expect(rpc.create).toHaveBeenCalledWith('u@test.com', 'ja', undefined)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('reports created=false when a user_id is already cached (returning identity tapping Sign up)', async () => {
			// A returning user already has a cached user_id; the idempotent backend
			// returns their existing row, so this is NOT a new account.
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			const result = await store.create('u@test.com', 'ja')

			expect(result.user).toBe(stubUser)
			expect(result.created).toBe(false)
		})
	})

	describe('updateHome', () => {
		it('reads cached user_id, calls RPC, and writes back', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.updateHome.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await store.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.updateHome).toHaveBeenCalledWith(internalID, {
				countryCode: 'JP',
				level1: 'JP-13',
			})
		})

		it('throws when no user_id is cached and no in-memory current exists', async () => {
			const { store } = build({ auth: makeAuthWithProfile() })

			await expect(
				store.updateHome({ countryCode: 'JP', level1: 'JP-13' }),
			).rejects.toThrow(/user_id is not available/)
		})

		it('uses in-memory user_id when cache is missing but a previous Create has run', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			rpc.create.mockResolvedValue(stubUser)
			rpc.updateHome.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await store.create('u@test.com', 'ja')
			storage.map.delete(cacheKey)

			await store.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.updateHome).toHaveBeenCalledWith(internalID, {
				countryCode: 'JP',
				level1: 'JP-13',
			})
		})

		it('patches current.home locally when the RPC returns an empty payload', async () => {
			// Mirrors the updatePreferredLanguage empty-payload test: the
			// settings UI reads userStore.current.home immediately after the RPC
			// resolves. If the backend omits the user field (valid proto3
			// default), wiping current with undefined would clear the rest of the
			// session's profile (id, preferredLanguage) and break requireUserId
			// guards on subsequent calls. The write-through patch must preserve
			// everything except home.
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			rpc.updateHome.mockResolvedValue(undefined)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })
			await store.ensureLoaded('ja')

			const result = await store.updateHome({
				countryCode: 'JP',
				level1: 'JP-13',
			})

			expect(result?.home?.level1).toBe('JP-13')
			expect(result?.home?.countryCode).toBe('JP')
			// Other fields preserved (didn't wipe current).
			expect(store.current?.id).toBe(internalID)
		})
	})

	describe('updatePreferredLanguage', () => {
		it('replaces current with the populated User the RPC returns', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			const updated = { ...stubUser, preferredLanguage: 'en' } as User
			rpc.updatePreferredLanguage.mockResolvedValue(updated)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })
			// Hydrate current first so we have something to compare against.
			await store.ensureLoaded('ja')

			const result = await store.updatePreferredLanguage('en')

			expect(rpc.updatePreferredLanguage).toHaveBeenCalledWith(internalID, 'en')
			expect(result).toBe(updated)
			expect(store.current).toBe(updated)
			expect(store.current?.preferredLanguage).toBe('en')
		})

		it('patches current.preferredLanguage locally when the RPC returns an empty payload', async () => {
			// Load-bearing path: the settings UI reads
			// `userStore.current.preferredLanguage` immediately after the RPC
			// resolves. If the backend omits the user field (valid proto3
			// default), we must still surface the just-sent value from the
			// in-memory cache rather than leave the stale one.
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.updatePreferredLanguage.mockResolvedValue(undefined)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })
			await store.ensureLoaded('ja')
			const before = store.current
			expect(before?.preferredLanguage).toBeUndefined()

			const result = await store.updatePreferredLanguage('en')

			expect(rpc.updatePreferredLanguage).toHaveBeenCalledWith(internalID, 'en')
			expect(result?.preferredLanguage).toBe('en')
			expect(store.current?.preferredLanguage).toBe('en')
			// Other fields preserved (didn't wipe current).
			expect(store.current?.id).toBe(internalID)
		})

		it('throws when no user_id is available', async () => {
			const { store } = build({ auth: makeAuthWithProfile() })

			await expect(store.updatePreferredLanguage('en')).rejects.toThrow(
				/user_id is not available/,
			)
		})
	})

	describe('resendEmailVerification', () => {
		it('reads cached user_id and forwards it to the RPC client', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.resendEmailVerification.mockResolvedValue(undefined)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await store.resendEmailVerification()

			expect(rpc.resendEmailVerification).toHaveBeenCalledWith(internalID)
		})

		it('throws when no user_id is available', async () => {
			const { store } = build({ auth: makeAuthWithProfile() })

			await expect(store.resendEmailVerification()).rejects.toThrow(
				/user_id is not available/,
			)
		})
	})

	describe('clear', () => {
		it('removes the cached user_id and forgets the in-memory current', async () => {
			const rpc = makeRpcClient()
			const storage = makeStorage()
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc, storage })

			await store.ensureLoaded('ja')
			expect(store.current).toBe(stubUser)

			store.clear()

			expect(store.current).toBeUndefined()
			expect(storage.impl.removeItem).toHaveBeenCalledWith(cacheKey)
		})
	})
})
