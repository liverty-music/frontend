import { bindable, ILogger, resolve } from 'aurelia'

const MAX_RETRY_MS = 5000
const INITIAL_RETRY_MS = 100

/**
 * Single, transient, non-blocking coach mark. Renders once at the app-shell
 * level and is driven by `CoachMarkService` via its bindables.
 *
 * Non-blocking: the dim overlay + cutout is `pointer-events: none` and there are
 * no off-target click-blockers, so the rest of the page stays interactive and
 * scroll is never locked (soft gate). Tapping the target delegates to its native
 * click; off-target taps reach the underlying page.
 */
export class CoachMark {
	@bindable public targetSelector = ''
	@bindable public message = ''
	@bindable public active = false
	@bindable public onTap?: () => void

	public visible = false

	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private currentTarget: HTMLElement | null = null

	private readonly logger = resolve(ILogger).scopeTo('CoachMark')

	public activeChanged(): void {
		if (this.active) {
			this.findAndHighlight()
		} else {
			this.deactivate()
		}
	}

	public bound(): void {
		if (this.active) {
			this.findAndHighlight()
		}
	}

	public detaching(): void {
		this.deactivate()
	}

	public targetSelectorChanged(): void {
		if (this.active) {
			this.findAndHighlight()
		}
	}

	/**
	 * Resolve the target element (with the empty-selector guard and a bounded
	 * retry timer for elements that mount slightly after activation) and anchor
	 * the spotlight to it.
	 */
	private findAndHighlight(elapsed = 0): void {
		this.cancelRetry()
		this.clearAnchor()
		if (!this.targetSelector) return

		const target = document.querySelector(this.targetSelector)
		if (target instanceof HTMLElement && this.isVisible(target)) {
			this.highlight(target)
			return
		}

		if (elapsed >= MAX_RETRY_MS) {
			this.logger.error('Coach mark target not found after retries', {
				selector: this.targetSelector,
			})
			this.deactivate()
			return
		}

		// Exponential backoff: 100, 200, 400, 800, 1600...
		const delay = Math.min(
			INITIAL_RETRY_MS * 2 ** Math.floor(elapsed / INITIAL_RETRY_MS),
			MAX_RETRY_MS - elapsed,
		)
		this.retryTimer = setTimeout(() => {
			this.findAndHighlight(elapsed + delay)
		}, delay)
	}

	private highlight(target: HTMLElement): void {
		target.style.setProperty('anchor-name', '--coach-target')
		this.currentTarget = target
		this.visible = true
	}

	public deactivate(): void {
		this.cancelRetry()
		this.visible = false
		this.clearAnchor()
	}

	public onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			this.onTap?.()
		}
	}

	public onTargetClick(e: Event): void {
		e.preventDefault()
		e.stopPropagation()
		this.currentTarget?.click()
		this.onTap?.()
	}

	private clearAnchor(): void {
		if (this.currentTarget) {
			this.currentTarget.style.removeProperty('anchor-name')
			this.currentTarget = null
		}
	}

	/** Reject invisible elements (e.g., inside closed popovers with 0×0 rect). */
	private isVisible(el: HTMLElement): boolean {
		const rect = el.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0
	}

	private cancelRetry(): void {
		if (this.retryTimer) {
			clearTimeout(this.retryTimer)
			this.retryTimer = null
		}
	}
}
