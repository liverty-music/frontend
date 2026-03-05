import { I18N } from '@aurelia/i18n'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockToastService } from '../helpers/mock-toast'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIToastService = DI.createInterface('IToastService')
const mockINotificationManager = DI.createInterface('INotificationManager')
const mockIPushService = DI.createInterface('IPushService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
}))

vi.mock('../../src/services/notification-manager', () => ({
	INotificationManager: mockINotificationManager,
}))

vi.mock('../../src/services/push-service', () => ({
	IPushService: mockIPushService,
}))

const { SettingsPage } = await import('../../src/routes/settings/settings-page')

describe('i18n language switching', () => {
	let sut: InstanceType<typeof SettingsPage>
	let mockI18n: ReturnType<typeof createStatefulI18nMock>

	function createStatefulI18nMock() {
		let locale = 'ja'
		return {
			tr: vi.fn((key: string) => key),
			getLocale: vi.fn(() => locale),
			setLocale: vi.fn(async (newLocale: string) => {
				locale = newLocale
			}),
			get currentLocale() {
				return locale
			},
		}
	}

	beforeEach(() => {
		localStorage.clear()

		mockI18n = createStatefulI18nMock()

		const container = DI.createContainer()
		container.register(
			Registration.instance(I18N, mockI18n),
			Registration.instance(mockIAuthService, {
				isAuthenticated: true,
				signOut: vi.fn(),
			}),
			Registration.instance(mockIToastService, createMockToastService()),
			Registration.instance(mockINotificationManager, {
				permission: 'default',
			}),
			Registration.instance(mockIPushService, {
				subscribe: vi.fn(),
				unsubscribe: vi.fn(),
			}),
		)
		container.register(SettingsPage)
		sut = container.get(SettingsPage)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	it('should start with Japanese locale', () => {
		expect(mockI18n.getLocale()).toBe('ja')
	})

	it('should cycle from ja to en', async () => {
		await sut.cycleLanguage()

		expect(mockI18n.setLocale).toHaveBeenCalledWith('en')
		expect(localStorage.getItem('language')).toBe('en')
	})

	it('should cycle from en back to ja', async () => {
		// Switch to English first
		await sut.cycleLanguage()
		expect(mockI18n.currentLocale).toBe('en')

		// Switch back to Japanese
		await sut.cycleLanguage()

		expect(mockI18n.setLocale).toHaveBeenCalledWith('ja')
		expect(localStorage.getItem('language')).toBe('ja')
	})

	it('should persist language choice in localStorage', async () => {
		await sut.cycleLanguage()
		expect(localStorage.getItem('language')).toBe('en')

		await sut.cycleLanguage()
		expect(localStorage.getItem('language')).toBe('ja')
	})

	it('should update currentLanguageLabel after locale change', async () => {
		// Before switching: ja
		sut.currentLanguageLabel
		expect(mockI18n.tr).toHaveBeenCalledWith('languages.ja')

		// Switch to English
		await sut.cycleLanguage()

		// After switching: en
		mockI18n.tr.mockClear()
		sut.currentLanguageLabel
		expect(mockI18n.tr).toHaveBeenCalledWith('languages.en')
	})

	it('should use i18n.tr for home display when home is set', () => {
		sut.currentHome = 'tokyo'
		const display = sut.currentHomeDisplay

		expect(mockI18n.tr).toHaveBeenCalledWith('userHome.prefectures.tokyo')
		expect(display).toBe('userHome.prefectures.tokyo')
	})

	it('should use i18n.tr for "not set" when home is null', () => {
		sut.currentHome = null
		const display = sut.currentHomeDisplay

		expect(mockI18n.tr).toHaveBeenCalledWith('settings.notSet')
		expect(display).toBe('settings.notSet')
	})
})
