import { bindable, ILogger, resolve } from 'aurelia'
import { IOnboardingService } from '../../services/onboarding-service'

const MAX_RETRY_MS = 5000
const INITIAL_RETRY_MS = 100
const SCROLL_FAILSAFE_MS = 800

export class CoachMark {
	@bindable public targetSelector = ''
	@bindable public message = ''
	@bindable public active = false
	@bindable public onTap?: () => void

	public visible = false

	private overlayEl!: HTMLElement
	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private currentTarget: HTMLElement | null = null
	private isPopoverOpen = false
	private highlightGeneration = 0
	private scrollFailsafeTimer: ReturnType<typeof setTimeout> | null = null
	private scrollEndHandler: (() => void) | null = null

	private readonly logger = resolve(ILogger).scopeTo('CoachMark')
	private readonly onboarding = resolve(IOnboardingService)

	public activeChanged(): void {
		if (this.active) {
			this.findAndHighlight()
		} else {
			this.deactivate()
		}
	}

	public bound(): void {
		this.onboarding.onBringToFront = () => this.bringToFront()
		if (this.active) {
			this.findAndHighlight()
		}
	}

	public detaching(): void {
		this.onboarding.onBringToFront = undefined
		this.deactivate()
	}

	/**
	 * Called when target changes but spotlight should stay open.
	 * Wraps anchor-name reassignment in View Transition for smooth animation.
	 */
	public targetSelectorChanged(): void {
		if (this.active && this.visible) {
			this.findAndHighlight()
		}
	}

	private findAndHighlight(elapsed = 0): void {
		this.cleanup()
		if (!this.targetSelector) return
		const target = document.querySelector(this.targetSelector)
		if (target instanceof HTMLElement) {
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

	private async highlight(target: HTMLElement): Promise<void> {
		const generation = ++this.highlightGeneration

		// Let the browser scroll target into view and wait for scroll to settle.
		// scrollIntoView is a no-op when the element is already visible;
		// the scrollend failsafe timeout resolves in that case.
		await this.smoothScrollTo(target)

		// Abort if a newer highlight() call was initiated during the scroll
		if (generation !== this.highlightGeneration) {
			return
		}

		this.visible = true

		// Wrap anchor-name reassignment in View Transition for smooth spotlight slide
		const reassign = () => {
			this.currentTarget?.style.removeProperty('anchor-name')
			target.style.setProperty('anchor-name', '--coach-target')
			this.currentTarget = target
		}

		if (document.startViewTransition) {
			const transition = document.startViewTransition(reassign)
			// Suppress abort errors on all ViewTransition promises.
			// Route navigation may abort the transition mid-flight.
			transition.finished.catch(() => {})
			try {
				await transition.updateCallbackDone
			} catch {
				// View Transition may be aborted during route navigation
			}
		} else {
			reassign()
		}

		if (generation !== this.highlightGeneration) return

		// Lock scroll on the viewport container
		this.setScrollLock(true)

		// Open popover if not already open (continuous spotlight: only opens once)
		if (!this.isPopoverOpen) {
			this.overlayEl.showPopover()
			this.isPopoverOpen = true
		}
	}

	/**
	 * Deactivate spotlight completely — called at Step 6 or when component detaches.
	 */
	public deactivate(): void {
		this.highlightGeneration++
		this.cancelScroll()
		this.visible = false
		if (this.currentTarget) {
			this.currentTarget.style.removeProperty('anchor-name')
			this.currentTarget = null
		}
		this.setScrollLock(false)
		if (this.isPopoverOpen) {
			try {
				this.overlayEl.hidePopover()
			} catch {
				// Popover may already be hidden
			}
			this.isPopoverOpen = false
		}
		this.cleanup()
	}

	/**
	 * Re-insert the coach mark popover at the top of the LIFO stack.
	 * Used when another popover (e.g. detail sheet) has entered the top layer
	 * after the coach mark and needs to appear below it.
	 */
	public bringToFront(): void {
		if (!this.isPopoverOpen) return
		requestAnimationFrame(() => {
			try {
				this.overlayEl.hidePopover()
				this.overlayEl.showPopover()
			} catch {
				// Popover state may have changed between frames
			}
		})
	}

	public onBlockerClick(): void {
		// Intentionally no-op: clicks outside the target are blocked
	}

	public onTargetClick(e: Event): void {
		e.preventDefault()
		e.stopPropagation()
		this.currentTarget?.click()
		this.onTap?.()
	}

	private smoothScrollTo(element: HTMLElement): Promise<void> {
		this.cancelScroll()

		return new Promise((resolve) => {
			const onScrollEnd = () => {
				this.scrollEndHandler = null
				window.removeEventListener('scrollend', onScrollEnd)
				resolve()
			}

			this.scrollEndHandler = onScrollEnd
			window.addEventListener('scrollend', onScrollEnd)

			element.scrollIntoView({
				behavior: 'smooth',
				block: 'center',
				inline: 'center',
			})

			// Failsafe: resolve if scrollend never fires (e.g. already in position)
			this.scrollFailsafeTimer = setTimeout(() => {
				this.scrollFailsafeTimer = null
				window.removeEventListener('scrollend', onScrollEnd)
				this.scrollEndHandler = null
				resolve()
			}, SCROLL_FAILSAFE_MS)
		})
	}

	private cancelScroll(): void {
		if (this.scrollFailsafeTimer) {
			clearTimeout(this.scrollFailsafeTimer)
			this.scrollFailsafeTimer = null
		}
		if (this.scrollEndHandler) {
			window.removeEventListener('scrollend', this.scrollEndHandler)
			this.scrollEndHandler = null
		}
	}

	private setScrollLock(locked: boolean): void {
		const viewport = document.querySelector('au-viewport')
		if (viewport instanceof HTMLElement) {
			if (locked) {
				viewport.style.setProperty('overflow', 'hidden')
			} else {
				viewport.style.removeProperty('overflow')
			}
		}
	}

	private cleanup(): void {
		if (this.retryTimer) {
			clearTimeout(this.retryTimer)
			this.retryTimer = null
		}
	}
}
