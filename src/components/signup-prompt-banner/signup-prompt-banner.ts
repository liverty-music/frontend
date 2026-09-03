import { bindable, INode, resolve } from 'aurelia'

/** Global CSS variable other bottom-anchored surfaces (the FAB launcher) offset above. */
const BANNER_HEIGHT_VAR = '--bottom-banner-height'

export class SignupPromptBanner {
	@bindable public message = '\u{1F514} 通知を有効にするには'
	@bindable public visible = false

	private readonly element = resolve(INode) as HTMLElement
	private resizeObserver: ResizeObserver | null = null

	public attached(): void {
		// Publish the banner's rendered height so the FAB launcher can offset
		// clear of it. The height is dynamic (message wrap), so observe it rather
		// than hard-coding — the banner is the one bottom surface whose height is
		// not a constant, which is why a ResizeObserver is warranted here.
		this.resizeObserver = new ResizeObserver(() => this.publishHeight())
		this.resizeObserver.observe(this.element)
		this.publishHeight()
	}

	public detaching(): void {
		this.resizeObserver?.disconnect()
		this.resizeObserver = null
		document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR)
	}

	private publishHeight(): void {
		// offsetHeight is 0 while hidden (the inner <aside> is `if.bind`-removed),
		// so the FAB's `var(--bottom-banner-height, 0px)` term naturally collapses.
		document.documentElement.style.setProperty(
			BANNER_HEIGHT_VAR,
			`${this.element.offsetHeight}px`,
		)
	}

	public onSignup(): void {
		this.element.dispatchEvent(
			new CustomEvent('signup-requested', { bubbles: true }),
		)
	}
}
