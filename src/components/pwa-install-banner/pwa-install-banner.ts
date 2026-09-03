import { INode, observable, resolve, watch } from 'aurelia'
import { SessionKeys } from '../../constants/storage-keys'
import { IPwaInstallService } from '../../services/pwa-install-service'

/** Which CTA the banner offers, driven reactively by the deferred prompt. */
type InstallMode = 'native' | 'guide'

/** Global CSS variable the FAB launcher offsets above (shared with signup-prompt-banner). */
const BANNER_HEIGHT_VAR = '--bottom-banner-height'

export class PwaInstallBanner {
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly element = resolve(INode) as HTMLElement
	private resizeObserver: ResizeObserver | null = null

	// isIos is immutable after boot — evaluated once and stored.
	public readonly isIos: boolean = this.pwaInstall.isIos

	@observable public dismissed = false
	// 'native' one-tap install (deferred prompt captured, non-iOS) vs 'guide'
	// manual instructions (iOS Safari or prompt not yet captured).
	@observable public installMode: InstallMode = 'guide'
	public isGuideSheetOpen = false

	public binding(): void {
		this.dismissed =
			sessionStorage.getItem(SessionKeys.pwaBannerDismissed) === 'true'
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
		// Publish the banner's rendered height so the FAB launcher offsets clear of
		// it (same mechanism as signup-prompt-banner; the two are mutually exclusive
		// — guest vs authenticated — so they share one variable safely).
		this.resizeObserver = new ResizeObserver(() => this.publishHeight())
		this.resizeObserver.observe(this.element)
		this.publishHeight()
	}

	public detaching(): void {
		this.resizeObserver?.disconnect()
		this.resizeObserver = null
		document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR)
	}

	private publishHeight(): void {
		document.documentElement.style.setProperty(
			BANNER_HEIGHT_VAR,
			`${this.element.offsetHeight}px`,
		)
	}

	private syncInstallMode(): void {
		// Native one-tap needs a captured deferred prompt (`canShowFab`) and is
		// never available on iOS (no `beforeinstallprompt`).
		this.installMode =
			this.pwaInstall.canShowFab && !this.isIos ? 'native' : 'guide'
	}

	// Read directly from the service `@observable` so the host `if.bind`
	// re-evaluates when the app is installed (D1). `dismissed` is a local
	// `@observable`, so both dependencies are reactively tracked.
	public get isVisible(): boolean {
		return this.pwaInstall.shouldShowInstallBanner && !this.dismissed
	}

	public onCta(): void | Promise<void> {
		if (this.installMode === 'native') {
			return this.onInstall()
		}
		this.isGuideSheetOpen = true
	}

	public onInstall(): Promise<void> {
		// Return the promise so `busy-on-click` shows a busy state while the
		// native browser install prompt is open.
		return this.pwaInstall.install()
	}

	public onConfirmInstalled(): void {
		this.pwaInstall.confirmInstalled()
		this.isGuideSheetOpen = false
	}

	public dismiss(): void {
		this.dismissed = true
		sessionStorage.setItem(SessionKeys.pwaBannerDismissed, 'true')
	}
}
