import { bindable, INode, resolve } from 'aurelia'

/**
 * Global CSS variable the route area, the snack bar and the FAB's sink read
 * (shared with pwa-install-banner).
 */
const BANNER_HEIGHT_VAR = '--bottom-banner-height'

export class SignupPromptBanner {
	@bindable public message = '\u{1F514} 通知を有効にするには'
	@bindable public visible = false

	private readonly element = resolve(INode) as HTMLElement
	private resizeObserver: ResizeObserver | null = null
	/** Whether this banner wrote the shared height variable last. */
	private publishing = false

	public attached(): void {
		// Publish the banner's rendered height so the route area and the snack
		// bar end above it. The height follows the banner's text size (from its
		// width) and the user's font size, so observe it rather than hard-coding
		// it.
		this.resizeObserver = new ResizeObserver(() => this.publishHeight())
		// The observer reports the first size at the next rendering step, so no
		// synchronous read here (it forced a layout while the page attached).
		this.resizeObserver.observe(this.element)
	}

	public detaching(): void {
		this.resizeObserver?.disconnect()
		this.resizeObserver = null
		this.unpublish()
	}

	/**
	 * Publish the rendered height while the banner shows. The signup prompt and
	 * the install banner share the variable and never show together, but both
	 * hosts can be mounted at once (a signed-in fan's dashboard mounts the
	 * hidden signup prompt), so a hidden banner leaves the variable to the
	 * visible one instead of writing 0px over it.
	 */
	private publishHeight(): void {
		const height = this.element.offsetHeight
		if (height > 0) {
			document.documentElement.style.setProperty(
				BANNER_HEIGHT_VAR,
				`${height}px`,
			)
			this.publishing = true
		} else {
			this.unpublish()
		}
	}

	private unpublish(): void {
		if (!this.publishing) return
		document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR)
		this.publishing = false
	}

	public onSignup(): void {
		this.element.dispatchEvent(
			new CustomEvent('signup-requested', { bubbles: true }),
		)
	}
}
