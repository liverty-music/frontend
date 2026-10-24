import { bindable, ILogger, observable, resolve, watch } from 'aurelia'
import { IFollowStore } from '../../services/follow-store'
import { INotificationManager } from '../../services/notification-manager'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPushOfferService } from '../../services/push-offer-service'
import { IPwaInstallService } from '../../services/pwa-install-service'

/**
 * - `notify`: turn on notifications.
 * - `install`: add the app to the home screen.
 * - `iosGuide`: on iOS and iPadOS, where notifications work only for an app
 *   opened from the home screen, the add-to-home-screen steps instead of both.
 */
export type PostSignupStep = 'notify' | 'install' | 'iosGuide'

/** What the notification step reports after the browser prompt. */
export type NotifyProblem = 'blocked' | 'failed' | null

/**
 * The sheet that follows the post-signup celebration. It asks one thing per
 * step, each with one primary action and 「あとで」; a step already answered on
 * this device is skipped, and with no step left it does not open.
 */
export class PostSignupDialog {
	@bindable public active = false

	public isOpen = false
	public steps: PostSignupStep[] = []
	public stepIndex = 0
	public notifyProblem: NotifyProblem = null
	/** Whether the install step shows the browser-menu steps. */
	public installGuideShown = false

	// True when the native `beforeinstallprompt` prompt is available, so
	// 「追加する」 opens it. Driven by an explicit `@watch` on `canShowFab`
	// rather than a plain getter: `if.bind` on a getter that traverses an
	// injected service's `@observable` is not guaranteed to update reactively.
	@observable public canInstallNatively = false

	private readonly logger = resolve(ILogger).scopeTo('PostSignupDialog')
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushOffer = resolve(IPushOfferService)
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)
	private readonly followStore = resolve(IFollowStore)

	public get step(): PostSignupStep | null {
		return this.steps[this.stepIndex] ?? null
	}

	/** Followed artists, read after the guest merge, for the notification step. */
	public get followedCount(): number {
		return this.followStore.followedCount
	}

	// Neither `@watch` nor the `active` change handler fires on initial bind,
	// so seed both here.
	public binding(): void {
		this.syncCanInstallNatively()
		if (this.active) this.activeChanged()
	}

	// Switch 「追加する」 to the native prompt as soon as it arrives, even while
	// the install step is open.
	@watch((vm: PostSignupDialog) => vm.pwaInstall.canShowFab)
	public canShowFabChanged(): void {
		this.syncCanInstallNatively()
	}

	private syncCanInstallNatively(): void {
		this.canInstallNatively =
			this.pwaInstall.canShowFab && !this.pwaInstall.isIos
	}

	public activeChanged(): void {
		if (!this.active) return
		this.steps = this.pickSteps()
		this.stepIndex = 0
		if (this.steps.length === 0) {
			this.logger.info('Post-signup sheet has nothing to ask')
			this.promptCoordinator.isPostSignupSurfaceOpen = false
			return
		}
		this.isOpen = true
		// Suppress the bottom-anchored pwa-install-banner while this sheet
		// occupies the same space (D7).
		this.promptCoordinator.isPostSignupSurfaceOpen = true
	}

	/** The steps to show, decided once when the sheet opens. */
	private pickSteps(): PostSignupStep[] {
		const installed = this.pwaInstall.isInstalled
		if (this.pwaInstall.isIos && !installed) return ['iosGuide']
		const steps: PostSignupStep[] = []
		if (
			this.pushOffer.canReceivePush &&
			this.notificationManager.permission === 'default'
		) {
			steps.push('notify')
		}
		if (this.pwaInstall.canShowInstallOption || this.canInstallNatively) {
			steps.push('install')
		}
		return steps
	}

	public unbinding(): void {
		// Torn down on route change — release the banner suppression so it can
		// re-appear on other routes.
		this.promptCoordinator.isPostSignupSurfaceOpen = false
	}

	/**
	 * 「通知をオンにする」: the browser prompt opens within this tap. Allowed or
	 * closed moves on; blocked or failed stays to say so, until 「次へ」.
	 */
	public async onEnableNotifications(): Promise<void> {
		const outcome = await this.pushOffer.accept({
			source: 'post_signup_dialog',
			counted: false,
			inline: true,
		})
		if (outcome === 'denied') {
			this.notifyProblem = 'blocked'
			return
		}
		if (outcome === 'failed') {
			this.notifyProblem = 'failed'
			return
		}
		this.next()
	}

	/** 「追加する」: the browser's own prompt, or the browser-menu steps. */
	public async onInstall(): Promise<void> {
		if (!this.canInstallNatively) {
			this.installGuideShown = true
			return
		}
		await this.pwaInstall.install()
		this.close()
	}

	/** 「あとで」 and 「次へ」: on to the next step, or closed after the last. */
	public next(): void {
		this.notifyProblem = null
		if (this.stepIndex + 1 >= this.steps.length) {
			this.close()
			return
		}
		this.stepIndex += 1
	}

	public close(): void {
		this.isOpen = false
		// Sheet dismissed — allow the pwa-install-banner to surface (D7).
		this.promptCoordinator.isPostSignupSurfaceOpen = false
	}
}
