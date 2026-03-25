import { bindable, ILogger, INode, resolve } from 'aurelia'

export class CelebrationOverlay {
	@bindable public active = false
	@bindable public message = ''
	@bindable public subMessage = ''
	@bindable public onOpen?: () => void
	@bindable public onDismissed?: () => void

	public visible = false
	public fadingOut = false

	public get overlayState(): 'hidden' | 'active' | 'exiting' {
		if (!this.visible) return 'hidden'
		return this.fadingOut ? 'exiting' : 'active'
	}

	private shown = false

	private readonly logger = resolve(ILogger).scopeTo('CelebrationOverlay')
	private readonly host = resolve(INode) as HTMLElement

	public activeChanged(): void {
		if (this.active && !this.shown) {
			this.show()
		}
	}

	public attached(): void {
		this.host.addEventListener('transitionend', this.onTransitionEnd)
		// Handle case where active was already true during bind() phase
		if (this.active && !this.shown) {
			this.show()
		}
	}

	public detaching(): void {
		this.host.removeEventListener('transitionend', this.onTransitionEnd)
		if (this.fadingOut) {
			this.fadingOut = false
			this.onDismissed?.()
		}
	}

	/** Tap anywhere on the overlay to dismiss it. */
	public onTap(): void {
		if (!this.visible || this.fadingOut) return
		this.startFadeOut()
	}

	private show(): void {
		this.shown = true
		this.visible = true
		this.fadingOut = false
		this.logger.info('Celebration overlay shown')
		// Notify caller on open (e.g. to advance onboarding step)
		this.onOpen?.()
	}

	private startFadeOut(): void {
		if (this.prefersReducedMotion()) {
			this.visible = false
			this.onDismissed?.()
			return
		}

		this.fadingOut = true
		// CSS transition on .fade-out fires transitionend → onTransitionEnd handles cleanup
	}

	private readonly onTransitionEnd = (e: TransitionEvent): void => {
		if (e.propertyName !== 'opacity') return
		if (!this.fadingOut) return

		this.visible = false
		this.fadingOut = false
		this.onDismissed?.()
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}
}
