import type { I18N } from '@aurelia/i18n'
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from 'vitest'
import { StorageKeys } from '../constants/storage-keys'
import type { IAuthService } from '../services/auth-service'
import type { IUserStore } from '../services/user-store'
import { changeLocale, normalizeToSupportedLanguage } from './change-locale'

function makeI18n(behavior?: {
	setLocale?: (lang: string) => Promise<void>
}): I18N {
	return {
		setLocale: vi.fn(behavior?.setLocale ?? (async () => undefined)),
		getLocale: vi.fn(() => 'ja'),
	} as unknown as I18N
}

function makeAuth(isAuthenticated: boolean): IAuthService {
	return { isAuthenticated } as unknown as IAuthService
}

function makeUserStore(behavior?: {
	updatePreferredLanguage?: (lang: string) => Promise<unknown>
}): IUserStore {
	return {
		current: { id: 'u', preferredLanguage: 'ja' },
		updatePreferredLanguage: vi.fn(
			behavior?.updatePreferredLanguage ?? (async () => ({ id: 'u' })),
		),
	} as unknown as IUserStore
}

describe('changeLocale', () => {
	/** The language saved on this device, as changeLocale's storage sees it. */
	let saved: Map<string, string>
	let storage: { setItem: Mock<(key: string, value: string) => void> }

	beforeEach(() => {
		saved = new Map()
		storage = {
			setItem: vi.fn((k: string, v: string) => {
				saved.set(k, v)
			}),
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('validation', () => {
		it('throws TypeError on unsupported language without touching state', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userStore = makeUserStore()

			await expect(
				changeLocale({ i18n, auth, userStore, storage }, 'fr'),
			).rejects.toBeInstanceOf(TypeError)
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(storage.setItem).not.toHaveBeenCalled()
			expect(userStore.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('unauthenticated path', () => {
		// @spec components/infrastructure/fan/web/global/i18n "Anonymous caller path"
		it('calls i18n.setLocale and persists to the single language key; no RPC', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userStore = makeUserStore()

			await changeLocale({ i18n, auth, userStore, storage }, 'en')

			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			// The anonymous choice is persisted explicitly to the single
			// `language` key (the i18next detector cache) — no separate guest key.
			expect(saved.get(StorageKeys.language)).toBe('en')
			expect(userStore.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('authenticated path', () => {
		// @spec components/infrastructure/fan/web/global/i18n "Authenticated caller path"
		// @spec components/infrastructure/fan/web/global/i18n "Switching language mid-session as an authenticated user"
		// @spec components/infrastructure/fan/web/global/i18n "Language switched while signed in survives sign-out"
		it('calls RPC first, then setLocale, then saves the language on this device', async () => {
			saved.set(StorageKeys.language, 'ja')
			const callOrder: string[] = []
			const i18n = makeI18n({
				setLocale: async () => {
					callOrder.push('setLocale')
				},
			})
			const auth = makeAuth(true)
			const userStore = makeUserStore({
				updatePreferredLanguage: async () => {
					callOrder.push('rpc')
					return { id: 'u' }
				},
			})

			await changeLocale({ i18n, auth, userStore, storage }, 'en')

			expect(userStore.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(callOrder).toEqual(['rpc', 'setLocale'])
			// The saved language follows the switch, so the Welcome page after a
			// sign-out opens in it.
			expect(saved.get(StorageKeys.language)).toBe('en')
		})

		// @spec components/infrastructure/fan/web/global/i18n "Authenticated language switch RPC failure"
		it('rethrows when RPC fails, leaving the locale and the saved language unchanged', async () => {
			saved.set(StorageKeys.language, 'ja')
			const i18n = makeI18n()
			const auth = makeAuth(true)
			const userStore = makeUserStore({
				updatePreferredLanguage: async () => {
					throw new Error('network')
				},
			})

			await expect(
				changeLocale({ i18n, auth, userStore, storage }, 'en'),
			).rejects.toThrow('network')
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(saved.get(StorageKeys.language)).toBe('ja')
		})
	})
})

describe('normalizeToSupportedLanguage', () => {
	it.each([
		['ja', 'ja'],
		['en', 'en'],
		['ja-JP', 'ja'],
		['en-US', 'en'],
	])('keeps a supported language: %s → %s', (input, expected) => {
		expect(normalizeToSupportedLanguage(input)).toBe(expected)
	})

	// @spec components/infrastructure/fan/web/global/i18n "Fallback to English"
	// @spec components/infrastructure/fan/web/global/i18n "New account from an unsupported browser language"
	it.each(['fr', 'zh-Hant-TW', ''])(
		'falls back to English for an unsupported language: %j',
		(input) => {
			// This value is also what UserService.Create receives for a new account.
			expect(normalizeToSupportedLanguage(input)).toBe('en')
		},
	)
})
