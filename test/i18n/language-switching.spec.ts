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

	it('should update currentLocale property after language change', async () => {
		sut.loading()
		expect(sut.currentLocale).toBe('ja')

		await sut.selectLanguage('en')

		expect(sut.currentLocale).toBe('en')
	})

	it('should initialize currentLocale from i18n in loading()', () => {
		sut.loading()

		expect(sut.currentLocale).toBe('ja')
		expect(mockI18n.getLocale).toHaveBeenCalled()
	})

	it('should identify current language', () => {
		expect(sut.isCurrentLanguage('ja')).toBe(true)
		expect(sut.isCurrentLanguage('en')).toBe(false)
	})

	describe('currentHomeKey', () => {
		it('should return prefecture translation key when home is set', () => {
			sut.currentHome = 'tokyo'

			expect(sut.currentHomeKey).toBe('userHome.prefectures.tokyo')
		})

		it('should return settings.notSet key when home is null', () => {
			sut.currentHome = null

			expect(sut.currentHomeKey).toBe('settings.notSet')
		})

		it('should update key when home changes', () => {
			sut.currentHome = 'tokyo'
			expect(sut.currentHomeKey).toBe('userHome.prefectures.tokyo')

			sut.currentHome = 'fukuoka'
			expect(sut.currentHomeKey).toBe('userHome.prefectures.fukuoka')
		})
	})
})
