import { IRouterEvents } from '@aurelia/router'
import { type IDisposable, INode, observable, resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

/** Which CTA the banner offers, driven reactively by the deferred prompt. */
type InstallMode = 'native' | 'guide'

/**
 * Global CSS variable the route area, the snack bar and the FAB's sink read
 * (shared with signup-prompt-banner).
 */
const BANNER_HEIGHT_VAR = '--bottom-banner-height'

/** The attention cue's keyframes (pwa-install-banner.css). */
const CUE = 'banner-cue'

export class PwaInstallBanner {
	private readonly pwaInstall = resolve(IPwaInstallService)
	private readonly element = resolve(INode) as HTMLElement
	private readonly routerEvents = resolve(IRouterEvents)
	private resizeObserver: ResizeObserver | null = null
	private navigation: IDisposable | null = null
	/** Whether this banner wrote the shared height variable last. */
	private publishing = false

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
		// Publish the banner's rendered height so the FAB launcher offsets clear of
		// it (same mechanism as signup-prompt-banner; the two are mutually exclusive
		// — guest vs authenticated — so they share one variable safely).
		this.resizeObserver = new ResizeObserver(() => this.publishHeight())
		// The observer reports the first size at the next rendering step, so no
		// synchronous read here (it forced a layout while the page attached).
		this.resizeObserver.observe(this.element)
		// The banner stays mounted in the shell across routes, so its counted
		// cue would play only once per page load; start it again on every route.
		this.navigation = this.routerEvents.subscribe(
			'au:router:navigation-end',
			() => this.restartCue(),
		)
	}

	public detaching(): void {
		this.resizeObserver?.disconnect()
		this.resizeObserver = null
		this.navigation?.dispose()
		this.navigation = null
		this.unpublish()
	}

	/** Play the attention cue from its start, its five plays included. */
	private restartCue(): void {
		for (const animation of this.element.getAnimations({ subtree: true })) {
			if ((animation as CSSAnimation).animationName !== CUE) continue
			animation.currentTime = 0
			animation.play()
		}
	}

	/**
	 * Publish the rendered height while the banner shows. The signup prompt and
	 * the install banner share the variable and never show together, but both
	 * hosts can be mounted at once (a signed-in fan's dashboard mounts the
	 * hidden signup prompt), so a hidden banner leaves the variable to the
	 * visible one instead of writing 0px over it.
	 */
	private publishHeight(): void {
		const height = this.element.offsetHeight
		if (height > 0) {
			document.documentElement.style.setProperty(
				BANNER_HEIGHT_VAR,
				`${height}px`,
			)
			this.publishing = true
		} else {
			this.unpublish()
		}
	}

	private unpublish(): void {
		if (!this.publishing) return
		document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR)
		this.publishing = false
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
}
