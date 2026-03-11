import { bindable, ILogger, resolve } from 'aurelia'

export class CelebrationOverlay {
	@bindable public active = false
	@bindable public message = ''
	@bindable public onComplete?: () => void

	public visible = false
	public fadingOut = false

	private shown = false
	private timer: ReturnType<typeof setTimeout> | null = null

	private readonly logger = resolve(ILogger).scopeTo('CelebrationOverlay')

	public activeChanged(): void {
		if (this.active && !this.shown) {
			this.show()
		}
	}

	public detaching(): void {
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
		this.timer = setTimeout(() => {
			this.visible = false
			this.fadingOut = false
			this.onComplete?.()
		}, 400)
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}
}
