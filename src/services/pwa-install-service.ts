import { DI, ILogger, observable, resolve } from 'aurelia'
import { StorageKeys } from '../constants/storage-keys'
import { IAuthService } from './auth-service'
import { IOnboardingService } from './onboarding-service'
import { IPromptCoordinator } from './prompt-coordinator'

export const IPwaInstallService = DI.createInterface<IPwaInstallService>(
	'IPwaInstallService',
	(x) => x.singleton(PwaInstallService),
)

export interface IPwaInstallService extends PwaInstallService {}

export class PwaInstallService {
	private readonly logger = resolve(ILogger).scopeTo('PwaInstallService')
	private readonly onboarding = resolve(IOnboardingService)
	private readonly auth = resolve(IAuthService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)

	private deferredPrompt: BeforeInstallPromptEvent | null = null

	@observable public canShow = false

	constructor() {
		this.incrementSessionCount()
		this.persistCompletedSessionCountIfNeeded()
		this.listenForInstallPrompt()
	}

	private incrementSessionCount(): void {
		const count =
			Number(localStorage.getItem(StorageKeys.pwaSessionCount) || '0') + 1
		localStorage.setItem(StorageKeys.pwaSessionCount, String(count))
	}

	private persistCompletedSessionCountIfNeeded(): void {
		if (
			this.onboarding.isCompleted &&
			localStorage.getItem(StorageKeys.pwaCompletedSessionCount) === null
		) {
			localStorage.setItem(
				StorageKeys.pwaCompletedSessionCount,
				String(this.sessionCount),
			)
		}
	}

	private get sessionCount(): number {
		return Number(localStorage.getItem(StorageKeys.pwaSessionCount) || '0')
	}

	private get completedSessionCount(): number {
		return Number(
			localStorage.getItem(StorageKeys.pwaCompletedSessionCount) || '0',
		)
	}

	private get isDismissed(): boolean {
		return (
			localStorage.getItem(StorageKeys.pwaInstallPromptDismissed) === 'true'
		)
	}

	private listenForInstallPrompt(): void {
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault()
			this.deferredPrompt = e as BeforeInstallPromptEvent
			this.evaluateVisibility()
		})
	}

	private evaluateVisibility(): void {
		const eligible =
			this.deferredPrompt !== null &&
			!this.isDismissed &&
			this.onboarding.isCompleted &&
			this.auth.isAuthenticated &&
			this.sessionCount >= this.completedSessionCount + 2 &&
			this.promptCoordinator.canShowPrompt('pwa-install')

		this.canShow = eligible
		if (this.canShow) {
			this.promptCoordinator.markShown('pwa-install')
			this.logger.info('PWA install prompt ready to show')
		}
	}

	public async install(): Promise<void> {
		if (!this.deferredPrompt) return

		this.deferredPrompt.prompt()
		const { outcome } = await this.deferredPrompt.userChoice
		this.logger.info('PWA install prompt outcome', { outcome })

		this.deferredPrompt = null
		this.canShow = false
	}

	public dismiss(): void {
		localStorage.setItem(StorageKeys.pwaInstallPromptDismissed, 'true')
		this.canShow = false
		this.logger.info('PWA install prompt dismissed')
	}
}

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
