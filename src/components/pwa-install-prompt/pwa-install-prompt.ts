import { resolve } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PwaInstallPrompt {
	public readonly pwaInstall = resolve(IPwaInstallService)

	public async install(): Promise<void> {
		await this.pwaInstall.install()
	}

	public dismiss(): void {
		this.pwaInstall.dismiss()
	}
}
