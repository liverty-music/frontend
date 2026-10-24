import { IRouterEvents } from '@aurelia/router'
import { type IDisposable, INode, observable, resolve, watch } from 'aurelia'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { IPwaInstallService } from '../../services/pwa-install-service'

/** Which CTA the banner offers, driven reactively by the deferred prompt. */
type InstallMode = 'native' | 'guide'

/** The attention cue's keyframes (pwa-install-banner.css). */
const CUE = 'banner-cue'

export class PwaInstallBanner {
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly element = resolve(INode) as HTMLElement
	private readonly routerEvents = resolve(IRouterEvents)
	private readonly analytics = resolve(IAnalyticsService)
	private navigation: IDisposable | null = null

	// isIos is immutable after boot — evaluated once and stored.
	public readonly isIos: boolean = this.pwaInstall.isIos

	// 'native' one-tap install (deferred prompt captured, non-iOS) vs 'guide'
	// manual instructions (iOS Safari or prompt not yet captured).
	@observable public installMode: InstallMode = 'guide'
	public isGuideSheetOpen = false

	public binding(): void {
		// @watch does not fire on initial bind, so seed installMode explicitly.
		this.syncInstallMode()
	}

	// Upgrade the CTA from guide to native one-tap the moment the deferred
	// prompt arrives, even if the banner is already visible — same pattern as
	// PostSignupDialog.canShowFabChanged().
	@watch((vm: PwaInstallBanner) => vm.pwaInstall.canShowFab)
	public canShowFabChanged(): void {
		this.syncInstallMode()
	}

	public attached(): void {
		if (this.isVisible) this.reportShown()
		// The banner stays mounted in the shell across routes, so its counted
		// cue would play only once per page load; start it again on every route.
		this.navigation = this.routerEvents.subscribe(
			'au:router:navigation-end',
			() => this.restartCue(),
		)
	}

	public detaching(): void {
		this.navigation?.dispose()
		this.navigation = null
	}

	/** Play the attention cue from its start, its five plays included. */
	private restartCue(): void {
		for (const animation of this.element.getAnimations({ subtree: true })) {
			if ((animation as CSSAnimation).animationName !== CUE) continue
			animation.currentTime = 0
			animation.play()
		}
	}

	// The banner appears while mounted once the device allows the install.
	@watch((vm: PwaInstallBanner) => vm.isVisible)
	public isVisibleChanged(visible: boolean): void {
		if (visible) this.reportShown()
	}

	private reportShown(): void {
		this.analytics.capture(Events.PwaInstallBannerShown, {
			install_mode: this.installMode,
		})
	}

	private syncInstallMode(): void {
		// Native one-tap needs a captured deferred prompt (`canShowFab`) and is
		// never available on iOS (no `beforeinstallprompt`).
		this.installMode =
			this.pwaInstall.canShowFab && !this.isIos ? 'native' : 'guide'
	}

	// Read directly from the service `@observable` so the host `if.bind`
	// re-evaluates when the app is installed (D1). The banner has no dismiss:
	// it stays until the app is installed or the install is confirmed.
	public get isVisible(): boolean {
		return this.pwaInstall.shouldShowInstallBanner
	}

	public onCta(): void | Promise<void> {
		if (this.installMode === 'native') {
			return this.onInstall()
		}
		this.isGuideSheetOpen = true
		this.analytics.capture(Events.PwaInstallAnswered, {
			answer: 'guide_opened',
		})
	}

	public async onInstall(): Promise<void> {
		// Returned to `busy-on-click`, which shows a busy state while the
		// native browser install prompt is open.
		const answer = await this.pwaInstall.install()
		if (answer !== null) {
			this.analytics.capture(Events.PwaInstallAnswered, { answer })
		}
	}

	public onConfirmInstalled(): void {
		this.pwaInstall.confirmInstalled()
		this.isGuideSheetOpen = false
	}
}
