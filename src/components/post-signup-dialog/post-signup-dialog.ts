import { bindable, ILogger, observable, resolve, watch } from 'aurelia'
import { INotificationManager } from '../../services/notification-manager'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPushService } from '../../services/push-service'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PostSignupDialog {
	@bindable public active = false

	public isOpen = false
	public notificationDone = false
	public notificationError = false

	// True when the native `beforeinstallprompt` prompt is available, so the
	// install row can offer a one-tap install. Driven by an explicit `@watch`
	// on `canShowFab` (see below) rather than a plain getter: `if.bind` on a
	// getter that traverses an injected service's `@observable` is not
	// guaranteed to update reactively.
	@observable public canInstallNatively = false

	private readonly logger = resolve(ILogger).scopeTo('PostSignupDialog')
	public readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)

	public get canInstallPwa(): boolean {
		// Show the install row whenever the browser supports PWA install, even
		// if the native prompt has not been captured — a manual instruction
		// fallback covers that case. iOS is excluded implicitly because it
		// lacks `BeforeInstallPromptEvent` (`canShowInstallOption` is false).
		return this.pwaInstall.canShowInstallOption
	}

	public get isAllDone(): boolean {
		return (
			!this.pwaInstall.canShowInstallOption &&
			this.notificationManager.permission === 'granted'
		)
	}

	// `@watch` does not fire on initial bind, so seed the value here.
	public binding(): void {
		this.syncCanInstallNatively()
	}

	// Upgrade the install row to the native button as soon as the deferred
	// prompt arrives, even if the dialog is already open.
	@watch((vm: PostSignupDialog) => vm.pwaInstall.canShowFab)
	public canShowFabChanged(): void {
		this.syncCanInstallNatively()
	}

	private syncCanInstallNatively(): void {
		// A one-tap native install needs a captured prompt (`canShowFab`) and is
		// never available on iOS (no `beforeinstallprompt`).
		this.canInstallNatively =
			this.pwaInstall.canShowFab && !this.pwaInstall.isIos
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
		// The busy/disabled state while this runs is handled by `busy-on-click`.
		this.notificationError = false
		try {
			const endpoint = await this.pushService.create()
			if (!endpoint) {
				// `create()` returns null when the user denies the browser
				// permission prompt or VAPID is not configured — no subscription
				// was registered, so the dialog must not show a success state.
				return
			}
			this.notificationDone = true
		} catch (err) {
			this.logger.error('PostSignupDialog: failed to enable notifications', err)
			this.notificationError = true
		}
	}

	public async onInstallPwa(): Promise<void> {
		await this.pwaInstall.install()
	}

	public onDefer(): void {
		this.isOpen = false
	}
}
