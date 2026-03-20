import { bindable } from 'aurelia'

export class BottomSheet {
	@bindable public open = false
	@bindable public dismissable = true
	@bindable public ariaLabel = ''

	private sheetElement!: HTMLDialogElement
	private scrollWrapper!: HTMLElement
	private triggerElement: HTMLElement | null = null

	private readonly onToggle = (e: ToggleEvent): void => {
		if (e.newState === 'closed' && this.open) {
			this.open = false
			this.triggerElement?.focus()
			this.triggerElement = null
			this.sheetElement.dispatchEvent(
				new CustomEvent('sheet-closed', { bubbles: true }),
			)
		}
	}

	public openChanged(isOpen: boolean): void {
		if (!this.sheetElement) return

		if (isOpen) {
			this.triggerElement = document.activeElement as HTMLElement | null
			this.sheetElement.showPopover()
			this.scrollWrapper.scrollTo({ top: this.scrollWrapper.scrollHeight })
		} else {
			try {
				this.sheetElement.hidePopover()
			} catch {
				// Already hidden
			}
		}
	}

	public dismissableChanged(value: boolean): void {
		if (!this.sheetElement) return
		this.sheetElement.setAttribute('popover', value ? 'auto' : 'manual')
	}

	public attached(): void {
		this.sheetElement.setAttribute(
			'popover',
			this.dismissable ? 'auto' : 'manual',
		)
		this.sheetElement.addEventListener('toggle', this.onToggle as EventListener)

		if (this.open) {
			this.openChanged(true)
		}
	}

	public detaching(): void {
		this.sheetElement.removeEventListener(
			'toggle',
			this.onToggle as EventListener,
		)
		try {
			this.sheetElement.hidePopover()
		} catch {
			// Already hidden or not in DOM
		}
		this.triggerElement = null
	}

	public onScrollEnd(): void {
		if (!this.dismissable) return

		const { scrollTop, scrollHeight, clientHeight } = this.scrollWrapper
		const maxScroll = scrollHeight - clientHeight
		const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 1

		// If scrolled to the dismiss zone (top), close
		if (scrollRatio < 0.1) {
			this.open = false
			this.sheetElement.dispatchEvent(
				new CustomEvent('sheet-closed', { bubbles: true }),
			)
		}
	}

	public onScroll(): void {
		if (!this.dismissable) return

		const { scrollTop, scrollHeight, clientHeight } = this.scrollWrapper
		const maxScroll = scrollHeight - clientHeight
		const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 1

		// Map scroll progress to backdrop opacity (1 = fully open, 0 = dismissed)
		this.sheetElement.style.setProperty(
			'--_backdrop-opacity',
			String(Math.min(1, scrollRatio * 1.5)),
		)
	}

	public onBackdropClick(event: MouseEvent): void {
		if (!this.dismissable) return
		if ((event.target as Element).closest('.sheet-page')) return

		// Clicked dismiss-zone or scrollWrapper itself — smooth-scroll to dismiss
		this.scrollWrapper.scrollTo({ top: 0, behavior: 'smooth' })
	}
}
