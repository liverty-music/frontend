import { I18N } from '@aurelia/i18n'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockEventAggregator } from '../helpers/mock-toast'

const mockIAuthService = DI.createInterface('IAuthService')
const mockINotificationManager = DI.createInterface('INotificationManager')
const mockIPushService = DI.createInterface('IPushService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/services/notification-manager', () => ({
	INotificationManager: mockINotificationManager,
}))

vi.mock('../../src/services/push-service', () => ({
	IPushService: mockIPushService,
}))

const { SettingsRoute } = await import(
	'../../src/routes/settings/settings-route'
)

describe('i18n language switching', () => {
	let sut: InstanceType<typeof SettingsRoute>
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
			Registration.instance(IEventAggregator, createMockEventAggregator()),
			Registration.instance(mockINotificationManager, {
				permission: 'default',
			}),
			Registration.instance(mockIPushService, {
				subscribe: vi.fn(),
				unsubscribe: vi.fn(),
			}),
		)
		container.register(SettingsRoute)
		sut = container.get(SettingsRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	it('should start with Japanese locale', () => {
		expect(mockI18n.getLocale()).toBe('ja')
	})

	it('should select English language', async () => {
		await sut.selectLanguage('en')

		expect(mockI18n.setLocale).toHaveBeenCalledWith('en')
		expect(localStorage.getItem('language')).toBe('en')
	})

	it('should switch back to Japanese', async () => {
		await sut.selectLanguage('en')
		expect(mockI18n.currentLocale).toBe('en')

		await sut.selectLanguage('ja')

		expect(mockI18n.setLocale).toHaveBeenCalledWith('ja')
		expect(localStorage.getItem('language')).toBe('ja')
	})

	it('should not call setLocale when selecting current language', async () => {
		await sut.selectLanguage('ja')

		expect(mockI18n.setLocale).not.toHaveBeenCalled()
	})

	it('should persist language choice in localStorage', async () => {
		await sut.selectLanguage('en')
		expect(localStorage.getItem('language')).toBe('en')

		await sut.selectLanguage('ja')
		expect(localStorage.getItem('language')).toBe('ja')
	})

	it('should update currentLanguageLabel after locale change', async () => {
		sut.currentLanguageLabel
		expect(mockI18n.tr).toHaveBeenCalledWith('languages.ja')

		await sut.selectLanguage('en')

		mockI18n.tr.mockClear()
		sut.currentLanguageLabel
		expect(mockI18n.tr).toHaveBeenCalledWith('languages.en')
	})

	it('should identify current language', () => {
		expect(sut.isCurrentLanguage('ja')).toBe(true)
		expect(sut.isCurrentLanguage('en')).toBe(false)
	})

	it('should return language label via languageLabel()', () => {
		sut.languageLabel('en')
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
