import type { I18N } from '@aurelia/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IAuthService } from '../services/auth-service'
import type { IUserService } from '../services/user-service'
import type { IUserStore } from '../services/user-store'
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
		current: { id: 'u', preferredLanguage: 'ja' },
		updatePreferredLanguage: vi.fn(
			behavior?.updatePreferredLanguage ?? (async () => ({ id: 'u' })),
		),
	} as unknown as IUserService
}

function makeUserStore(): IUserStore {
	return {
		guestLanguage: null,
		setGuestLanguage: vi.fn(),
	} as unknown as IUserStore
}

describe('changeLocale', () => {
	let userStore: IUserStore

	beforeEach(() => {
		userStore = makeUserStore()
	})

	describe('validation', () => {
		it('throws TypeError on unsupported language without touching state', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userService = makeUserService()

			await expect(
				changeLocale({ i18n, auth, userService, userStore }, 'fr'),
			).rejects.toBeInstanceOf(TypeError)
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(userStore.setGuestLanguage).not.toHaveBeenCalled()
			expect(userService.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('unauthenticated path', () => {
		it('calls i18n.setLocale and writes through the observable guest source; no RPC', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userService = makeUserService()

			await changeLocale({ i18n, auth, userService, userStore }, 'en')

			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			// Write through the @observable guest language owner (not raw
			// localStorage) so UserStore.currentLanguage stays reactive.
			expect(userStore.setGuestLanguage).toHaveBeenCalledWith('en')
			expect(userService.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('authenticated path', () => {
		it('calls RPC first, then setLocale; NEVER touches the guest source', async () => {
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

			await changeLocale({ i18n, auth, userService, userStore }, 'en')

			expect(userService.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(callOrder).toEqual(['rpc', 'setLocale'])
			expect(userStore.setGuestLanguage).not.toHaveBeenCalled()
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
				changeLocale({ i18n, auth, userService, userStore }, 'en'),
			).rejects.toThrow('network')
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(userStore.setGuestLanguage).not.toHaveBeenCalled()
		})
	})
})
