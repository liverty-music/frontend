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
		if ('BeforeInstallPromptEvent' in window) return false
		if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true
		// iPadOS 13+ reports a macOS desktop user-agent; detect via touch capability
		return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
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
			this.installed = true
			localStorage.setItem(StorageKeys.pwaInstalled, 'true')
			this.deferredPrompt = null
			this.canShowFab = false
		})
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
	}
}

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
