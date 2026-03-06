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
		} else if (!newValue && this.isVisible) {
			this.hideWithAnimation()
		}
	}

	public async handleInstall(): Promise<void> {
		await this.pwaInstall.install()
		this.hideWithAnimation()
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
