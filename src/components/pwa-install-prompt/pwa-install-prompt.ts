import { resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

const EXIT_ANIMATION_MS = 600

export class PwaInstallPrompt {
	public readonly pwaInstall = resolve(IPwaInstallService)
	public isVisible = false
	public animationClass = ''
	public popoverEl!: HTMLElement
	private hideTimer: ReturnType<typeof setTimeout> | null = null

	@watch((vm: PwaInstallPrompt) => vm.pwaInstall.canShow)
	public canShowChanged(newValue: boolean): void {
		if (newValue && !this.isVisible) {
			this.animationClass = 'animate-fade-slide-up'
			this.isVisible = true
			this.popoverEl?.showPopover()
		} else if (!newValue && this.isVisible) {
			this.hideWithAnimation()
		}
	}

	public detaching(): void {
		if (this.hideTimer !== null) {
			clearTimeout(this.hideTimer)
			this.hideTimer = null
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
		this.hideTimer = setTimeout(() => {
			this.hideTimer = null
			this.isVisible = false
			if (this.popoverEl?.isConnected) {
				this.popoverEl.hidePopover()
			}
		}, EXIT_ANIMATION_MS)
	}
}
