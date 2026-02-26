import { ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'

export class NotificationPrompt {
	public isVisible = false
	public isLoading = false

	private readonly logger = resolve(ILogger).scopeTo('NotificationPrompt')
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)

	public attached(): void {
		const dismissed = localStorage.getItem(
			StorageKeys.uiNotificationPromptDismissed,
		)
		if (dismissed) {
			return
		}

		// Show prompt when permission is undecided (soft ask) or denied (settings guidance)
		if (this.notificationManager.permission !== 'granted') {
			this.isVisible = true
		}
	}

	public async enable(): Promise<void> {
		this.isLoading = true
		try {
			await this.pushService.subscribe()
			// Only hide the prompt and persist dismissal when the user actually
			// granted the permission. If denied, the prompt stays visible so the
			// template's `denied` block can guide the user to browser settings.
			if (this.notificationManager.permission === 'granted') {
				this.isVisible = false
				localStorage.setItem(StorageKeys.uiNotificationPromptDismissed, 'true')
			}
		} catch (err) {
			this.logger.error('Failed to enable push notifications', err)
		} finally {
			this.isLoading = false
		}
	}

	public dismiss(): void {
		this.isVisible = false
		localStorage.setItem(StorageKeys.uiNotificationPromptDismissed, 'true')
	}
}
