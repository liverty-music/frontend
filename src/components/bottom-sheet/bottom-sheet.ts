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
	 * Responsive swipe dismiss: the snapped target changing to the dismiss
	 * zone fires before the full scroll settle, so close immediately rather
	 * than waiting on the UA-controlled `scrollend`. `onScrollEnd` remains the
	 * fallback where `scrollsnapchange` is unsupported.
	 */
	public onSnapChange(e: Event): void {
		if (!this.dismissable) return
		const snapTarget = (e as Event & { snapTargetBlock?: Element | null })
			.snapTargetBlock
		if (snapTarget && snapTarget === this.dismissZone) {
			this.requestClose()
		}
	}

	/** Fallback swipe detection: close once the scroll settles in the dismiss zone. */
	public onScrollEnd(): void {
		if (!this.dismissable) return

		const { scrollTop, scrollHeight, clientHeight } = this.scrollArea
		const maxScroll = scrollHeight - clientHeight
		const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 1

		// Swiped down to the dismiss zone (top) → close.
		if (scrollRatio < 0.1) {
			this.requestClose()
		}
	}

	/** Open as a modal: native focus-trap, inert background, ESC / Android back close request. */
	private showDialog(): void {
		try {
			if (!this.dialogEl.open) {
				this.dialogEl.showModal()
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
}
