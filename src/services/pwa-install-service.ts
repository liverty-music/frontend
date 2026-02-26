import { DI, ILogger, observable, resolve } from 'aurelia'
import { StorageKeys } from '../constants/storage-keys'

export const IPwaInstallService = DI.createInterface<IPwaInstallService>(
	'IPwaInstallService',
	(x) => x.singleton(PwaInstallService),
)

export interface IPwaInstallService extends PwaInstallService {}

export class PwaInstallService {
	private readonly logger = resolve(ILogger).scopeTo('PwaInstallService')

	private deferredPrompt: BeforeInstallPromptEvent | null = null

	@observable public canShow = false

	constructor() {
		this.incrementSessionCount()
		this.listenForInstallPrompt()
	}

	private incrementSessionCount(): void {
		const count =
			Number(localStorage.getItem(StorageKeys.pwaSessionCount) || '0') + 1
		localStorage.setItem(StorageKeys.pwaSessionCount, String(count))
	}

	private get sessionCount(): number {
		return Number(localStorage.getItem(StorageKeys.pwaSessionCount) || '0')
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
		this.canShow =
			this.deferredPrompt !== null &&
			this.sessionCount >= 2 &&
			!this.isDismissed
		if (this.canShow) {
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
