import { bindable, INode, resolve } from 'aurelia'

export class BottomSheet {
	@bindable public open = false
	@bindable public dismissable = true
	@bindable public ariaLabel = ''

	private readonly host = resolve(INode) as HTMLElement
	private dialogEl!: HTMLDialogElement
	private scrollArea!: HTMLElement
	private dismissZone!: HTMLElement

	// Distinguishes a user-initiated dismiss (ESC / Android back / swipe / tap)
	// — which MUST notify the parent via `sheet-closed` — from a programmatic
	// close driven by the parent toggling `open` (which already knows).
	private userDismiss = false

	// True once the CSS `initial-snap` animation completes and the sheet has
	// settled on .sheet-body. Suppresses dismiss signals during the open
	// transition so a programmatic re-snap cannot auto-close the sheet.
	private settled = false

	// IntersectionObserver used as the dismiss fallback on engines that do not
	// support scrollsnapchange (e.g. Firefox). Null when not armed.
	private io: IntersectionObserver | null = null

	public openChanged(isOpen: boolean): void {
		if (isOpen) {
			this.showDialog()
		} else {
			this.closeDialog()
		}
	}

	public attached(): void {
		this.applyAriaLabel()
		// `open` may have been bound `true` before the inner <dialog> ref was
		// wired; showModal() then threw and was swallowed. Retry now.
		if (this.open) {
			this.showDialog()
		}
	}

	public ariaLabelChanged(): void {
		this.applyAriaLabel()
	}

	public detaching(): void {
		// Programmatic teardown — do not emit `sheet-closed`.
		if (this.scrollArea) {
			this.scrollArea.style.pointerEvents = ''
			this.scrollArea.removeEventListener('animationend', this.onAnimationEnd)
		}
		this.io?.disconnect()
		this.io = null
		this.closeDialog()
	}

	/**
	 * Native close request (ESC key / Android back). For a non-dismissable
	 * sheet the request is suppressed; otherwise it is allowed to proceed and
	 * is treated as a user dismiss surfaced by the subsequent `close` event.
	 */
	public onCancel(e: Event): void {
		if (!this.dismissable) {
			e.preventDefault()
			return
		}
		this.userDismiss = true
	}

	/** Fired after the <dialog> closes by any path; sync `open` and notify the parent. */
	public onClose(): void {
		const dismissed = this.userDismiss
		this.userDismiss = false
		this.settled = false
		this.io?.disconnect()
		this.io = null
		if (this.scrollArea) {
			// Remove the animationend listener in case the dialog closed before the
			// initial-snap animation fired — prevents a stale post-close arm of the
			// IntersectionObserver (see armIntersectionObserver).
			this.scrollArea.removeEventListener('animationend', this.onAnimationEnd)
			this.scrollArea.style.pointerEvents = ''
		}
		if (this.open) {
			this.open = false
		}
		if (dismissed) {
			this.emitClosed()
		}
	}

	/** Tap on the dimmed area above the sheet body closes a dismissable sheet. */
	public onDismissZoneClick(): void {
		if (!this.dismissable) return
		this.requestClose()
	}

	/**
	 * Primary swipe-dismiss signal. `scrollsnapchange` fires only for a user
	 * scroll gesture (per the CSS Scroll Snap module) — not for programmatic or
	 * initial-layout re-snaps — so the iOS/WebKit "flash then close" defect
	 * (where the `initial-snap` animation's re-snap to the dismiss zone was
	 * misread as a user swipe) cannot occur. Supported in Chrome 129+ and
	 * Safari 18.2+; `IntersectionObserver` fallback handles Firefox.
	 *
	 * Locking pointer-events prevents a quick upward swipe from re-snapping to
	 * the sheet body after the dismiss-zone snap is detected.
	 */
	public onSnapChange(e: Event): void {
		if (!this.dismissable || !this.settled) return
		const snapTarget = (e as Event & { snapTargetBlock?: Element | null })
			.snapTargetBlock
		if (snapTarget && snapTarget === this.dismissZone) {
			if (this.scrollArea) this.scrollArea.style.pointerEvents = 'none'
			this.requestClose()
		}
	}

	/** Open as a modal: native focus-trap, inert background, ESC / Android back close request. */
	private showDialog(): void {
		try {
			if (!this.dialogEl.open) {
				this.settled = false
				this.dialogEl.showModal()
				// Arm the settle guard: release once the CSS `initial-snap` animation
				// completes and the scroll position has landed on .sheet-body.
				this.scrollArea.addEventListener('animationend', this.onAnimationEnd)
			}
		} catch {
			// Pre-attach: <dialog> ref not yet resolved. attached() retries.
		}
	}

	private closeDialog(): void {
		try {
			if (this.dialogEl?.open) {
				this.dialogEl.close()
			}
		} catch {
			// Already closed or not in DOM.
		}
	}

	private requestClose(): void {
		this.userDismiss = true
		this.closeDialog()
	}

	private emitClosed(): void {
		this.host.dispatchEvent(new CustomEvent('sheet-closed', { bubbles: true }))
	}

	/**
	 * Mirror the accessible name onto the inner <dialog>. Consumers supply it
	 * either through the `ariaLabel` bindable (`aria-label="..."` /
	 * `aria-label.bind="..."`) or via the `t="[aria-label]..."` i18n attribute,
	 * which sets `aria-label` on the host element — so fall back to reading it
	 * off the host when the bindable is empty.
	 */
	private applyAriaLabel(): void {
		if (!this.dialogEl) return
		const label = this.ariaLabel || this.host.getAttribute('aria-label') || ''
		if (label) {
			this.dialogEl.setAttribute('aria-label', label)
		}
	}

	// Fires when the CSS `initial-snap` animation on .scroll-area ends, meaning
	// the sheet has settled on .sheet-body and the dismiss guard can be released.
	private readonly onAnimationEnd = (e: AnimationEvent): void => {
		if (e.animationName !== 'initial-snap') return
		this.scrollArea.removeEventListener('animationend', this.onAnimationEnd)
		this.settled = true
		this.armIntersectionObserver()
	}

	// Fallback dismiss detection for engines without scrollsnapchange (Firefox).
	// Observes the dismiss zone within the scroll container; when it enters the
	// visible scroll area the user has swiped toward it → close the sheet.
	// Only armed after the just-opened guard releases (settled = true).
	private armIntersectionObserver(): void {
		if (!this.dismissable) return
		// Primary signal (scrollsnapchange) is available — no fallback needed.
		// Double-cast via unknown: HTMLElement doesn't declare onscrollsnapchange
		// (non-standard property) so the direct cast to Record would be rejected.
		if (
			'onscrollsnapchange' in
			(this.scrollArea as unknown as Record<string, unknown>)
		)
			return

		this.io = new IntersectionObserver(
			(entries) => {
				if (!this.dismissable || !this.settled) return
				for (const entry of entries) {
					if (entry.isIntersecting) {
						if (this.scrollArea) this.scrollArea.style.pointerEvents = 'none'
						this.requestClose()
						break
					}
				}
			},
			{ root: this.scrollArea, threshold: 0 },
		)
		this.io.observe(this.dismissZone)
	}
}
