import { bindable, INode, resolve } from 'aurelia'

export class BottomSheet {
	@bindable public open = false
	@bindable public dismissable = true
	@bindable public ariaLabel = ''

	private readonly host = resolve(INode) as HTMLElement
	private scrollArea!: HTMLElement
	private triggerElement: HTMLElement | null = null

	private readonly onToggle = (e: Event): void => {
		if (!(e instanceof ToggleEvent)) return
		if (e.newState === 'closed' && this.open) {
			this.open = false
			this.triggerElement?.focus()
			this.triggerElement = null
			this.host.dispatchEvent(
				new CustomEvent('sheet-closed', { bubbles: true }),
			)
		}
	}

	public openChanged(isOpen: boolean): void {
		if (isOpen) {
			this.triggerElement = document.activeElement as HTMLElement | null
			this.host.showPopover()
		} else {
			try {
				this.host.hidePopover()
			} catch {
				// Already hidden
			}
		}
	}

	public dismissableChanged(value: boolean): void {
		this.host.setAttribute('popover', value ? 'auto' : 'manual')
	}

	public ariaLabelChanged(value: string): void {
		this.host.setAttribute('aria-label', value)
	}

	public attached(): void {
		this.host.setAttribute('popover', this.dismissable ? 'auto' : 'manual')
		this.host.setAttribute('role', 'dialog')
		if (this.ariaLabel) {
			this.host.setAttribute('aria-label', this.ariaLabel)
		}
		this.host.addEventListener('toggle', this.onToggle)

		if (this.open) {
			this.openChanged(true)
		}
	}

	public detaching(): void {
		this.host.removeEventListener('toggle', this.onToggle)
		try {
			this.host.hidePopover()
		} catch {
			// Already hidden or not in DOM
		}
		this.triggerElement = null
	}

	public onScrollEnd(): void {
		if (!this.dismissable) return

		const { scrollTop, scrollHeight, clientHeight } = this.scrollArea
		const maxScroll = scrollHeight - clientHeight
		const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 1

		// If swiped down to the dismiss zone (top), close
		if (scrollRatio < 0.1) {
			this.open = false
			this.host.dispatchEvent(
				new CustomEvent('sheet-closed', { bubbles: true }),
			)
		}
	}
}
