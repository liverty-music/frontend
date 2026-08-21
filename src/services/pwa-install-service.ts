import { DI, ILogger, observable, resolve, watch } from 'aurelia'
import {
	persistOnboardingCompletedSessionCount,
	StorageKeys,
} from '../constants/storage-keys'
import { IOnboardingService } from './onboarding-service'

export const IPwaInstallService = DI.createInterface<IPwaInstallService>(
	'IPwaInstallService',
	(x) => x.singleton(PwaInstallService),
)

export interface IPwaInstallService extends PwaInstallService {}

export class PwaInstallService {
	private readonly logger = resolve(ILogger).scopeTo('PwaInstallService')
	private readonly onboarding = resolve(IOnboardingService)

	private deferredPrompt: BeforeInstallPromptEvent | null = null
	private installed = false

	@observable public canShowFab = false

	// Visibility predicate for the `pwa-install-banner`. Unlike `canShowFab`,
	// this does not require the `beforeinstallprompt` event to have been
	// captured and includes iOS Safari (guided install fallback). Kept as an
	// explicit `@observable` (not a getter) so templates react when the private
	// `installed` field flips via `appinstalled` or `confirmInstalled()`.
	@observable public shouldShowInstallBanner = false

	constructor() {
		this.installed = this.detectInstalled()
		this.listenForInstallPrompt()
		this.listenForAppInstalled()
		this.evaluateVisibility()
	}

	private detectInstalled(): boolean {
		if (localStorage.getItem(StorageKeys.pwaInstalled) === 'true') return true
		if (
			'standalone' in navigator &&
			(navigator as { standalone?: boolean }).standalone === true
		)
			return true
		if (window.matchMedia('(display-mode: standalone)').matches) return true
		return false
	}

	get isIos(): boolean {
		if (this.browserSupportsPwa) return false
		if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true
		// iPadOS 13+ reports a macOS desktop user-agent; detect via touch capability
		return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
	}

	// True when the browser exposes the PWA install API (Chrome/Edge/Samsung
	// Internet). False on iOS Safari and other browsers without it.
	get browserSupportsPwa(): boolean {
		return 'BeforeInstallPromptEvent' in window
	}

	// Whether the PostSignupDialog should offer an install path. Unlike
	// `canShowFab`, this does not require the `beforeinstallprompt` event to
	// have been captured — a manual instruction fallback covers that case.
	get canShowInstallOption(): boolean {
		return !this.installed && this.browserSupportsPwa
	}

	private listenForInstallPrompt(): void {
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault()
			this.deferredPrompt = e as BeforeInstallPromptEvent
			this.evaluateVisibility()
		})
	}

	private listenForAppInstalled(): void {
		window.addEventListener('appinstalled', () => {
			this.logger.info('App installed')
			this.markInstalled()
		})
	}

	// Single source of truth for recording an install: persists the flag and
	// clears every visibility signal. Shared by the `appinstalled` event and the
	// explicit iOS `confirmInstalled()` path so the two can never diverge.
	private markInstalled(): void {
		this.installed = true
		localStorage.setItem(StorageKeys.pwaInstalled, 'true')
		this.deferredPrompt = null
		this.canShowFab = false
		this.shouldShowInstallBanner = false
	}

	private evaluateVisibility(): void {
		const eligible =
			!this.installed &&
			this.onboarding.isCompleted &&
			(this.deferredPrompt !== null || this.isIos)

		this.canShowFab = eligible
		if (this.canShowFab) {
			this.logger.info('PWA install FAB ready to show')
		}

		this.updateBannerVisibility()
	}

	// Platform eligibility only. The onboarding gate is redundant: auth-callback
	// always calls onboarding.finish() before redirecting, so isAuthenticated
	// (enforced at the app-shell level) implies isCompleted.
	private updateBannerVisibility(): void {
		this.shouldShowInstallBanner =
			!this.installed && (this.browserSupportsPwa || this.isIos)
	}

	// Explicit install confirmation, primarily for iOS where the `appinstalled`
	// event is unreliable. Records the install so the banner is permanently
	// removed; a subsequent standalone launch re-confirms via `detectInstalled`.
	public confirmInstalled(): void {
		this.markInstalled()
	}

	@watch((vm: PwaInstallService) => vm.onboarding.isCompleted)
	public onboardingCompletedChanged(isCompleted: boolean): void {
		if (!isCompleted) return
		// Persist the completion session so the notification prompt
		// can defer itself to the next session.
		persistOnboardingCompletedSessionCount()
		this.evaluateVisibility()
	}

	public evaluateAfterOnboarding(): void {
		this.onboardingCompletedChanged(this.onboarding.isCompleted)
	}

	public async install(): Promise<void> {
		if (!this.deferredPrompt) return

		this.deferredPrompt.prompt()
		const { outcome } = await this.deferredPrompt.userChoice
		this.logger.info('PWA install prompt outcome', { outcome })

		this.deferredPrompt = null
		this.canShowFab = false

		if (outcome === 'dismissed') {
			// Chrome does not re-fire beforeinstallprompt immediately after
			// cancellation, so evaluateVisibility() won't be called again.
			// Re-assert banner visibility so it stays visible in guide mode.
			this.updateBannerVisibility()
		}
	}
}

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
