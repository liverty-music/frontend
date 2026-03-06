import { ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IOnboardingService } from '../../services/onboarding-service'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPushService } from '../../services/push-service'

export class NotificationPrompt {
	public isVisible = false
	public isLoading = false

	private readonly logger = resolve(ILogger).scopeTo('NotificationPrompt')
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly auth = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)

	public attached(): void {
		if (!this.auth.isAuthenticated) return
		if (!this.onboarding.isCompleted) return

		const dismissed = localStorage.getItem(
			StorageKeys.uiNotificationPromptDismissed,
		)
		if (dismissed) return

		if (this.notificationManager.permission === 'granted') return

		// Do not show on the same session where onboarding just completed.
		// When completedSessionCount is missing, treat as "completed this session"
		// to handle the case where PwaInstallService hasn't persisted it yet.
		const completedAtRaw = localStorage.getItem(
			StorageKeys.pwaCompletedSessionCount,
		)
		const currentSession = Number(
			localStorage.getItem(StorageKeys.pwaSessionCount) || '0',
		)
		const completedAt =
			completedAtRaw !== null ? Number(completedAtRaw) : currentSession
		if (currentSession <= completedAt) return

		if (!this.promptCoordinator.canShowPrompt('notification')) return

		this.isVisible = true
		this.promptCoordinator.markShown('notification')
	}

	public async enable(): Promise<void> {
		this.isLoading = true
		try {
			await this.pushService.subscribe()
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
