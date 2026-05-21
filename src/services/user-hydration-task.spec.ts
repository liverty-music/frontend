import type { IContainer } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

interface MockUser {
	id: string
	preferredLanguage?: string
}

const mockAuth = { ready: Promise.resolve(), isAuthenticated: true }
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
				default:
					throw new Error(`unmocked token: ${fn ?? String(token)}`)
			}
		},
	} as unknown as IContainer
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('runUserHydration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockUserService.current = undefined
		i18nState.locale = 'en'
		localStorage.setItem('language', 'en')
	})

	it('skips hydration when the user is not authenticated', async () => {
		mockAuth.isAuthenticated = false

		await runUserHydration(makeContainer())

		expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()
		// localStorage stays untouched for anonymous users.
		expect(localStorage.getItem('language')).toBe('en')
	})

	it('applies preferred_language to i18n when present in hydrated profile', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'ja' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})

		await runUserHydration(makeContainer())

		expect(mockI18n.setLocale).toHaveBeenCalledWith('ja')
		expect(mockUserService.updatePreferredLanguage).not.toHaveBeenCalled()
		expect(localStorage.getItem('language')).toBeNull()
	})

	it('backfills preferred_language when absent in hydrated profile', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})
		i18nState.locale = 'ja'

		await runUserHydration(makeContainer())

		expect(mockUserService.updatePreferredLanguage).toHaveBeenCalledWith('ja')
		// No i18n.setLocale because the effective locale already matches.
		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		expect(localStorage.getItem('language')).toBeNull()
	})

	it('continues gracefully when backfill RPC fails', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: undefined }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})
		mockUserService.updatePreferredLanguage.mockRejectedValueOnce(
			new Error('network'),
		)

		await expect(runUserHydration(makeContainer())).resolves.toBeUndefined()
		// Cleanup MUST still run even when backfill fails.
		expect(localStorage.getItem('language')).toBeNull()
	})

	it('removes localStorage["language"] after hydration even when language was already set', async () => {
		mockUserService.current = { id: 'user-1', preferredLanguage: 'ja' }
		mockUserService.ensureLoaded.mockImplementationOnce(async () => {
			return mockUserService.current
		})

		await runUserHydration(makeContainer())

		expect(localStorage.getItem('language')).toBeNull()
	})

	it('skips post-hydration steps when ensureLoaded throws', async () => {
		mockUserService.ensureLoaded.mockRejectedValueOnce(new Error('boom'))

		await runUserHydration(makeContainer())

		expect(mockI18n.setLocale).not.toHaveBeenCalled()
		expect(mockUserService.updatePreferredLanguage).not.toHaveBeenCalled()
		// localStorage cleanup is gated on a successful hydration; the legacy
		// key stays in place so the next boot can re-attempt.
		expect(localStorage.getItem('language')).toBe('en')
	})
})
