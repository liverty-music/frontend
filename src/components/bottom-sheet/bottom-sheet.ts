import { bindable, INode, resolve } from 'aurelia'

/**
 * Bottom-sheet primitive built on the web.dev `navigation-drawer` pattern
 * (non-modal `popover` + scroll-snap dismiss), adapted to a vertical sheet.
 *
 * Dismiss is the scroll: a swipe (or a programmatic/tap/ESC close) scrolls the
 * container to the top snap stop (the dismiss zone); an `IntersectionObserver`
 * on the sheet body is the single source of truth and fires `hidePopover()`
 * only once the body has left the viewport. Because nothing commits a close
 * mid-gesture and there is no fixed-duration exit fade competing with the
 * scroll, reversing the gesture is honoured (no bounce-back) and the background
 * is interactive during the close (no operation lock).
 */
export class BottomSheet {
	@bindable public open = false
	@bindable public dismissable = true
	@bindable public ariaLabel = ''

	private readonly host = resolve(INode) as HTMLElement
	private popoverEl!: HTMLElement
	private scrollArea!: HTMLElement
	private sheetBody!: HTMLElement

	// True while the popover is shown; guards double show/close.
	private showing = false

	// True once the sheet has settled on .sheet-body. Suppresses dismiss signals
	// during the open transition so the initial re-snap cannot auto-close it.
	private settled = false

	// True while a close is in flight (scroll-to-closed underway).
	private dismissing = false

	// Distinguishes a programmatic close (parent toggled `open`) — which does NOT
	// emit `sheet-closed` — from a user dismiss (swipe / tap / ESC / Android back)
	// which MUST notify the parent.
	private programmaticClose = false

	// IntersectionObserver on the sheet body: the single dismiss source of truth.
	private io: IntersectionObserver | null = null

	// Background elements the CE made `inert` while open (restored on close).
	private inerted: HTMLElement[] = []

	// Element focused before the sheet opened; focus is restored to it on close.
	private previouslyFocused: HTMLElement | null = null

	// Smooth scroll-to-closed watchers (settle detection).
	private scrollFallbackTimer: ReturnType<typeof setTimeout> | undefined
	private scrollEndHandler: (() => void) | undefined

	public openChanged(isOpen: boolean): void {
		if (isOpen) {
			this.show()
		} else {
			// Parent toggled `open` off → programmatic close.
			this.startDismiss(true)
		}
	}

	public attached(): void {
		this.applyAriaLabel()
		// `open` may have been bound `true` before the popover ref was wired;
		// showPopover() then threw and was swallowed. Retry now.
		if (this.open) {
			this.show()
		}
	}

	public ariaLabelChanged(): void {
		this.applyAriaLabel()
	}

	public detaching(): void {
		// Programmatic teardown — do not emit `sheet-closed`.
		this.clearScrollWatch()
		this.io?.disconnect()
		this.io = null
		this.removeKeydown()
		this.removeInert()
		this.hide()
		this.showing = false
	}

	/** Tap on the dimmed area above the sheet body closes a dismissable sheet. */
	public onDismissZoneClick(): void {
		if (!this.dismissable) return
		this.startDismiss(false)
	}

	/**
	 * IntersectionObserver core, split out so it is unit-testable without a real
	 * observer. `ratio` is the sheet body's visible fraction: ~1 when the sheet
	 * is open (settled on the body), ~0 when it has scrolled off to the dismiss
	 * zone.
	 */
	public updateVisibility(ratio: number): void {
		if (!this.showing) return
		if (ratio >= 0.9) {
			// Sheet body fully visible → release the just-opened guard.
			this.settled = true
			return
		}
		// Body has left the viewport. Honour it only once settled, so the initial
		// re-snap during open cannot trigger a dismiss (the "flash then close" bug).
		if (this.settled && ratio <= 0.1) {
			this.finalizeClose()
		}
	}

	/** Show the popover and set up focus-trap, background inert, and observers. */
	private show(): void {
		if (!this.popoverEl || this.showing) return
		try {
			this.settled = false
			this.dismissing = false
			this.programmaticClose = false
			this.popoverEl.showPopover()
			this.showing = true
			this.previouslyFocused =
				(document.activeElement as HTMLElement | null) ?? null
			this.applyInert()
			this.armObserver()
			this.addKeydown()
			this.focusSheet()
		} catch {
			// Pre-attach: popover ref not resolved / not connected. attached() retries.
		}
	}

	/**
	 * Begin a dismiss: scroll to the top (dismiss zone) snap stop. The
	 * IntersectionObserver (or the settle watcher) hides the popover once the
	 * body is off-screen.
	 */
	private startDismiss(programmatic: boolean): void {
		if (!this.showing || this.dismissing) return
		this.dismissing = true
		this.programmaticClose = programmatic
		// Lift inert as the close begins so the background is interactive during
		// the dismiss scroll (removes the prior during-close operation lock).
		this.removeInert()
		this.scrollToClosed()
	}

	private scrollToClosed(): void {
		if (!this.scrollArea) {
			this.finalizeClose()
			return
		}
		if (this.prefersReducedMotion()) {
			this.scrollArea.scrollTop = 0
			this.finalizeClose()
			return
		}
		// Smooth scroll: finalize when it settles. Prefer `scrollend`; fall back
		// to a timeout for engines that do not fire it (and for the no-op case
		// where the sheet is already at the top, which emits no scroll event).
		const finish = (): void => {
			this.clearScrollWatch()
			if (this.dismissing) this.finalizeClose()
		}
		this.scrollEndHandler = finish
		this.scrollArea.addEventListener('scrollend', finish, { once: true })
		this.scrollFallbackTimer = setTimeout(finish, 400)
		try {
			this.scrollArea.scrollTo({ top: 0, behavior: 'smooth' })
		} catch {
			this.scrollArea.scrollTop = 0
		}
	}

	/** Complete the close: hide, restore focus, sync `open`, and notify parent. */
	private finalizeClose(): void {
		if (!this.showing) return
		this.showing = false
		this.settled = false
		this.dismissing = false
		this.clearScrollWatch()
		this.io?.disconnect()
		this.io = null
		this.removeKeydown()
		this.removeInert()
		const emit = !this.programmaticClose
		this.programmaticClose = false
		this.hide()
		this.restoreFocus()
		if (this.open) {
			this.open = false
		}
		if (emit) {
			this.emitClosed()
		}
	}

	private hide(): void {
		try {
			this.popoverEl?.hidePopover()
		} catch {
			// Already hidden or not in DOM.
		}
	}

	private armObserver(): void {
		if (typeof IntersectionObserver === 'undefined' || !this.sheetBody) return
		this.io?.disconnect()
		this.io = new IntersectionObserver(this.onIntersect, {
			threshold: [0, 0.1, 0.9, 1],
		})
		this.io.observe(this.sheetBody)
	}

	private readonly onIntersect = (
		entries: IntersectionObserverEntry[],
	): void => {
		const last = entries[entries.length - 1]
		if (last) this.updateVisibility(last.intersectionRatio)
	}

	/**
	 * Make everything except the popover subtree `inert`, so focus and assistive
	 * technology are confined to the sheet while it is open. Walks up from the
	 * popover, inerting the siblings at each ancestor level — this works even
	 * though the popover is nested deep in the component tree.
	 */
	private applyInert(): void {
		if (!this.popoverEl || typeof document === 'undefined') return
		const body = document.body
		let node: HTMLElement | null = this.popoverEl
		while (node && node !== body && node.parentElement) {
			const parent = node.parentElement
			for (const sib of Array.from(parent.children)) {
				if (sib !== node && sib instanceof HTMLElement && !sib.inert) {
					sib.inert = true
					this.inerted.push(sib)
				}
			}
			node = parent
		}
	}

	private removeInert(): void {
		for (const el of this.inerted) {
			el.inert = false
		}
		this.inerted = []
	}

	private focusSheet(): void {
		this.sheetBody?.focus?.()
	}

	private restoreFocus(): void {
		this.previouslyFocused?.focus?.()
		this.previouslyFocused = null
	}

	private readonly onKeydown = (e: KeyboardEvent): void => {
		if (!this.showing) return
		if (e.key === 'Escape') {
			// A popover="manual" does not emit a native close request; handle ESC.
			e.preventDefault()
			if (this.dismissable) this.startDismiss(false)
			return
		}
		if (e.key === 'Tab') {
			this.trapTab(e)
		}
	}

	private addKeydown(): void {
		if (typeof document !== 'undefined') {
			document.addEventListener('keydown', this.onKeydown)
		}
	}

	private removeKeydown(): void {
		if (typeof document !== 'undefined') {
			document.removeEventListener('keydown', this.onKeydown)
		}
	}

	/** Wrap Tab focus within the popover (a popover has no native focus trap). */
	private trapTab(e: KeyboardEvent): void {
		if (!this.popoverEl) return
		const focusable = Array.from(
			this.popoverEl.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		)
		if (focusable.length === 0) {
			e.preventDefault()
			this.focusSheet()
			return
		}
		const first = focusable[0]
		const last = focusable[focusable.length - 1]
		const active = document.activeElement
		if (e.shiftKey && active === first) {
			e.preventDefault()
			last.focus()
		} else if (!e.shiftKey && active === last) {
			e.preventDefault()
			first.focus()
		}
	}

	private clearScrollWatch(): void {
		if (this.scrollFallbackTimer) {
			clearTimeout(this.scrollFallbackTimer)
			this.scrollFallbackTimer = undefined
		}
		if (this.scrollEndHandler && this.scrollArea) {
			this.scrollArea.removeEventListener('scrollend', this.scrollEndHandler)
		}
		this.scrollEndHandler = undefined
	}

	private prefersReducedMotion(): boolean {
		return typeof matchMedia !== 'undefined'
			? matchMedia('(prefers-reduced-motion: reduce)').matches
			: false
	}

	private emitClosed(): void {
		this.host.dispatchEvent(new CustomEvent('sheet-closed', { bubbles: true }))
	}

	/**
	 * Mirror the accessible name onto the popover host. Consumers supply it
	 * either through the `ariaLabel` bindable (`aria-label="..."` /
	 * `aria-label.bind="..."`) or via the `t="[aria-label]..."` i18n attribute,
	 * which sets `aria-label` on the host element — so fall back to reading it
	 * off the host when the bindable is empty.
	 */
	private applyAriaLabel(): void {
		if (!this.popoverEl) return
		const label = this.ariaLabel || this.host.getAttribute('aria-label') || ''
		if (label) {
			this.popoverEl.setAttribute('aria-label', label)
		}
	}
}
