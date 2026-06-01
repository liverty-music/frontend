import { Signals } from '@aurelia/i18n'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IAuthService } from '../../src/services/auth-service'
import { GuestService, IGuestService } from '../../src/services/guest-service'
import { IUserService } from '../../src/services/user-service'
import { IUserStore, UserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'

// Dedicated guest-language key (decoupled from the i18next detector's
// 'language' cache). Kept in sync with guest-storage.ts.
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

function makeGuest(overrides?: {
	home?: string | null
	language?: string | null
}): IGuestService {
	const guest = {
		home: overrides?.home ?? null,
		language: overrides?.language ?? null,
		setHome: vi.fn((code: string) => {
			guest.home = code
		}),
		setLanguage: vi.fn((lang: string) => {
			guest.language = lang
		}),
	}
	return guest as unknown as IGuestService
}

function build(opts: {
	auth: IAuthService
	userService: IUserService
	guest: IGuestService
}) {
	const { ea, emitLocaleChange } = makeEa()
	const container = createTestContainer(
		Registration.instance(IAuthService, opts.auth),
		Registration.instance(IUserService, opts.userService),
		Registration.instance(IGuestService, opts.guest),
		Registration.instance(IEventAggregator, ea as never),
	)
	container.register(Registration.singleton(IUserStore, UserStore))
	const store = container.get(IUserStore)
	return { store, emitLocaleChange, ea }
}

describe('UserStore', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		sessionStorage.clear()
		localStorage.clear()
	})

	describe('currentLanguage — guest', () => {
		let guest: IGuestService

		beforeEach(() => {
			guest = makeGuest()
		})

		it('falls back to the active i18n locale when the guest made no explicit choice', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
				guest,
			})
			// createTestContainer's mock i18n.getLocale() defaults to 'ja'.
			expect(store.currentLanguage).toBe('ja')
		})

		it('reflects an explicit guest language choice from the observable source', () => {
			guest = makeGuest({ language: 'en' })
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
				guest,
			})
			expect(store.currentLanguage).toBe('en')
		})

		it('updates reactively when the guest language changes', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
				guest,
			})
			expect(store.currentLanguage).toBe('ja')

			// Mutating the @observable guest source re-resolves the getter with
			// no manual mirror — language changes route through changeLocale, not
			// the store (the store no longer exposes a setter).
			guest.setLanguage('en')
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
				guest: makeGuest(),
			})
			expect(store.currentLanguage).toBe('en')
		})

		it('normalizes a non-supported backend tag to a supported code', () => {
			const { store } = build({
				auth: makeAuth(true),
				userService: makeUserService({
					current: { id: 'u', preferredLanguage: 'en-US' },
				}),
				guest: makeGuest(),
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
				guest: makeGuest(),
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
				guest: makeGuest(),
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
				guest: makeGuest(),
			})
			expect(store.currentHome).toBe('JP-13')
		})

		it('reads from the observable guest source for a guest', () => {
			const { store } = build({
				auth: makeAuth(false),
				userService: makeUserService(),
				guest: makeGuest({ home: 'JP-27' }),
			})
			expect(store.currentHome).toBe('JP-27')
		})
	})

	// Round-trip against the REAL guest-storage key + a REAL GuestService,
	// exercising the dedicated 'guest.language' key (decoupled from the i18next
	// detector's 'language' cache).
	describe('currentLanguage — real guest round-trip', () => {
		function buildWithRealGuest() {
			const { ea, emitLocaleChange } = makeEa()
			const container = createTestContainer(
				Registration.instance(IAuthService, makeAuth(false)),
				Registration.instance(IUserService, makeUserService()),
				Registration.instance(IEventAggregator, ea as never),
			)
			container.register(Registration.singleton(IGuestService, GuestService))
			container.register(Registration.singleton(IUserStore, UserStore))
			const guest = container.get(IGuestService)
			const store = container.get(IUserStore)
			return { store, guest, emitLocaleChange }
		}

		it('falls back to the i18n mirror when no explicit choice was stored', () => {
			// No 'guest.language' key written → loadLanguage() returns null.
			const { store, guest } = buildWithRealGuest()
			expect(guest.language).toBeNull()
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBeNull()
			expect(store.currentLanguage).toBe('ja')
		})

		it('persists and reflects an explicit guest choice via the dedicated key', () => {
			const { store, guest } = buildWithRealGuest()

			guest.setLanguage('ja')
			// languageChanged() write-through hits the real saveLanguage.
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('ja')

			guest.setLanguage('en')
			expect(guest.language).toBe('en')
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('en')
			expect(store.currentLanguage).toBe('en')
		})

		it('clearAll() removes only the guest key, never the detector cache', () => {
			// Seed the detector's own active-locale cache (written by
			// i18next-browser-languagedetector, NOT GuestService).
			localStorage.setItem(DETECTOR_LANGUAGE_KEY, 'en')

			const { guest } = buildWithRealGuest()
			guest.setLanguage('en')
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBe('en')

			guest.clearAll()
			// guest.language cleared (its dedicated key removed) ...
			expect(localStorage.getItem(GUEST_LANGUAGE_KEY)).toBeNull()
			// ... but the detector's 'language' cache survives, so a cancelled
			// login does not lose the chosen UI language.
			expect(localStorage.getItem(DETECTOR_LANGUAGE_KEY)).toBe('en')
		})
	})
})
