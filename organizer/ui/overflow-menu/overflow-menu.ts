import { bindable, INode, resolve } from 'aurelia'

/** One entry of an overflow menu. Its label is a catalog key. */
export interface MenuItem {
	/** Sent as the `select` event's detail when the item is chosen. */
	readonly id: string
	readonly labelKey: string
	readonly params?: Record<string, unknown>
	/** A link that navigates, instead of an action. */
	readonly href?: string
	/** Shown dimmed and not chosen; the item stays in the menu (M3 Menus). */
	readonly disabled?: boolean
}

/** The menu's items, inside its shadow root. */
const ITEM = '[role="menuitem"]'

/**
 * M3 overflow menu: an icon button (その他の操作) opening a menu of further
 * actions, such as the destructive ones a page header keeps out of its row of
 * buttons. Choosing an action item closes the menu, returns focus to the
 * button and dispatches `select` with the item's id; a link item navigates.
 *
 * Built on the popover API: Escape and a click outside close the menu, and
 * the platform returns focus to the button on Escape. Opening moves focus to
 * the first item; the arrow keys, Home and End move between items, and Tab
 * closes the menu.
 *
 *     <overflow-menu items.bind="menu" select.trigger="onMenu($event.detail)">
 */
export class OverflowMenu {
	private readonly host = resolve(INode) as HTMLElement

	@bindable public items: MenuItem[] = []
	/** Catalog key of the button's accessible name and tooltip. */
	@bindable public labelKey = 'common.moreActions'

	public button!: HTMLButtonElement
	public menu!: HTMLElement
	public open = false

	public onToggle(event: Event): void {
		this.open = (event as ToggleEvent).newState === 'open'
		if (this.open) this.focusItem(this.firstEnabled())
	}

	public onKeydown(event: KeyboardEvent): boolean {
		const items = this.itemElements()
		const current = items.indexOf(this.focused() as HTMLElement)
		switch (event.key) {
			case 'ArrowDown':
				this.focusItem((current + 1) % items.length)
				return false
			case 'ArrowUp':
				this.focusItem((current - 1 + items.length) % items.length)
				return false
			case 'Home':
				this.focusItem(0)
				return false
			case 'End':
				this.focusItem(items.length - 1)
				return false
			case 'Escape':
				this.close()
				return false
			case 'Tab':
				// Leaving the menu closes it; focus moves on as usual.
				this.menu.hidePopover()
				return true
			default:
				return true
		}
	}

	/** Runs the chosen item: a link navigates, an action is dispatched. */
	public choose(item: MenuItem, event: Event): boolean {
		if (item.disabled) {
			event.preventDefault()
			return false
		}
		this.close()
		if (item.href) return true
		this.host.dispatchEvent(
			new CustomEvent('select', { detail: item.id, bubbles: true }),
		)
		return false
	}

	/** Closes the menu and gives focus back to its button. */
	private close(): void {
		if (this.menu.matches(':popover-open')) this.menu.hidePopover()
		this.button.focus()
	}

	private itemElements(): HTMLElement[] {
		return [...this.menu.querySelectorAll<HTMLElement>(ITEM)]
	}

	private firstEnabled(): number {
		const index = this.itemElements().findIndex(
			(el) => el.getAttribute('aria-disabled') !== 'true',
		)
		return Math.max(index, 0)
	}

	private focusItem(index: number): void {
		this.itemElements()[index]?.focus()
	}

	private focused(): Element | null {
		return (this.menu.getRootNode() as ShadowRoot).activeElement
	}
}
