import { bindable, ILogger, INode, resolve } from 'aurelia'

export class CelebrationOverlay {
	@bindable public active = false
	@bindable public message = ''
	@bindable public onComplete?: () => void

	public visible = false
	public fadingOut = false

	public get overlayState(): 'hidden' | 'active' | 'exiting' {
		if (!this.visible) return 'hidden'
		return this.fadingOut ? 'exiting' : 'active'
	}

	private shown = false
	private timer: ReturnType<typeof setTimeout> | null = null

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
			this.onComplete?.()
		}
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	private show(): void {
		this.shown = true
		this.visible = true
		this.fadingOut = false
		this.logger.info('Celebration overlay shown')

		const displayDuration = this.prefersReducedMotion() ? 1500 : 2500
		this.timer = setTimeout(() => {
			this.startFadeOut()
		}, displayDuration)
	}

	private startFadeOut(): void {
		if (this.prefersReducedMotion()) {
			this.visible = false
			this.onComplete?.()
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
		this.onComplete?.()
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}
}
