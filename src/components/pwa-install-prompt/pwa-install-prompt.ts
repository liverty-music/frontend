import { resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

const EXIT_ANIMATION_MS = 600

export class PwaInstallPrompt {
	public readonly pwaInstall = resolve(IPwaInstallService)
	public isVisible = false
	public animationClass = ''

	@watch((vm: PwaInstallPrompt) => vm.pwaInstall.canShow)
	public canShowChanged(newValue: boolean): void {
		if (newValue && !this.isVisible) {
			this.animationClass = 'animate-fade-slide-up'
			this.isVisible = true
		}
	}

	public async handleInstall(): Promise<void> {
		this.hideWithAnimation()
		await this.pwaInstall.install()
	}

	public handleDismiss(): void {
		this.hideWithAnimation()
		this.pwaInstall.dismiss()
	}

	private hideWithAnimation(): void {
		this.animationClass = 'animate-fade-slide-down'
		setTimeout(() => {
			this.isVisible = false
		}, EXIT_ANIMATION_MS)
	}
}
