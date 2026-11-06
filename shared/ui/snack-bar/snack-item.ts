import { bindable, INode, resolve } from 'aurelia'
import type { Snack } from './snack'

/**
 * Below this visible fraction of the surface, a swipe has carried the snack
 * out of its place. Scroll snapping is mandatory, so a release past half of
 * the width always ends here and a shorter one snaps back.
 */
const SWIPED_OUT_RATIO = 0.1

/**
 * One shown snack: the `Snack` the snack bar shows, as a top-layer popover.
 * It owns what exists only while it is shown, the display timer and the time
 * left on it, and the swipe that dismisses it.
 *
 * Every dismiss (timer, action, close button, swipe, a caller's handle) goes
 * through `snack.handle.dismiss()`, which the snack bar owns; the bar then sets
 * `leaving` (also when the snack only gives way to another one). The item
 * hides its popover, waits for the exit motion to end and dispatches
 * `snack-exited`, on which the bar removes it.
 */
export class SnackItem {
	@bindable public snack!: Snack
	/** Set by the snack bar: hide, play the exit motion, then report it. */
	@bindable public leaving = false
	@bindable public icons = true
	@bindable public dismissible = false
	@bindable public closeLabel = '閉じる'

	/** The horizontal scroller that holds the surface between two gutters. */
	public swipe!: HTMLElement
	/** The visible snack inside the scroller. */
	public surface!: HTMLElement

	private readonly host = resolve(INode) as HTMLElement
	private timer: ReturnType<typeof setTimeout> | null = null
	private deadline = 0
	private remaining = 0
	/** A finger or pointer is on the snack. */
	private held = false
	/** The fan is scrolling the snack sideways. */
	private scrolling = false
	/** The fan touched or scrolled the snack, so a scroll is a swipe. */
	private interacted = false
	private observer: IntersectionObserver | null = null

	public attached(): void {
		this.host.showPopover()
		this.centre()
		this.observe()
		this.remaining = this.snack.durationMs
		if (this.leaving) {
			void this.leave()
			return
		}
		this.resume()
	}

	public detaching(): void {
		this.stopTimer()
		this.observer?.disconnect()
		this.observer = null
	}

	protected leavingChanged(leaving: boolean): void {
		if (leaving) void this.leave()
	}

	public onAction(): void {
		this.snack.action?.callback()
		this.snack.handle?.dismiss()
	}

	public onClose(): void {
		this.snack.handle?.dismiss()
	}

	// --- Hold to pause ---

	public onPointerDown(): void {
		this.interacted = true
		this.held = true
		this.pause()
	}

	public onPointerUp(): void {
		this.held = false
		this.resume()
	}

	public onWheel(): void {
		this.interacted = true
	}

	public onScroll(): void {
		// Scrolling pauses only where the browser reports its end.
		if (!this.interacted || !('onscrollend' in window)) return
		this.scrolling = true
		this.pause()
	}

	public onScrollEnd(): void {
		this.scrolling = false
		this.resume()
	}

	/**
	 * The surface's visible fraction inside the scroller changed. Split out of
	 * the observer so it can be tested without one.
	 */
	public updateVisibility(ratio: number): void {
		if (this.leaving || !this.interacted) return
		if (ratio <= SWIPED_OUT_RATIO) this.snack.handle?.dismiss()
	}

	// --- Internals ---

	private async leave(): Promise<void> {
		this.stopTimer()
		this.observer?.disconnect()
		this.observer = null
		try {
			this.host.hidePopover()
		} catch {
			// Already hidden.
		}
		// The exit transitions start with the style change above; reading the
		// animations flushes it. Under reduced motion there are none.
		const animations = this.host.getAnimations?.() ?? []
		await Promise.all(animations.map((a) => a.finished.catch(() => {})))
		this.host.dispatchEvent(new CustomEvent('snack-exited'))
	}

	/** Scroll the surface to the middle of the scroller, its resting place. */
	private centre(): void {
		if (!this.swipe || !this.surface) return
		const s = this.surface.getBoundingClientRect()
		const r = this.swipe.getBoundingClientRect()
		this.swipe.scrollLeft += s.left + s.width / 2 - (r.left + r.width / 2)
	}

	private observe(): void {
		if (typeof IntersectionObserver === 'undefined' || !this.surface) return
		this.observer = new IntersectionObserver(
			(entries) => {
				const last = entries[entries.length - 1]
				if (last) this.updateVisibility(last.intersectionRatio)
			},
			{ root: this.swipe, threshold: [0, SWIPED_OUT_RATIO, 1] },
		)
		this.observer.observe(this.surface)
	}

	private pause(): void {
		if (this.timer === null) return
		clearTimeout(this.timer)
		this.timer = null
		this.remaining = Math.max(0, this.deadline - Date.now())
	}

	private resume(): void {
		if (this.held || this.scrolling || this.leaving || this.timer !== null) {
			return
		}
		// setTimeout(fn, Infinity) would fire at once (ToInt32 overflow).
		if (!Number.isFinite(this.remaining)) return
		this.deadline = Date.now() + this.remaining
		this.timer = setTimeout(() => {
			this.timer = null
			this.snack.handle?.dismiss()
		}, this.remaining)
	}

	private stopTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = null
	}
}
