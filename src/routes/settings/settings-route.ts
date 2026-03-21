import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { translationKey } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'
import { IUserService } from '../../services/user-service'

const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

export class SettingsRoute {
	public readonly auth = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

	public currentHome: string | null = null
	public currentLocale = ''
	public notificationsEnabled = false
	public vapidAvailable = !!(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '')
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	public emailVerified = false
	public isResendingVerification = false
	public resendSuccess = false

	public get currentHomeKey(): string {
		return this.currentHome
			? `userHome.prefectures.${this.currentHome}`
			: 'settings.notSet'
	}

	public loading(): void {
		this.currentLocale = this.i18n.getLocale()
		const homeLevel1 = this.userService.current?.home?.level1
		const code = homeLevel1 ?? UserHomeSelector.getStoredHome()
		this.currentHome = code ? translationKey(code) : null
		const storedPref =
			localStorage.getItem(StorageKeys.userNotificationsEnabled) === 'true'
		// If the browser permission was revoked externally, override the stored preference
		this.notificationsEnabled =
			storedPref && this.notificationManager.permission === 'granted'

		// Read email_verified from OIDC profile claims
		this.emailVerified =
			(this.auth.user?.profile as Record<string, unknown>)?.email_verified ===
			true
	}

	public openHomeSelector(): void {
		this.homeSelector.open()
	}

	public onHomeSelected(code: string): void {
		this.currentHome = translationKey(code)
		this.logger.info('Home area updated from settings', { code })
	}

	public openLanguageSelector(): void {
		this.languageSelectorOpen = true
	}

	public async selectLanguage(lang: string): Promise<void> {
		const current = this.i18n.getLocale()
		if (lang === current) {
			this.languageSelectorOpen = false
			return
		}
		await this.i18n.setLocale(lang)
		this.currentLocale = lang
		localStorage.setItem('language', lang)
		this.logger.info('Language changed', { from: current, to: lang })
		this.languageSelectorOpen = false
	}

	public isCurrentLanguage(lang: string): boolean {
		return this.i18n.getLocale() === lang
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

	public async resendVerification(): Promise<void> {
		if (this.isResendingVerification) return
		this.isResendingVerification = true
		this.resendSuccess = false

		try {
			await this.userService.client.resendEmailVerification({})
			this.resendSuccess = true
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.ResourceExhausted) {
				this.ea.publish(
					new Snack(this.i18n.tr('settings.resendRateLimited'), 'error'),
				)
			} else {
				this.logger.error('Failed to resend verification email', err)
				this.ea.publish(
					new Snack(this.i18n.tr('settings.resendError'), 'error'),
				)
			}
		} finally {
			this.isResendingVerification = false
		}
	}

	public async signOut(): Promise<void> {
		try {
			this.userService.clear()
			await this.auth.signOut()
		} catch (err) {
			this.logger.error('Sign-out failed', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('settings.signOutError'), 'error'))
		}
	}
}
