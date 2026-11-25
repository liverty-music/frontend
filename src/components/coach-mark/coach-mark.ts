import { bindable, ILogger, resolve } from 'aurelia'

const MAX_RETRY_MS = 5000
/** The overlay's fade-out: `--md-sys-motion-spring-effects-duration` in coach-mark.css. */
const EXIT_MS = 200
const INITIAL_RETRY_MS = 100

/**
 * Single, transient coach mark. The screen that uses it renders it within its
 * own template and drives it through its bindables; today that is only the
 * Welcome demo (`welcome-route`), which points it at the first concert card of
 * its timetable.
 *
 * Tapping the highlighted target delegates to its native click (the target's
 * own action) and closes the coach mark. Tapping the dimmed area outside the
 * target light-dismisses the coach mark via `onDismiss`. Light-dismiss is
 * handled by a document-level `pointerdown` listener (capture) rather than a
 * full-viewport backdrop, so it works above any other overlay without a
 * `z-index` and without blocking the page: the host and the dim layer stay
 * `pointer-events: none`; only the target-interceptor opts in.
 */
export class CoachMark {
	@bindable public targetSelector = ''
	@bindable public message = ''
	@bindable public active = false
	@bindable public onTap?: () => void
	@bindable public onDismiss?: () => void

	/** Set by `ref="overlayEl"` — used to tell target/tooltip taps from outside taps. */
	public overlayEl: HTMLElement | null = null

	public visible = false

	/** Takes the anchor off the target once the overlay has faded out. */
	private exitTimer: ReturnType<typeof setTimeout> | null = null

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
		this.releaseAnchor()
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
	private findAndHighlight(elapsed = 0, attempt = 0): void {
		this.cancelRetry()
		this.releaseAnchor()
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

		// Exponential backoff: 100, 200, 400, 800, 1600, then the rest of the
		// window, so the last look happens exactly at MAX_RETRY_MS.
		const delay = Math.min(
			INITIAL_RETRY_MS * 2 ** attempt,
			MAX_RETRY_MS - elapsed,
		)
		this.retryTimer = setTimeout(() => {
			this.findAndHighlight(elapsed + delay, attempt + 1)
		}, delay)
	}

	private highlight(target: HTMLElement): void {
		target.style.setProperty('anchor-name', '--coach-target')
		this.currentTarget = target
		this.visible = true
		// Re-arm (idempotent) the outside-tap light-dismiss listener, and Escape
		// for a keyboard or switch user, who has no tap outside.
		document.removeEventListener('pointerdown', this.onOutsidePointerDown, true)
		document.addEventListener('pointerdown', this.onOutsidePointerDown, true)
		document.removeEventListener('keydown', this.onEscape, true)
		document.addEventListener('keydown', this.onEscape, true)
	}

	/** Escape closes the coach mark, as a tap outside it does. */
	private readonly onEscape = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return
		this.onDismiss?.()
		this.deactivate()
	}

	public deactivate(): void {
		this.cancelRetry()
		document.removeEventListener('pointerdown', this.onOutsidePointerDown, true)
		document.removeEventListener('keydown', this.onEscape, true)
		this.visible = false
		// The spotlight and tip follow the anchor while they fade out; without
		// it the spotlight loses its cut-out and the screen goes dark.
		if (this.currentTarget) {
			this.exitTimer ??= setTimeout(() => this.releaseAnchor(), EXIT_MS)
		}
	}

	private releaseAnchor(): void {
		if (this.exitTimer) clearTimeout(this.exitTimer)
		this.exitTimer = null
		this.clearAnchor()
	}

	/**
	 * Light-dismiss: a `pointerdown` anywhere outside the coach mark's own
	 * elements dismisses it. The dim layer is `pointer-events: none`, so a tap on
	 * the dimmed area resolves to the page element beneath (outside `overlayEl`)
	 * and dismisses; a tap on the target-interceptor stays inside `overlayEl` and
	 * is handled by `onTargetClick` (navigation) instead.
	 */
	private readonly onOutsidePointerDown = (e: PointerEvent): void => {
		const target = e.target as Node | null
		if (!this.overlayEl || (target && this.overlayEl.contains(target))) return
		this.onDismiss?.()
		this.deactivate()
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
		this.deactivate()
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
