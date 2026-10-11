import { Signals } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import type { User } from '../../src/entities/user'
import { IAuthService } from '../../src/services/auth-service'
import { SignedOut } from '../../src/services/events/signed-out'
import { IUserStore, UserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

// Dedicated guest key for the home slice. Kept in sync with guest-storage.ts.
// The anonymous locale is NOT stored here — it lives solely in the i18next
// detector's own 'language' cache (single source of truth).
const GUEST_HOME_KEY = 'guest.home'
// The i18next-browser-languagedetector's own active-locale cache key.
const DETECTOR_LANGUAGE_KEY = 'language'

// Auth-bootstrap fixtures (absorbed from the former UserServiceClient suite).
const externalID = 'ext-abc'
const internalID = 'user-uuid-1'
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
	let signedOutSubscriber: (() => void) | undefined
	const ea = {
		subscribe: vi.fn((channel: unknown, cb: LocaleSubscriber) => {
			if (channel === Signals.I18N_EA_CHANNEL) localeSubscriber = cb
			if (channel === SignedOut) signedOutSubscriber = cb as () => void
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
		// Simulate AuthService publishing SignedOut.
		emitSignedOut(): void {
			signedOutSubscriber?.()
		},
	}
}

// Simple auth stub for the guest/getter tests that only need isAuthenticated.
function makeAuth(isAuthenticated: boolean): IAuthService {
	return { isAuthenticated } as unknown as IAuthService
}

// Auth stub carrying OIDC profile claims (sub/email) for the bootstrap tests
// that exercise the Get → Create recovery.
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

function makeRpcClient() {
	return {
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		setHome: vi.fn(),
		setPreferredLanguage: vi.fn(),
		resendEmailVerification: vi.fn(),
	}
}

// UserStore now OWNS both the guest home slice (hydrating from localStorage on
// construction) AND the authenticated User entity (the Get→Create chain +
// write-through updates, absorbed from the former UserService). Seed the
// dedicated guest home key BEFORE building so the store's @observable field
// picks it up. The anonymous locale has no store-owned key — it is derived from
// the active i18n locale via the reactive `i18nLocale` mirror.
function seedGuest(opts?: { home?: string | null }) {
	if (opts?.home != null) localStorage.setItem(GUEST_HOME_KEY, opts.home)
}

function build(opts: {
	auth: IAuthService
	rpc?: ReturnType<typeof makeRpcClient>
}) {
	const { ea, emitLocaleChange, emitSignedOut } = makeEa()
	const rpc = opts.rpc ?? makeRpcClient()
	const container = createTestContainer(
		Registration.instance(IAuthService, opts.auth),
		Registration.instance(IUserRpcClient, rpc as never),
		Registration.instance(IEventAggregator, ea as never),
	)
	container.register(Registration.singleton(IUserStore, UserStore))
	const store = container.get(IUserStore)
	return { store, emitLocaleChange, emitSignedOut, ea, rpc }
}

const notFound = () => new ConnectError('no user', Code.NotFound)

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
		it('derives from the active i18n locale (single source of truth)', () => {
			const { store } = build({ auth: makeAuth(false) })
			// createTestContainer's mock i18n.getLocale() defaults to 'ja'. The
			// guest locale is the reactive `i18nLocale` mirror — no separate
			// guest.language key shadows it.
			expect(store.currentLanguage).toBe('ja')
		})

		it('exposes no guest-language storage surface', () => {
			const { store } = build({ auth: makeAuth(false) })
			// The redundant `guest.language` plumbing is gone.
			expect('guestLanguage' in store).toBe(false)
			expect('setGuestLanguage' in store).toBe(false)
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
			// user-hydration-task, never the getter (no retry storm).
			store.currentLanguage
			expect(rpc.setPreferredLanguage).not.toHaveBeenCalled()
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

	// Round-trip against the REAL guest-storage key for the home slice, plus the
	// single-source locale contract: the store never writes a `guest.language`
	// key and clearGuest never touches the detector's 'language' cache.
	describe('guest slice — real localStorage round-trip', () => {
		it('persists the guest home via the dedicated key', () => {
			const { store } = build({ auth: makeAuth(false) })

			store.setGuestHome('JP-13')
			// guestHomeChanged() write-through hits the real saveHome.
			expect(localStorage.getItem(GUEST_HOME_KEY)).toBe('JP-13')
			expect(store.currentHome).toBe('JP-13')
		})

		it('clearGuest() clears the guest home but never the detector cache', () => {
			// Seed the detector's own active-locale cache (written by
			// i18next-browser-languagedetector, NOT the store).
			localStorage.setItem(DETECTOR_LANGUAGE_KEY, 'en')

			const { store } = build({ auth: makeAuth(false) })
			store.setGuestHome('JP-13')

			store.clearGuest()
			// guest.home cleared ...
			expect(localStorage.getItem(GUEST_HOME_KEY)).toBeNull()
			// ... but the detector's 'language' cache survives, so a cancelled
			// login does not lose the chosen UI language. The anonymous locale has
			// no store-owned key for clearGuest to touch.
			expect(localStorage.getItem(DETECTOR_LANGUAGE_KEY)).toBe('en')
		})
	})

	// These exercise the auth-bootstrap chain that runs on every authed boot and
	// the signup/signin path: Get for the signed-in caller, the idempotent
	// Create when Get answers NotFound, and the write-through updates. No
	// request names the user (unify-ticket-sales design D15), and nothing is
	// cached in localStorage.

	describe('ensureLoaded', () => {
		it('reads the caller User with Get (no user id) and reports created=false', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			const result = await store.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledWith()
			expect(rpc.create).not.toHaveBeenCalled()
			expect(result).toEqual({ user: stubUser, created: false })
			expect(localStorage.length).toBe(0)
		})

		it('creates the User when Get answers NotFound and reports created=true', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockRejectedValue(notFound())
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			const result = await store.ensureLoaded('ja')

			expect(rpc.create).toHaveBeenCalledWith(userEmail, 'ja', undefined)
			expect(result).toEqual({ user: stubUser, created: true })
		})

		it('returns undefined user (created=false) when there is no User and no email in the JWT claims', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockRejectedValue(notFound())
			const { store } = build({
				auth: makeAuthWithProfile({ email: null }),
				rpc,
			})

			const result = await store.ensureLoaded('ja')

			expect(result).toEqual({ user: undefined, created: false })
			expect(rpc.create).not.toHaveBeenCalled()
		})

		it('returns the in-memory user (created=false) without re-issuing Get on subsequent calls', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			await store.ensureLoaded('ja')
			const second = await store.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledTimes(1)
			expect(second).toEqual({ user: stubUser, created: false })
		})

		it('rethrows any error from Get other than NotFound without creating', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockRejectedValue(new ConnectError('down', Code.Unavailable))
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			await expect(store.ensureLoaded('ja')).rejects.toThrow(/down/)
			expect(rpc.create).not.toHaveBeenCalled()
		})
	})

	describe('create', () => {
		it('creates a new User with the guest home and reports created=true', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockRejectedValue(notFound())
			rpc.create.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })
			const home = { countryCode: 'JP', level1: 'JP-13' }

			const result = await store.create('u@test.com', 'ja', home)

			expect(rpc.create).toHaveBeenCalledWith('u@test.com', 'ja', home)
			expect(result).toEqual({ user: stubUser, created: true })
		})

		it('returns an existing User as stored and reports created=false (returning identity tapping Sign up)', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			const result = await store.create('u@test.com', 'ja', {
				countryCode: 'JP',
				level1: 'JP-13',
			})

			expect(rpc.create).not.toHaveBeenCalled()
			expect(result).toEqual({ user: stubUser, created: false })
		})
	})

	describe('updateHome', () => {
		it('calls SetHome with the home only and replaces current', async () => {
			const rpc = makeRpcClient()
			const updated = {
				...stubUser,
				home: { countryCode: 'JP', level1: 'JP-13' },
			}
			rpc.setHome.mockResolvedValue(updated)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			await store.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.setHome).toHaveBeenCalledWith({
				countryCode: 'JP',
				level1: 'JP-13',
			})
			expect(store.current).toBe(updated)
		})

		it('patches current.home locally when the RPC returns an empty payload', async () => {
			// The settings UI reads userStore.current.home immediately after the
			// RPC resolves. If the backend omits the user field (valid proto3
			// default), wiping current with undefined would clear the rest of the
			// session's profile. The write-through patch must preserve everything
			// except home.
			const rpc = makeRpcClient()
			rpc.get.mockResolvedValue(stubUser)
			rpc.setHome.mockResolvedValue(undefined)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })
			await store.ensureLoaded('ja')

			const result = await store.updateHome({
				countryCode: 'JP',
				level1: 'JP-13',
			})

			expect(result?.home?.level1).toBe('JP-13')
			expect(result?.home?.countryCode).toBe('JP')
			expect(store.current?.id).toBe(internalID)
		})
	})

	describe('updatePreferredLanguage', () => {
		it('replaces current with the populated User the RPC returns', async () => {
			const rpc = makeRpcClient()
			const updated = { ...stubUser, preferredLanguage: 'en' } as User
			rpc.setPreferredLanguage.mockResolvedValue(updated)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })
			await store.ensureLoaded('ja')

			const result = await store.updatePreferredLanguage('en')

			expect(rpc.setPreferredLanguage).toHaveBeenCalledWith('en')
			expect(result).toBe(updated)
			expect(store.current).toBe(updated)
		})

		it('patches current.preferredLanguage locally when the RPC returns an empty payload', async () => {
			const rpc = makeRpcClient()
			rpc.setPreferredLanguage.mockResolvedValue(undefined)
			rpc.get.mockResolvedValue(stubUser)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })
			await store.ensureLoaded('ja')
			expect(store.current?.preferredLanguage).toBeUndefined()

			const result = await store.updatePreferredLanguage('en')

			expect(result?.preferredLanguage).toBe('en')
			expect(store.current?.preferredLanguage).toBe('en')
			expect(store.current?.id).toBe(internalID)
		})
	})

	describe('updatePersonalDetails', () => {
		it('calls Update with the given fields and replaces current', async () => {
			const rpc = makeRpcClient()
			const updated = { ...stubUser, phoneNumber: '+819098765432' }
			rpc.update.mockResolvedValue(updated)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			const result = await store.updatePersonalDetails({
				phoneNumber: '+819098765432',
			})

			expect(rpc.update).toHaveBeenCalledWith({ phoneNumber: '+819098765432' })
			expect(result).toBe(updated)
			expect(store.current).toBe(updated)
		})
	})

	describe('resendEmailVerification', () => {
		it('forwards to the RPC client without a user id', async () => {
			const rpc = makeRpcClient()
			rpc.resendEmailVerification.mockResolvedValue(undefined)
			const { store } = build({ auth: makeAuthWithProfile(), rpc })

			await store.resendEmailVerification()

			expect(rpc.resendEmailVerification).toHaveBeenCalledWith()
		})
	})

	describe('sign-out', () => {
		it('forgets the in-memory User on SignedOut', async () => {
			const rpc = makeRpcClient()
			rpc.get.mockResolvedValue(stubUser)
			const { store, emitSignedOut } = build({
				auth: makeAuthWithProfile(),
				rpc,
			})
			await store.ensureLoaded('ja')
			expect(store.current).toBe(stubUser)

			emitSignedOut()

			expect(store.current).toBeUndefined()
		})
	})
})
