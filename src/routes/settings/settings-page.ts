import { ILogger, resolve } from 'aurelia'
import { AreaSelectorSheet } from '../../components/area-selector-sheet/area-selector-sheet'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'

const NOTIFICATION_PREF_KEY = 'liverty-music:notification-enabled'

export class SettingsPage {
	public readonly auth = resolve(IAuthService)
	public readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsPage')

	public currentArea = ''
	public notificationsEnabled = false
	public isTogglingNotifications = false
	public areaSheet!: AreaSelectorSheet

	public attached(): void {
		this.currentArea = AreaSelectorSheet.getStoredArea() ?? ''
		this.notificationsEnabled = this.loadNotificationPref()
	}

	public openAreaSelector(): void {
		this.areaSheet.open()
	}

	public onAreaSelected(prefecture: string): void {
		this.currentArea = prefecture
	}

	public async toggleNotifications(): Promise<void> {
		if (this.isTogglingNotifications) return

		this.isTogglingNotifications = true
		try {
			if (this.notificationsEnabled) {
				await this.pushService.unsubscribe()
				this.notificationsEnabled = false
				localStorage.setItem(NOTIFICATION_PREF_KEY, 'false')
				this.logger.info('Push notifications disabled')
			} else {
				await this.pushService.subscribe()
				if (this.notificationManager.permission === 'granted') {
					this.notificationsEnabled = true
					localStorage.setItem(NOTIFICATION_PREF_KEY, 'true')
					this.logger.info('Push notifications enabled')
				}
			}
		} catch (err) {
			this.logger.error('Failed to toggle notifications', err)
		} finally {
			this.isTogglingNotifications = false
		}
	}

	public async signOut(): Promise<void> {
		await this.auth.signOut()
	}

	private loadNotificationPref(): boolean {
		const stored = localStorage.getItem(NOTIFICATION_PREF_KEY)
		if (stored !== null) return stored === 'true'
		return this.notificationManager.permission === 'granted'
	}
}
