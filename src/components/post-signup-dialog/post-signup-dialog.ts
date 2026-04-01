import { bindable, ILogger, resolve } from 'aurelia'
import { INotificationManager } from '../../services/notification-manager'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPushService } from '../../services/push-service'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PostSignupDialog {
	@bindable public active = false

	public isOpen = false
	public notificationLoading = false
	public notificationDone = false
	public notificationError = false

	private readonly logger = resolve(ILogger).scopeTo('PostSignupDialog')
	public readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)

	public get canInstallPwa(): boolean {
		// On iOS, beforeinstallprompt never fires — hide the dialog row.
		// iOS users use the persistent FAB with the instruction sheet instead.
		return this.pwaInstall.canShowFab && !this.pwaInstall.isIos
	}

	public activeChanged(): void {
		if (this.active) {
			this.isOpen = true
			// Suppress the standalone notification prompt for this session —
			// the dialog handles it inline. FAB is not suppressed.
			this.promptCoordinator.markShown('notification')
		}
	}

	public async onEnableNotifications(): Promise<void> {
		this.notificationLoading = true
		this.notificationError = false
		try {
			await this.pushService.subscribe()
			this.notificationDone = true
		} catch (err) {
			this.logger.error('PostSignupDialog: failed to enable notifications', err)
			this.notificationError = true
		} finally {
			this.notificationLoading = false
		}
	}

	public async onInstallPwa(): Promise<void> {
		await this.pwaInstall.install()
	}

	public onDefer(): void {
		this.isOpen = false
	}
}
