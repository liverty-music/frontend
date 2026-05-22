import type { I18N } from '@aurelia/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'
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
		current: { id: 'u', preferredLanguage: 'ja' },
		updatePreferredLanguage: vi.fn(
			behavior?.updatePreferredLanguage ?? (async () => ({ id: 'u' })),
		),
	} as unknown as IUserService
}

function makeLocalStorage() {
	const map = new Map<string, string>()
	const impl: ILocalStorage = {
		getItem: vi.fn((k: string) => map.get(k) ?? null),
		setItem: vi.fn((k: string, v: string) => {
			map.set(k, v)
		}),
		removeItem: vi.fn((k: string) => {
			map.delete(k)
		}),
	}
	return { map, impl }
}

describe('changeLocale', () => {
	let storage: ReturnType<typeof makeLocalStorage>

	beforeEach(() => {
		storage = makeLocalStorage()
	})

	describe('validation', () => {
		it('throws TypeError on unsupported language without touching state', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userService = makeUserService()

			await expect(
				changeLocale(
					{ i18n, auth, userService, localStorage: storage.impl },
					'fr',
				),
			).rejects.toBeInstanceOf(TypeError)
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(storage.impl.setItem).not.toHaveBeenCalled()
			expect(userService.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('unauthenticated path', () => {
		it('calls i18n.setLocale and writes localStorage; no RPC', async () => {
			const i18n = makeI18n()
			const auth = makeAuth(false)
			const userService = makeUserService()

			await changeLocale(
				{ i18n, auth, userService, localStorage: storage.impl },
				'en',
			)

			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(storage.impl.setItem).toHaveBeenCalledWith(
				StorageKeys.language,
				'en',
			)
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

			await changeLocale(
				{ i18n, auth, userService, localStorage: storage.impl },
				'en',
			)

			expect(userService.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(i18n.setLocale).toHaveBeenCalledWith('en')
			expect(callOrder).toEqual(['rpc', 'setLocale'])
			expect(storage.impl.setItem).not.toHaveBeenCalled()
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
				changeLocale(
					{ i18n, auth, userService, localStorage: storage.impl },
					'en',
				),
			).rejects.toThrow('network')
			expect(i18n.setLocale).not.toHaveBeenCalled()
			expect(storage.impl.setItem).not.toHaveBeenCalled()
		})
	})
})
