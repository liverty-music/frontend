import { resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PwaInstallFab {
	private readonly pwaInstall = resolve(IPwaInstallService)

	public isVisible = false
	public isSheetOpen = false
	// isIos is immutable after boot — evaluated once and stored
	public readonly isIos: boolean = this.pwaInstall.isIos

	public binding(): void {
		// Sync initial state: @watch only fires on changes after binding,
		// so if canShowFab is already true when the component attaches we
		// must read it explicitly here.
		this.isVisible = this.pwaInstall.canShowFab
	}

	@watch((vm: PwaInstallFab) => vm.pwaInstall.canShowFab)
	public canShowFabChanged(newValue: boolean): void {
		this.isVisible = newValue
	}

	public handleTap(): void {
		if (this.isIos) {
			this.isSheetOpen = true
		} else {
			void this.pwaInstall.install()
		}
	}

	public closeSheet(): void {
		this.isSheetOpen = false
	}
}
