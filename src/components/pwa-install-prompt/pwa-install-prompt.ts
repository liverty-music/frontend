import { resolve, watch } from 'aurelia'
import { IPwaInstallService } from '../../services/pwa-install-service'

export class PwaInstallPrompt {
	public readonly pwaInstall = resolve(IPwaInstallService)
	public isVisible = false
	public animationState = ''
	public popoverEl!: HTMLElement

	@watch((vm: PwaInstallPrompt) => vm.pwaInstall.canShow)
	public canShowChanged(newValue: boolean): void {
		if (newValue && !this.isVisible) {
			this.animationState = 'fade-slide-up'
			this.isVisible = true
			this.popoverEl?.showPopover()
		} else if (!newValue && this.isVisible) {
			this.hideWithAnimation()
		}
	}

	public detaching(): void {
		this.popoverEl?.removeEventListener('animationend', this.onHideAnimationEnd)
		// Handle reduced motion: cleanup immediately if animation hadn't finished
		if (this.animationState === 'fade-slide-down') {
			this.isVisible = false
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
		this.animationState = 'fade-slide-down'
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			this.onHideAnimationEnd()
			return
		}
		this.popoverEl.addEventListener('animationend', this.onHideAnimationEnd, {
			once: true,
		})
	}

	private readonly onHideAnimationEnd = (): void => {
		this.isVisible = false
		if (this.popoverEl?.isConnected) {
			this.popoverEl.hidePopover()
		}
	}
}
