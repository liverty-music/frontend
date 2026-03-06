import { I18N } from '@aurelia/i18n'
import { ILogger, resolve } from 'aurelia'
import { IToastService } from '../../components/toast-notification/toast-notification'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { shortDisplayName } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'

const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

export class SettingsPage {
	public readonly auth = resolve(IAuthService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsPage')
	private readonly toastService = resolve(IToastService)
	private readonly i18n = resolve(I18N)

	public currentHome: string | null = null
	public notificationsEnabled = false
	public vapidAvailable = !!(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '')
	public homeSelector!: UserHomeSelector
	private isToggling = false

	public get currentHomeDisplay(): string {
		if (!this.currentHome) return this.i18n.tr('settings.notSet')
		return this.i18n.tr(`userHome.prefectures.${this.currentHome}`)
	}

	public get currentLanguageLabel(): string {
		const lang = this.i18n.getLocale()
		return this.i18n.tr(`languages.${lang}`)
	}

	public loading(): void {
		const code = UserHomeSelector.getStoredHome()
		this.currentHome = code ? shortDisplayName(code) : null
		const storedPref =
			localStorage.getItem(StorageKeys.userNotificationsEnabled) === 'true'
		// If the browser permission was revoked externally, override the stored preference
		this.notificationsEnabled =
			storedPref && this.notificationManager.permission === 'granted'
	}

	public openHomeSelector(): void {
		this.homeSelector.open()
	}

	public onHomeSelected(code: string): void {
		this.currentHome = shortDisplayName(code)
		this.logger.info('Home area updated from settings', { code })
	}

	public async cycleLanguage(): Promise<void> {
		const current = this.i18n.getLocale()
		const idx = SUPPORTED_LANGUAGES.indexOf(
			current as (typeof SUPPORTED_LANGUAGES)[number],
		)
		const next = SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length]
		await this.i18n.setLocale(next)
		localStorage.setItem('language', next)
		this.logger.info('Language changed', { from: current, to: next })
	}

	public async toggleNotifications(): Promise<void> {
		if (this.isToggling) return
		this.isToggling = true

		try {
			const newValue = !this.notificationsEnabled

			if (newValue) {
				await this.pushService.subscribe()
				if (this.notificationManager.permission !== 'granted') {
					this.logger.info('Notification permission not granted, keeping OFF')
					return
				}
				this.notificationsEnabled = true
				localStorage.setItem(StorageKeys.userNotificationsEnabled, 'true')
			} else {
				try {
					await this.pushService.unsubscribe()
				} catch (err) {
					this.logger.error('Failed to unsubscribe push notifications', err)
				}
				this.notificationsEnabled = false
				localStorage.setItem(StorageKeys.userNotificationsEnabled, 'false')
			}
		} catch (err) {
			this.logger.error('Failed to toggle push notifications', err)
		} finally {
			this.isToggling = false
		}
	}

	public async signOut(): Promise<void> {
		try {
			await this.auth.signOut()
		} catch (err) {
			this.logger.error('Sign-out failed', { error: err })
			this.toastService.show(this.i18n.tr('settings.signOutError'), 'error')
		}
	}
}
