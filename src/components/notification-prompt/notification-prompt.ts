import { ILogger, resolve } from 'aurelia'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'

const DISMISSED_KEY = 'liverty-music:notification-prompt-dismissed'

export class NotificationPrompt {
	public isVisible = false
	public isLoading = false

	private readonly logger = resolve(ILogger).scopeTo('NotificationPrompt')
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)

	public attached(): void {
		const dismissed = localStorage.getItem(DISMISSED_KEY)
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
			this.isVisible = false
			localStorage.setItem(DISMISSED_KEY, 'true')
		} catch (err) {
			this.logger.error('Failed to enable push notifications', err)
		} finally {
			this.isLoading = false
		}
	}

	public dismiss(): void {
		this.isVisible = false
		localStorage.setItem(DISMISSED_KEY, 'true')
	}
}
