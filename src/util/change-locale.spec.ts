import type { I18N } from '@aurelia/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IAuthService } from '../services/auth-service'
import type { IUserService } from '../services/user-service'
import { changeLocale } from './change-locale'

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

function makeUserService(behavior?: {
	updatePreferredLanguage?: (lang: string) => Promise<unknown>
}): IUserService {
	return {
		updatePreferredLanguage: vi.fn(
			behavior?.updatePreferredLanguage ?? (async () => ({ id: 'u' })),
		),
	} as unknown as IUserService
}

describe('changeLocale', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	describe('unauthenticated path', () => {
		it('calls i18n.setLocale and writes localStorage; no RPC', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userService = makeUserService()

			await changeLocale({ i18n, auth, userService }, 'en')

			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(localStorage.getItem('language')).toBe('en')
			expect(userService.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('authenticated path', () => {
		it('calls RPC first, then setLocale; NEVER writes localStorage', async () => {
			const callOrder: string[] = []
			const i18n = makeI18n({
				setLocale: async () => {
					callOrder.push('setLocale')
				},
			})
			const auth = makeAuth(true)
			const userService = makeUserService({
				updatePreferredLanguage: async () => {
					callOrder.push('rpc')
					return { id: 'u' }
				},
			})

			await changeLocale({ i18n, auth, userService }, 'en')

			expect(userService.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(callOrder).toEqual(['rpc', 'setLocale'])
			expect(localStorage.getItem('language')).toBeNull()
		})

		it('rethrows when RPC fails so the caller can surface a Snack', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(true)
			const userService = makeUserService({
				updatePreferredLanguage: async () => {
					throw new Error('network')
				},
			})

			await expect(
				changeLocale({ i18n, auth, userService }, 'en'),
			).rejects.toThrow('network')
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(localStorage.getItem('language')).toBeNull()
		})

		it('does NOT rethrow when setLocale fails after a successful RPC (false-error guard)', async () => {
			const i18n = makeI18n({
				setLocale: async () => {
					throw new Error('resource missing')
				},
			})
			const auth = makeAuth(true)
			const userService = makeUserService()

			// The DB write succeeded; surfacing the i18n failure would mislead
			// the settings UI into showing a "couldn't save" Snack. Hydration
			// re-syncs i18n with the DB value on the next boot.
			await expect(
				changeLocale({ i18n, auth, userService }, 'en'),
			).resolves.toBeUndefined()
			expect(userService.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(localStorage.getItem('language')).toBeNull()
		})
	})
})
