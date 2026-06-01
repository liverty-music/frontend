import { Signals } from '@aurelia/i18n'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IAuthService } from '../../src/services/auth-service'
import { IUserService } from '../../src/services/user-service'
import { IUserStore, UserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'

// Dedicated guest keys (decoupled from the i18next detector's 'language'
// cache). Kept in sync with guest-storage.ts.
const GUEST_HOME_KEY = 'guest.home'
const GUEST_LANGUAGE_KEY = 'guest.language'
// The i18next-browser-languagedetector's own active-locale cache key.
const DETECTOR_LANGUAGE_KEY = 'language'

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

function makeAuth(isAuthenticated: boolean): IAuthService {
	return { isAuthenticated } as unknown as IAuthService
}

function makeUserService(behavior?: {
	current?: {
		id: string
		home?: { level1: string }
		preferredLanguage?: string
	}
	updatePreferredLanguage?: (lang: string) => Promise<unknown>
	updateHome?: (home: unknown) => Promise<unknown>
}): IUserService {
	return {
		current: behavior?.current,
		updatePreferredLanguage: vi.fn(
			behavior?.updatePreferredLanguage ?? (async () => behavior?.current),
		),
		updateHome: vi.fn(behavior?.updateHome ?? (async () => behavior?.current)),
	} as unknown as IUserService
}

// UserStore now OWNS the guest home/language slice directly, hydrating from
// localStorage on construction. Seed the dedicated keys BEFORE building so the
// store's @observable fields pick them up.
function seedGuest(opts?: { home?: string | null; language?: string | null }) {
	if (opts?.home != null) localStorage.setItem(GUEST_HOME_KEY, opts.home)
	if (opts?.language != null)
		localStorage.setItem(GUEST_LANGUAGE_KEY, opts.language)
}

function build(opts: { auth: IAuthService; userService: IUserService }) {
	const { ea, emitLocaleChange } = makeEa()
	const container = createTestContainer(
		Registration.instance(IAuthService, opts.auth),
		Registration.instance(IUserService, opts.userService),
		Registration.instance(IEventAggregator, ea as never),
	)
	container.register(Registration.singleton(IUserStore, UserStore))
	const store = container.get(IUserStore)
	return { store, emitLocaleChange, ea }
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
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
			// createTestContainer's mock i18n.getLocale() defaults to 'ja'.
			expect(store.currentLanguage).toBe('ja')
		})

		it('reflects an explicit guest language choice from the observable source', () => {
			seedGuest({ language: 'en' })
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
			expect(store.currentLanguage).toBe('en')
		})

		it('updates reactively when the guest language changes', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
			expect(store.currentLanguage).toBe('ja')

			// Mutating the @observable guest source re-resolves the getter with
			// no manual mirror. The store owns the setter now.
			store.setGuestLanguage('en')
			expect(store.currentLanguage).toBe('en')
		})
	})

	describe('currentLanguage — authenticated', () => {
		it('reads preferredLanguage from userService.current', () => {
			const { store } = build({
				auth: makeAuth(true),
				userService: makeUserService({
					current: { id: 'u', preferredLanguage: 'en' },
				}),
			})
			expect(store.currentLanguage).toBe('en')
		})

		it('normalizes a non-supported backend tag to a supported code', () => {
			const { store } = build({
				auth: makeAuth(true),
				userService: makeUserService({
					current: { id: 'u', preferredLanguage: 'en-US' },
				}),
			})
			// 'en-US' is not in SUPPORTED_LANGUAGES; normalize so the selector
			// still highlights the 'en' option.
			expect(store.currentLanguage).toBe('en')
		})

		it('falls back to the i18n mirror and does NOT backfill when preferredLanguage is NULL', () => {
			const userService = makeUserService({
				current: { id: 'u' }, // no preferredLanguage
			})
			const { store } = build({
				auth: makeAuth(true),
				userService,
			})

			// Surfaces the active locale ('ja' from the mock i18n) ...
			expect(store.currentLanguage).toBe('ja')
			// ... and is a PURE projection: the backfill RPC is owned by
			// user-hydration-task, never the getter (no retry storm, no
			// requireUserId throw before a user is loaded).
			store.currentLanguage
			expect(userService.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('currentLanguage — reactive i18n mirror', () => {
		it('re-resolves the guest fallback when the i18n locale changes', () => {
			const { store, emitLocaleChange } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
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
			const { store } = build({
				auth: makeAuth(true),
				userService: makeUserService({
					current: { id: 'u', home: { level1: 'JP-13' } },
				}),
			})
			expect(store.currentHome).toBe('JP-13')
		})

		it('reads from the observable guest source for a guest', () => {
			seedGuest({ home: 'JP-27' })
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
			expect(store.currentHome).toBe('JP-27')
		})

		it('reflects a guest home change via setGuestHome', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
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
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
			expect(store.guestLanguage).toBeNull()
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBeNull()
			expect(store.currentLanguage).toBe('ja')
		})

		it('persists and reflects an explicit guest choice via the dedicated key', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})

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

			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
			})
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
})
