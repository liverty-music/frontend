import { resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PwaInstallPrompt {
	public readonly pwaInstall = resolve(IPwaInstallService)
	public isVisible = false

	@watch((vm: PwaInstallPrompt) => vm.pwaInstall.canShow)
	public canShowChanged(newValue: boolean): void {
		if (newValue && !this.isVisible) {
			this.isVisible = true
		} else if (!newValue && this.isVisible) {
			this.isVisible = false
		}
	}

	public async handleInstall(): Promise<void> {
		await this.pwaInstall.install()
		this.isVisible = false
	}

	public handleDismiss(): void {
		this.isVisible = false
		this.pwaInstall.dismiss()
	}
}
